import base64, hashlib, hmac, json, os, time
from fastapi import Depends, Header, HTTPException

SECRET = os.environ.get("SECRET_KEY", "dev-secret-change-me").encode()


def hash_pw(pw, salt=None):
    salt = salt or os.urandom(8).hex()
    return salt + "$" + hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 60_000).hex()


def check_pw(pw, stored):
    return hmac.compare_digest(hash_pw(pw, stored.split("$")[0]), stored)


def make_token(email, role, ttl=1800):
    body = base64.urlsafe_b64encode(json.dumps({"e": email, "r": role, "x": time.time() + ttl}).encode()).decode()
    return body + "." + hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest()


def read_token(token):
    try:
        body, sig = token.split(".")
        data = json.loads(base64.urlsafe_b64decode(body))
        if hmac.compare_digest(sig, hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest()) and data["x"] > time.time():
            return {"email": data["e"], "role": data["r"]}
    except Exception:
        pass
    return None


def current_user(authorization: str = Header(None)):
    user = read_token((authorization or "").removeprefix("Bearer "))
    if not user:
        raise HTTPException(401, "Please sign in")
    return user


def require(*roles):
    def dep(user=Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "Your role is not allowed to do this")
        return user
    return dep
