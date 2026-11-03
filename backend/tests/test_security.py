from fastapi.testclient import TestClient

from app import tmdb
from app.auth import create_access_token, decode_access_token
from app.config import settings
from app.main import app
from app.ratelimit import SlidingWindow

client = TestClient(app)


def test_sliding_window_blocks_after_limit_and_resets():
    w = SlidingWindow(limit=3, seconds=60)
    for _ in range(3):
        assert not w.blocked("a")
        w.hit("a")
    assert w.blocked("a")
    assert not w.blocked("b")  # per key
    w.reset("a")
    assert not w.blocked("a")


def test_token_carries_version_and_old_tokens_count_as_zero():
    assert decode_access_token(create_access_token("a@b.c", 3)) == ("a@b.c", 3)
    from jose import jwt

    legacy = jwt.encode({"sub": "a@b.c", "exp": 4102444800}, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    assert decode_access_token(legacy) == ("a@b.c", 0)
    assert decode_access_token("not-a-token") is None


def test_security_headers():
    res = client.get("/health")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert res.headers["referrer-policy"] == "no-referrer"


def test_signed_in_answers_are_not_cached():
    res = client.get("/health", headers={"Authorization": "Bearer x"})
    assert res.headers["cache-control"] == "no-store"


def test_public_routes_reject_malformed_ids(monkeypatch):
    monkeypatch.setattr(settings, "tmdb_api_key", "k")
    called = []

    async def fake_meta(*args):
        called.append(args)
        return None

    async def fake_similar(*args):
        called.append(args)
        return []

    monkeypatch.setattr(tmdb, "meta", fake_meta)
    monkeypatch.setattr(tmdb, "similar", fake_similar)
    assert client.get("/stremio/tmdb/MX/meta/movie/tt1%3Fapi_key=x.json").status_code == 404
    assert client.get("/stremio/tmdb/similar/movie/abc.json").json() == {"metas": []}
    assert called == []  # TMDB was never asked
    assert client.get(f"/stremio/tmdb/MX/catalog/movie/aetherio.search/search={'x' * 600}.json").status_code == 400


def test_large_json_is_compressed(monkeypatch):
    monkeypatch.setattr(settings, "tmdb_api_key", "k")

    async def fake_catalog(*args):
        return [{"id": f"tt{i}", "type": "movie", "name": "Título " * 10} for i in range(100)]

    monkeypatch.setattr(tmdb, "catalog", fake_catalog)
    res = client.get("/stremio/tmdb/MX/catalog/movie/aetherio.trending.json", headers={"Accept-Encoding": "gzip"})
    assert res.headers.get("content-encoding") == "gzip"
