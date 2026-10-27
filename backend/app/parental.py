"""Parental control PIN checks, with a small brake on guessing: after 5
wrong PINs the account waits 5 minutes (per server instance)."""

import time

from fastapi import HTTPException

from app.auth import verify_password
from app.models import User

MAX_FAILURES = 5
LOCK_SECONDS = 300
_failures: dict[int, list[float]] = {}


def _recent(user_id: int) -> list[float]:
    now = time.monotonic()
    recent = [t for t in _failures.get(user_id, []) if now - t < LOCK_SECONDS]
    _failures[user_id] = recent
    return recent


def check_pin(user: User, pin: str | None) -> None:
    """403 unless `pin` is the account's parental PIN."""
    if not user.parental_pin_hash:
        raise HTTPException(status_code=400, detail="Primero crea un PIN de control parental")
    if len(_recent(user.id)) >= MAX_FAILURES:
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera unos minutos.")
    if not pin or not verify_password(pin, user.parental_pin_hash):
        _failures.setdefault(user.id, []).append(time.monotonic())
        raise HTTPException(status_code=403, detail="PIN incorrecto")
    _failures.pop(user.id, None)
