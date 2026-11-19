"""Sessão automática por cookie seguro, após pareamento inicial do navegador.

O usuário não cola chaves na interface. O pareamento utiliza uma URL
privada gerada na VPS; o segredo permanece no fragmento (#) e nunca
é transmitido em requisições GET nem para o proxy.
"""
from __future__ import annotations

from http.cookies import SimpleCookie
import hashlib
import hmac
import os
import secrets
import time

COOKIE_NAME = "central_nh_session"
MAX_AGE = 90 * 24 * 60 * 60


def _secret():
    return os.environ.get("CENTRAL_SESSION_SECRET", "")


def ready():
    return len(_secret()) >= 32 and len(os.environ.get("CENTRAL_PAIR_TOKEN", "")) >= 32


def verify_pair(token):
    expected = os.environ.get("CENTRAL_PAIR_TOKEN", "")
    return len(expected) >= 32 and isinstance(token, str) and hmac.compare_digest(expected, token)


def issue_cookie(now=None):
    if not ready():
        raise RuntimeError("Sessão da Central não configurada.")
    expiry = int(now if now is not None else time.time()) + MAX_AGE
    payload = str(expiry) + "." + secrets.token_urlsafe(18)
    signature = hmac.new(_secret().encode(), payload.encode(), hashlib.sha256).hexdigest()
    return (f"{COOKIE_NAME}={payload}.{signature}; Path=/central; "
            f"Max-Age={MAX_AGE}; Secure; HttpOnly; SameSite=Strict")


def authenticated(headers, now=None):
    if not ready():
        return False
    try:
        cookie = SimpleCookie()
        cookie.load(headers.get("Cookie", ""))
        morsel = cookie.get(COOKIE_NAME)
        if not morsel or len(morsel.value) > 220:
            return False
        parts = morsel.value.split(".")
        if len(parts) != 3:
            return False
        expires = int(parts[0])
        current = int(now if now is not None else time.time())
        if expires <= current or expires > current + MAX_AGE:
            return False
        payload = ".".join(parts[:2])
        digest = hmac.new(_secret().encode(), payload.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(digest, parts[2])
    except (ValueError, TypeError, IndexError):
        return False


def trusted_origin(origin):
    expected = os.environ.get(
        "CENTRAL_PUBLIC_ORIGIN", "https://controles.fazendanovohorizonte.com"
    ).rstrip("/")
    return bool(origin) and hmac.compare_digest(origin.rstrip("/"), expected)
