import os, tempfile
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "t.db")
import pytest
from fastapi.testclient import TestClient
from app.main import LAT, app, seed_demo
from app.models import Base, engine

client = TestClient(app)
SHIP = {"name": "Asha Rao", "address": "12 MG Road", "city": "Hyderabad", "pincode": "500001"}


@pytest.fixture(autouse=True)
def fresh():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    seed_demo()


def auth(email="demo@lumen.dev", pw="demo123"):
    return {"Authorization": "Bearer " + client.post("/auth/login", json={"email": email, "password": pw}).json()["token"]}


def pid(name):
    return next(p for p in client.get("/products?size=50").json()["items"] if p["name"] == name)["id"]


def order(items, headers=None, shipping=SHIP):
    return client.post("/orders", json={"items": items, "shipping": shipping}, headers=headers or auth())


def test_catalog_search_filter_sort_and_pagination():
    assert client.get("/products").json()["total"] == 8
    assert client.get("/products?category=Phone").json()["total"] == 2
    assert client.get("/products?q=book").json()["total"] == 2
    prices = [p["price"] for p in client.get("/products?sort=price_desc").json()["items"]]
    assert prices == sorted(prices, reverse=True)
    page = client.get("/products?size=3&page=3").json()
    assert len(page["items"]) == 2 and page["total"] == 8
    assert client.get("/products/999").status_code == 404
    assert client.get(f"/products/{pid('Lumen One')}").json()["colors"][0] == "Graphite"


def test_register_login_and_validation_errors():
    r = client.post("/auth/register", json={"email": "new@x.com", "password": "secret1"})
    assert r.status_code == 201 and r.json()["user"]["role"] == "customer"
    assert client.post("/auth/register", json={"email": "new@x.com", "password": "secret1"}).status_code == 409
    assert client.post("/auth/login", json={"email": "new@x.com", "password": "wrong11"}).status_code == 401
    bad = client.post("/auth/login", json={"email": "nope", "password": "1"})
    assert bad.status_code == 422 and bad.json()["error"]["correlation_id"]


def test_order_total_is_calculated_on_the_server_and_stock_drops():
    p = pid("Lumen Buds")
    r = order([{"product_id": p, "qty": 2, "color": "White", "price": 1}])  # a tampered price is ignored
    assert r.status_code == 201 and r.json()["total"] == 17900 * 2
    assert r.json()["items"][0]["unit_price"] == 17900
    assert client.get(f"/products/{p}").json()["stock"] == 58


def test_cannot_oversell_and_failed_order_changes_nothing():
    p = pid("Lumen Display")
    client.patch(f"/admin/products/{p}", json={"stock": 1}, headers=auth("admin@lumen.dev", "admin123"))
    r = order([{"product_id": p, "qty": 2, "color": "Silver"}])
    assert r.status_code == 409 and "Not enough stock" in r.json()["error"]["message"]
    assert client.get(f"/products/{p}").json()["stock"] == 1
    assert client.get("/orders", headers=auth()).json()["items"] == []


def test_idempotency_key_prevents_double_orders():
    p = pid("Lumen Pad")
    h = {**auth(), "Idempotency-Key": "abc-123"}
    first = order([{"product_id": p, "qty": 1, "color": "Blue"}], h).json()
    second = order([{"product_id": p, "qty": 1, "color": "Blue"}], h).json()
    assert first["id"] == second["id"] and client.get(f"/products/{p}").json()["stock"] == 19


def test_order_validation_rules():
    p = pid("Lumen One")
    assert order([{"product_id": p, "qty": 1, "color": "Pink"}]).status_code == 422
    assert order([{"product_id": p, "qty": 9, "color": "Silver"}]).status_code == 422
    assert order([{"product_id": 999, "qty": 1, "color": "Silver"}]).status_code == 404
    assert order([{"product_id": p, "qty": 1, "color": "Silver"}], shipping={**SHIP, "pincode": "12"}).status_code == 422
    assert order([]).status_code == 422
    assert client.post("/orders", json={"items": [], "shipping": SHIP}).status_code == 401


def test_orders_are_private_to_their_owner():
    p = pid("Lumen Watch")
    o = order([{"product_id": p, "qty": 1, "color": "Silver"}]).json()
    client.post("/auth/register", json={"email": "other@x.com", "password": "secret1"})
    other = auth("other@x.com", "secret1")
    assert client.get(f"/orders/{o['id']}", headers=other).status_code == 404
    assert client.get("/orders", headers=other).json()["items"] == []
    assert client.get(f"/orders/{o['id']}", headers=auth()).json()["id"] == o["id"]


def test_only_admin_can_change_stock_and_missing_product():
    p = pid("Lumen One")
    assert client.patch(f"/admin/products/{p}", json={"stock": 5}, headers=auth()).status_code == 403
    assert client.patch(f"/admin/products/{p}", json={"stock": 5}, headers=auth("admin@lumen.dev", "admin123")).json()["stock"] == 5
    assert client.patch("/admin/products/999", json={"stock": 5}, headers=auth("admin@lumen.dev", "admin123")).status_code == 404


def test_health_metrics_and_correlation_id():
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/health", headers={"X-Correlation-ID": "zz9"}).headers["X-Correlation-ID"] == "zz9"
    m = client.get("/metrics").text
    assert "lumen_requests_total" in m and "lumen_request_latency_ms_count" in m and LAT
