
import json
import logging
import os
import time
import uuid
from collections import defaultdict

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import update

from app.models import (
    Base,
    Order,
    OrderItem,
    Product,
    SessionLocal,
    User,
    engine,
    row,
)
from app.security import (
    check_pw,
    current_user,
    hash_pw,
    make_token,
    require,
)


log = logging.getLogger("lumen")
logging.basicConfig(level=logging.INFO, format="%(message)s")

Base.metadata.create_all(engine)

app = FastAPI(title="Lumen Store API", version="0.1.0")


# CORS CONFIGURATION
allowed_origins = [
    "http://localhost:5173",
    "https://gregarious-flan-bb6319.netlify.app",
]

extra_origins = os.environ.get("CORS_ORIGINS", "")
allowed_origins.extend(
    origin.strip()
    for origin in extra_origins.split(",")
    if origin.strip()
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Correlation-ID"],
)


STATS, LAT = defaultdict(int), defaultdict(list)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.middleware("http")
async def observe(request: Request, call_next):
    cid = request.headers.get("x-correlation-id") or uuid.uuid4().hex[:12]
    request.state.cid = cid

    start = time.perf_counter()
    response = await call_next(request)

    ms = (time.perf_counter() - start) * 1000
    route = getattr(request.scope.get("route"), "path", request.url.path)

    STATS[(request.method, route, response.status_code)] += 1
    LAT[route].append(ms)

    response.headers["X-Correlation-ID"] = cid

    log.info(
        json.dumps({
            "cid": cid,
            "method": request.method,
            "route": route,
            "status": response.status_code,
            "ms": round(ms, 1),
        })
    )

    return response


def err(request, status, message, code):
    return JSONResponse(
        {
            "error": {
                "code": code,
                "message": message,
                "correlation_id": getattr(request.state, "cid", "-"),
            }
        },
        status_code=status,
    )


@app.exception_handler(HTTPException)
async def http_err(request, exc):
    return err(
        request,
        exc.status_code,
        str(exc.detail),
        f"http_{exc.status_code}",
    )


@app.exception_handler(RequestValidationError)
async def invalid(request, exc):
    return err(
        request,
        422,
        "Invalid input: "
        + "; ".join(
            f"{'.'.join(map(str, e['loc'][1:]))} {e['msg']}"
            for e in exc.errors()
        ),
        "validation_error",
    )


class Cred(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=6, max_length=100)


@app.post("/auth/register", status_code=201)
def register(c: Cred, db=Depends(get_db)):
    if db.query(User).filter_by(email=c.email.lower()).first():
        raise HTTPException(409, "That email is already registered")

    u = User(
        email=c.email.lower(),
        password_hash=hash_pw(c.password),
    )

    db.add(u)
    db.commit()

    return {
        "token": make_token(u.email, u.role),
        "user": {"email": u.email, "role": u.role},
    }


@app.post("/auth/login")
def login(c: Cred, db=Depends(get_db)):
    u = db.query(User).filter_by(email=c.email.lower()).first()

    if not u or not check_pw(c.password, u.password_hash):
        raise HTTPException(401, "Wrong email or password")

    return {
        "token": make_token(u.email, u.role),
        "user": {"email": u.email, "role": u.role},
    }


SORTS = {
    "price_asc": Product.price.asc(),
    "price_desc": Product.price.desc(),
    "name": Product.name.asc(),
}


@app.get("/products")
def products(
    q: str = "",
    category: str = "",
    sort: str = "name",
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=50),
    db=Depends(get_db),
):
    qs = db.query(Product)

    if q:
        qs = qs.filter(
            Product.name.ilike(f"%{q}%")
            | Product.tagline.ilike(f"%{q}%")
        )

    if category:
        qs = qs.filter(Product.category == category)

    total = qs.count()

    items = (
        qs.order_by(SORTS.get(sort, Product.name.asc()))
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    return {
        "items": [row(p) for p in items],
        "total": total,
        "page": page,
        "size": size,
    }


@app.get("/products/{pid}")
def product(pid: int, db=Depends(get_db)):
    p = db.get(Product, pid)

    if not p:
        raise HTTPException(404, "Product not found")

    return row(p)


class Item(BaseModel):
    product_id: int
    qty: int = Field(ge=1, le=5)
    color: str = Field(min_length=1, max_length=20)


class Ship(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    address: str = Field(min_length=5, max_length=200)
    city: str = Field(min_length=2, max_length=60)
    pincode: str = Field(pattern=r"^\d{6}$")


class NewOrder(BaseModel):
    items: list[Item] = Field(min_length=1, max_length=20)
    shipping: Ship


def order_out(db, o):
    d = row(o)
    d["items"] = [
        row(i)
        for i in db.query(OrderItem).filter_by(order_id=o.id).all()
    ]
    return d


@app.post("/orders", status_code=201)
def place(
    n: NewOrder,
    idem: str | None = Header(None, alias="Idempotency-Key"),
    user=Depends(current_user),
    db=Depends(get_db),
):
    if idem:
        again = db.query(Order).filter_by(
            user_email=user["email"],
            idem_key=idem,
        ).first()

        if again:
            return order_out(db, again)

    lines, total = [], 0

    for it in n.items:
        p = db.get(Product, it.product_id)

        if not p:
            raise HTTPException(404, f"Product {it.product_id} not found")

        if it.color not in p.colors:
            raise HTTPException(
                422,
                f"{p.name} is not available in {it.color}",
            )

        lines.append((p, it))
        total += p.price * it.qty

    o = Order(
        user_email=user["email"],
        idem_key=idem,
        total=total,
        shipping=n.shipping.model_dump(),
    )

    db.add(o)
    db.flush()

    for p, it in lines:
        res = db.execute(
            update(Product)
            .where(
                Product.id == p.id,
                Product.stock >= it.qty,
            )
            .values(stock=Product.stock - it.qty)
        )

        if res.rowcount == 0:
            db.rollback()
            raise HTTPException(
                409,
                f"Not enough stock for {p.name}",
            )

        db.add(
            OrderItem(
                order_id=o.id,
                product_id=p.id,
                name=p.name,
                unit_price=p.price,
                qty=it.qty,
                color=it.color,
            )
        )

    db.commit()
    return order_out(db, o)


@app.get("/orders")
def my_orders(user=Depends(current_user), db=Depends(get_db)):
    return {
        "items": [
            order_out(db, o)
            for o in (
                db.query(Order)
                .filter_by(user_email=user["email"])
                .order_by(Order.id.desc())
                .all()
            )
        ]
    }


@app.get("/orders/{oid}")
def one_order(
    oid: int,
    user=Depends(current_user),
    db=Depends(get_db),
):
    o = db.get(Order, oid)

    if not o or o.user_email != user["email"]:
        raise HTTPException(404, "Order not found")

    return order_out(db, o)


class Stock(BaseModel):
    stock: int = Field(ge=0, le=10000)


@app.patch("/admin/products/{pid}")
def set_stock(
    pid: int,
    s: Stock,
    user=Depends(require("admin")),
    db=Depends(get_db),
):
    p = db.get(Product, pid)

    if not p:
        raise HTTPException(404, "Product not found")

    p.stock = s.stock
    db.commit()

    return row(p)


@app.get("/health")
def health(db=Depends(get_db)):
    db.query(User).first()
    return {"status": "ok"}


@app.get("/metrics", response_class=PlainTextResponse)
def metrics():
    out = [
        f'lumen_requests_total{{method="{m}",route="{r}",status="{s}"}} {n}'
        for (m, r, s), n in sorted(STATS.items())
    ]

    for r, v in sorted(LAT.items()):
        out += [
            f'lumen_request_latency_ms_sum{{route="{r}"}} {sum(v):.2f}',
            f'lumen_request_latency_ms_count{{route="{r}"}} {len(v)}',
        ]

    return "\n".join(out) + "\n"


CATALOG = [
    (
        "Lumen One", "Phone", 79900,
        "Fast. Quiet. Brilliant.",
        "A 6.3 inch display, all day battery and a camera that handles low light with ease.",
        25, ["Graphite", "Silver", "Blue"], 215,
    ),
    (
        "Lumen One Mini", "Phone", 59900,
        "Small in size. Big on everything else.",
        "The same chip as Lumen One in a compact body you can use with one hand.",
        30, ["Graphite", "Rose"], 340,
    ),
    (
        "Lumen Book Air", "Laptop", 119900,
        "Light enough to forget.",
        "A thin, fanless laptop with a 14 inch display and 18 hours of battery.",
        15, ["Silver", "Midnight"], 220,
    ),
    (
        "Lumen Book Pro", "Laptop", 179900,
        "Power for the work that matters.",
        "A 16 inch laptop for editing, coding and everything demanding.",
        10, ["Graphite", "Silver"], 230,
    ),
    (
        "Lumen Pad", "Tablet", 54900,
        "A canvas for everything.",
        "An 11 inch tablet with a pencil that feels like paper.",
        20, ["Silver", "Blue", "Rose"], 200,
    ),
    (
        "Lumen Watch", "Watch", 39900,
        "Your day, on your wrist.",
        "Track workouts, sleep and notifications with a display bright enough for the sun.",
        40, ["Midnight", "Silver"], 160,
    ),
    (
        "Lumen Buds", "Audio", 17900,
        "Sound that disappears.",
        "Active noise cancelling earbuds with 30 hours of listening in the case.",
        60, ["White", "Graphite"], 280,
    ),
    (
        "Lumen Display", "Display", 89900,
        "Every pixel in its place.",
        "A 27 inch 5K display with accurate color for creators.",
        8, ["Silver"], 250,
    ),
]


def seed_demo():
    with SessionLocal() as db:
        if db.query(Product).count():
            return

        db.add_all([
            Product(
                name=n,
                category=c,
                price=p,
                tagline=t,
                description=d,
                stock=s,
                colors=cl,
                hue=h,
            )
            for n, c, p, t, d, s, cl, h in CATALOG
        ])

        db.add_all([
            User(
                email="demo@lumen.dev",
                password_hash=hash_pw("demo123"),
            ),
            User(
                email="admin@lumen.dev",
                password_hash=hash_pw("admin123"),
                role="admin",
            ),
        ])

        db.commit()


if os.environ.get("SEED_DEMO") == "1":
    seed_demo()
