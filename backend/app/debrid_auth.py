"""Connect Real-Debrid once, with a code (no key to paste).

Real-Debrid's device flow for open-source apps: the app shows a code, the
user approves it at real-debrid.com/device, and we get per-user client
credentials plus tokens. Measured with a real account (2026-11-18):
- the access token lasts 24 h; the refresh token doesn't change when used
  and can be reused; an old access token keeps working until it expires;
- torrents, downloads and unrestrict work with it (only /settings is 403).

`users.realdebrid_key` always holds the token in use, so everything else
(downloads, Torrentio/Comet URLs) works the same as with a pasted key.
`users.realdebrid_oauth` (encrypted JSON) keeps what renews it. Renewal
happens when less than RENEW_BEFORE is left; the old token still works for
the rest of its day, so links already handed out don't break.
"""

import json
import logging
import time

import httpx
from sqlalchemy.orm import Session

from app.models import User

log = logging.getLogger(__name__)

OAUTH = "https://api.real-debrid.com/oauth/v2"
# Real-Debrid's public client id for open-source apps.
OPEN_SOURCE_CLIENT_ID = "X245A4XAIBGVM"
DEVICE_GRANT = "http://oauth.net/grant_type/device/1.0"
RENEW_BEFORE = 12 * 3600


class ConnectError(Exception):
    pass


def _client(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    return httpx.Client(base_url=OAUTH, timeout=15, transport=transport)


def start(transport: httpx.BaseTransport | None = None) -> dict:
    """A new code to show: {device_code, user_code, verification_url,
    direct_verification_url, interval, expires_in}."""
    with _client(transport) as c:
        try:
            res = c.get("/device/code", params={"client_id": OPEN_SOURCE_CLIENT_ID, "new_credentials": "yes"})
        except httpx.HTTPError as exc:
            raise ConnectError("Real-Debrid no responde") from exc
    if res.status_code != 200:
        raise ConnectError(f"Real-Debrid respondió {res.status_code}")
    data = res.json()
    return {k: data.get(k) for k in ("device_code", "user_code", "verification_url", "direct_verification_url", "interval", "expires_in")}


def _token(c: httpx.Client, client_id: str, client_secret: str, code: str) -> dict:
    res = c.post(
        "/token",
        data={"client_id": client_id, "client_secret": client_secret, "code": code, "grant_type": DEVICE_GRANT},
    )
    if res.status_code != 200:
        raise ConnectError(f"Real-Debrid respondió {res.status_code}")
    return res.json()


def poll(device_code: str, transport: httpx.BaseTransport | None = None) -> dict | None:
    """None while the user hasn't approved yet; then the saved auth
    {client_id, client_secret, refresh_token, access_token, expires_at}."""
    with _client(transport) as c:
        try:
            res = c.get("/device/credentials", params={"client_id": OPEN_SOURCE_CLIENT_ID, "code": device_code})
            if res.status_code != 200 or not res.json().get("client_secret"):
                return None
            creds = res.json()
            token = _token(c, creds["client_id"], creds["client_secret"], device_code)
        except httpx.HTTPError as exc:
            raise ConnectError("Real-Debrid no responde") from exc
    return {
        "client_id": creds["client_id"],
        "client_secret": creds["client_secret"],
        "refresh_token": token["refresh_token"],
        "access_token": token["access_token"],
        "expires_at": time.time() + int(token.get("expires_in") or 86400),
    }


def save(db: Session, user: User, auth: dict) -> None:
    """Connected with a code: its token becomes the key in use."""
    user.realdebrid_oauth = json.dumps({k: auth[k] for k in ("client_id", "client_secret", "refresh_token", "expires_at")})
    user.realdebrid_key = auth["access_token"]
    db.commit()


def connected_with_code(user: User) -> bool:
    return bool(user.realdebrid_oauth)


def ensure_fresh(db: Session, user: User, transport: httpx.BaseTransport | None = None, force: bool = False) -> bool:
    """Renew the token if it's close to expiring (or `force`), and update the
    Torrentio/Comet URLs. True if it changed. A failed renewal is logged and
    the current token kept: it may still have hours left."""
    if not user.realdebrid_oauth:
        return False
    auth = json.loads(user.realdebrid_oauth)
    if not force and auth.get("expires_at", 0) - time.time() > RENEW_BEFORE:
        return False
    try:
        with _client(transport) as c:
            token = _token(c, auth["client_id"], auth["client_secret"], auth["refresh_token"])
    except (httpx.HTTPError, ConnectError) as exc:
        log.warning("Real-Debrid token renewal failed for user %s: %s", user.id, exc)
        return False
    from app import addons_service  # avoid an import cycle

    auth["expires_at"] = time.time() + int(token.get("expires_in") or 86400)
    auth["refresh_token"] = token.get("refresh_token") or auth["refresh_token"]
    user.realdebrid_oauth = json.dumps(auth)
    user.realdebrid_key = token["access_token"]
    db.commit()
    addons_service.apply_debrid_key(db, user, user.realdebrid_key)
    return True


def forget(user: User) -> None:
    user.realdebrid_oauth = None
    user.realdebrid_key = None
