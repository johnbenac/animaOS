from __future__ import annotations

import ssl
from functools import lru_cache

import httpx


@lru_cache(maxsize=1)
def system_ssl_context() -> ssl.SSLContext:
    """Return an SSL context backed by the machine's trust store."""
    return ssl.create_default_context()


def create_async_http_client(
    *,
    timeout: float,
    transport: httpx.AsyncBaseTransport | None = None,
) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=timeout,
        transport=transport,
        verify=system_ssl_context(),
    )
