from fastapi.responses import RedirectResponse
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.routers import auth as auth_router


def _configure(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "cid")
    monkeypatch.setattr(settings, "google_client_secret", "secret")

    async def fake_authorize_redirect(request, redirect_uri):
        return RedirectResponse("https://accounts.google.com/o/oauth2/auth?fake=1")

    monkeypatch.setattr(auth_router.oauth.google, "authorize_redirect", fake_authorize_redirect)


def test_providers_reflects_config(monkeypatch):
    client = TestClient(app)
    monkeypatch.setattr(settings, "google_client_id", "")
    assert client.get("/auth/providers").json() == {"google": False}
    _configure(monkeypatch)
    assert client.get("/auth/providers").json() == {"google": True}


def test_login_without_credentials_is_501(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "")
    assert TestClient(app).get("/auth/google/login", follow_redirects=False).status_code == 501


def test_cancelled_login_goes_back_to_the_app_that_started_it(monkeypatch):
    _configure(monkeypatch)

    async def denied(request):
        raise RuntimeError("access_denied")

    monkeypatch.setattr(auth_router.oauth.google, "authorize_access_token", denied)
    for client_kind, expected in [
        ("desktop", "aetherio://auth/callback#error=google"),
        ("web", f"{settings.frontend_url}/auth/callback#error=google"),
    ]:
        c = TestClient(app)  # fresh cookie jar = fresh session
        start = c.get(f"/auth/google/login?client={client_kind}", follow_redirects=False)
        assert start.status_code in (302, 307)
        back = c.get("/auth/google/callback", follow_redirects=False)
        assert back.headers["location"] == expected


def test_unverified_email_is_rejected(monkeypatch):
    _configure(monkeypatch)

    async def unverified(request):
        return {"userinfo": {"email": "x@example.com", "sub": "1", "email_verified": False}}

    monkeypatch.setattr(auth_router.oauth.google, "authorize_access_token", unverified)
    c = TestClient(app)
    c.get("/auth/google/login?client=web", follow_redirects=False)
    assert c.get("/auth/google/callback", follow_redirects=False).headers["location"].endswith("#error=google_email")
