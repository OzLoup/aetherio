"""A small brake on guessing (login, sign-up): N attempts per key in a time
window. In memory, per server instance: enough to make password guessing
slow, without extra infrastructure."""

import time
from collections import deque

from fastapi import HTTPException, Request


class SlidingWindow:
    def __init__(self, limit: int, seconds: float) -> None:
        self.limit = limit
        self.seconds = seconds
        self._hits: dict[str, deque[float]] = {}

    def _recent(self, key: str) -> deque[float]:
        now = time.monotonic()
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] > self.seconds:
            hits.popleft()
        if not hits:
            self._hits.pop(key, None)
            hits = self._hits.setdefault(key, deque())
        # Keep memory bounded if someone sprays keys.
        if len(self._hits) > 50_000:
            self._hits.clear()
            hits = self._hits.setdefault(key, deque())
        return hits

    def blocked(self, key: str) -> bool:
        return len(self._recent(key)) >= self.limit

    def hit(self, key: str) -> None:
        self._recent(key).append(time.monotonic())

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)


def client_ip(request: Request) -> str:
    # Behind Cloud Run's proxy uvicorn runs with --proxy-headers, so this is
    # the real client address.
    return request.client.host if request.client else "unknown"


def too_many() -> HTTPException:
    return HTTPException(status_code=429, detail="Demasiados intentos. Espera unos minutos y vuelve a probar.")
