"""Encryption at rest for secrets stored in the database.

Addon URLs can carry API keys (Torrentio + Real-Debrid: ".../realdebrid=KEY|..."),
so `profile_addons.transport_url` is stored encrypted (Fernet: AES + HMAC).
Uniqueness and lookups use `url_hash`, a keyed hash of the URL, since the
ciphertext changes every time.

DATA_ENCRYPTION_KEY must be a Fernet key in production
(`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`).
In development, if it's empty, one is derived from JWT_SECRET.
"""

import base64
import hashlib
import hmac
import logging

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

from app.config import settings

log = logging.getLogger(__name__)
PREFIX = "enc:"


def _key() -> bytes:
    if settings.data_encryption_key:
        return settings.data_encryption_key.encode()
    log.warning("DATA_ENCRYPTION_KEY not set: deriving one from JWT_SECRET (dev only)")
    return base64.urlsafe_b64encode(hashlib.sha256(f"aetherio-data:{settings.jwt_secret}".encode()).digest())


_fernet = Fernet(_key())


def encrypt(value: str) -> str:
    return PREFIX + _fernet.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    if not value.startswith(PREFIX):
        return value  # legacy plaintext (before migration 0005)
    try:
        return _fernet.decrypt(value[len(PREFIX):].encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("Could not decrypt a stored value: wrong DATA_ENCRYPTION_KEY?") from exc


def url_hash(value: str) -> str:
    """Stable keyed hash for uniqueness/lookups of encrypted URLs."""
    return hmac.new(_key(), value.encode(), hashlib.sha256).hexdigest()


class EncryptedText(TypeDecorator):
    """Text column transparently encrypted in the database."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return None if value is None else encrypt(value)

    def process_result_value(self, value, dialect):
        return None if value is None else decrypt(value)
