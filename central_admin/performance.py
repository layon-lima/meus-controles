"""Caches curtos e seguros para acelerar a Central.

Nunca faz cache de pagamentos, POST/PUT/PATCH/DELETE, PDFs ou sessões.
Cada contêiner gerencia o próprio cache em memória: sem serviço externo.
"""
from __future__ import annotations

from collections import OrderedDict
from threading import Lock
from time import monotonic

_SUMMARY_TTL = 10.0
_STATIC_TTL = 75.0
_STATIC_MAX_BYTES = 12 * 1024 * 1024
_STATIC_MAX_ITEM = 2 * 1024 * 1024

_summary_lock = Lock()
_summary_value = None
_summary_expiry = 0.0
_summary_key = None
_asset_lock = Lock()
_assets = OrderedDict()
_assets_size = 0


def cached_snapshot(path, dsn, create):
    """Evita consultar SQLite + PostgreSQL em cada aba simultaneamente.

    Em caso de erro de fonte, a próxima solicitação tenta de novo.
    A atualização de dados continua visível em até 10 segundos.
    """
    global _summary_key, _summary_expiry, _summary_value
    key = (path, dsn)
    now = monotonic()
    with _summary_lock:
        if _summary_key == key and _summary_value is not None and now < _summary_expiry:
            return _summary_value
        result = create(path, dsn)
        if result.get("fontes", {}).get("contas", {}).get("disponivel") and \
           result.get("fontes", {}).get("controles", {}).get("disponivel"):
            _summary_key, _summary_value = key, result
            _summary_expiry = monotonic() + _SUMMARY_TTL
        else:
            _summary_key, _summary_value = None, None
            _summary_expiry = 0.0
        return result


def safe_static_path(path):
    """Restringe o cache a JS e CSS públicos, sem dados financeiros."""
    if not path or "?" in path or ".." in path or "\\" in path:
        return False
    if path in ("/app.js", "/styles.css", "/app.css"):
        return True
    return path.startswith("/static/") and path.endswith((".js", ".css"))


def cached_asset(key):
    global _assets_size
    with _asset_lock:
        hit = _assets.get(key)
        if hit is None:
            return None
        expires, content_type, data = hit
        if monotonic() >= expires:
            _assets.pop(key, None)
            _assets_size -= len(data)
            return None
        _assets.move_to_end(key)
        return content_type, data


def save_asset(key, content_type, data):
    global _assets_size
    if not 0 < len(data) <= _STATIC_MAX_ITEM:
        return
    with _asset_lock:
        old = _assets.pop(key, None)
        if old:
            _assets_size -= len(old[2])
        while _assets and _assets_size + len(data) > _STATIC_MAX_BYTES:
            _, removed = _assets.popitem(last=False)
            _assets_size -= len(removed[2])
        _assets[key] = (monotonic() + _STATIC_TTL, content_type, data)
        _assets_size += len(data)


def invalidate_summary():
    """Lança nova consulta após uma gravação confirmada num dos motores."""
    global _summary_value, _summary_expiry, _summary_key
    with _summary_lock:
        _summary_value, _summary_expiry, _summary_key = None, 0.0, None


def reset_caches():
    """Uso em testes, sem efeito nos bancos ou em arquivos de produção."""
    global _summary_value, _summary_expiry, _summary_key, _assets_size
    with _summary_lock:
        _summary_value, _summary_expiry, _summary_key = None, 0.0, None
    with _asset_lock:
        _assets.clear()
        _assets_size = 0
