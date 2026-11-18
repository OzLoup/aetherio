import json
import time
from types import SimpleNamespace

import httpx

from app import debrid_auth
from app.crypto import url_hash
from app.models import Profile, ProfileAddon, User

TORRENTIO = {"id": "com.stremio.torrentio.addon"}


def _rd(approved=True, token_status=200, calls=None):
    """Fake Real-Debrid OAuth answers."""

    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(request.url.path)
        if request.url.path.endswith("/device/code"):
            return httpx.Response(200, json={"device_code": "DEV123456789", "user_code": "ABCD1234", "verification_url": "https://real-debrid.com/device", "direct_verification_url": "https://real-debrid.com/device?code=ABCD1234", "interval": 5, "expires_in": 900})
        if request.url.path.endswith("/device/credentials"):
            return httpx.Response(200, json={"client_id": "CID", "client_secret": "SECRET"}) if approved else httpx.Response(403, json={"error": "authorization_pending"})
        if request.url.path.endswith("/token"):
            return httpx.Response(token_status, json={"access_token": "ACCESS2", "refresh_token": "REFRESH", "expires_in": 86400, "token_type": "Bearer"})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def test_start_gives_the_code_to_show():
    out = debrid_auth.start(_rd())
    assert out["user_code"] == "ABCD1234" and out["device_code"] == "DEV123456789" and out["interval"] == 5


def test_poll_waits_then_returns_tokens():
    assert debrid_auth.poll("DEV123456789", _rd(approved=False)) is None
    auth = debrid_auth.poll("DEV123456789", _rd())
    assert auth["access_token"] == "ACCESS2" and auth["refresh_token"] == "REFRESH" and auth["client_secret"] == "SECRET"
    assert auth["expires_at"] > time.time() + 86000


def _user(expires_in: float) -> User:
    url = "https://torrentio.strem.fun/realdebrid=ACCESS1/manifest.json"
    addon = ProfileAddon(transport_url=url, url_hash=url_hash(url), manifest=TORRENTIO)
    user = User(id=7, profiles=[Profile(addons=[addon])])
    user.realdebrid_key = "ACCESS1"
    user.realdebrid_oauth = json.dumps({"client_id": "CID", "client_secret": "SECRET", "refresh_token": "REFRESH", "expires_at": time.time() + expires_in})
    return user


DB = SimpleNamespace(commit=lambda: None)


def test_token_with_time_left_is_not_renewed():
    calls: list[str] = []
    user = _user(20 * 3600)
    assert debrid_auth.ensure_fresh(DB, user, _rd(calls=calls)) is False
    assert calls == [] and user.realdebrid_key == "ACCESS1"


def test_token_close_to_expiring_is_renewed_and_addons_follow():
    user = _user(3 * 3600)
    assert debrid_auth.ensure_fresh(DB, user, _rd()) is True
    assert user.realdebrid_key == "ACCESS2"
    assert json.loads(user.realdebrid_oauth)["expires_at"] > time.time() + 86000
    assert user.profiles[0].addons[0].transport_url.endswith("realdebrid=ACCESS2/manifest.json")


def test_failed_renewal_keeps_the_current_token():
    user = _user(3 * 3600)
    assert debrid_auth.ensure_fresh(DB, user, _rd(token_status=401)) is False
    assert user.realdebrid_key == "ACCESS1"


def test_pasted_key_is_never_renewed_and_forget_clears_both():
    user = User(id=8)
    user.realdebrid_key = "PASTED"
    assert debrid_auth.ensure_fresh(DB, user, _rd()) is False
    connected = _user(3 * 3600)
    debrid_auth.forget(connected)
    assert connected.realdebrid_key is None and connected.realdebrid_oauth is None
