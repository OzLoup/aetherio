import asyncio

import httpx
import pytest

from app import debrid

KEY = "A" * 52
HASH = "0123456789abcdef0123456789abcdef01234567"
URL = f"https://torrentio.strem.fun/resolve/realdebrid/{KEY}/{HASH.upper()}/null/0/Movie.2025.1080p.mkv"


def test_parse_torrentio_real_debrid_url():
    s = debrid.parse_source(URL)
    assert s == debrid.Source("realdebrid", KEY, HASH)
    assert debrid.parse_source("https://cdn.example/movie.mp4") is None
    assert debrid.parse_source(f"https://torrentio.strem.fun/resolve/alldebrid/{KEY}/{HASH}/x") is None


def _transport(torrents, info=None, status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api.real-debrid.com"
        assert request.headers["authorization"] == f"Bearer {KEY}"
        if request.url.path.endswith("/torrents"):
            return httpx.Response(status, json=torrents)
        return httpx.Response(200, json=info or {})

    return httpx.MockTransport(handler)


def test_progress_of_a_downloading_torrent():
    torrents = [{"id": "X1", "hash": "f" * 40, "status": "downloaded"}, {"id": "X2", "hash": HASH, "status": "downloading", "progress": 10}]
    info = {"status": "downloading", "progress": 42.5, "speed": 3_200_000, "seeders": 12, "filename": "Movie"}
    data = asyncio.run(debrid.progress(debrid.parse_source(URL), transport=_transport(torrents, info)))
    assert data == {"found": True, "status": "downloading", "progress": 42.5, "speed": 3_200_000, "seeders": 12, "filename": "Movie"}


def test_not_added_yet_and_bad_key():
    assert asyncio.run(debrid.progress(debrid.parse_source(URL), transport=_transport([]))) == {"found": False}
    with pytest.raises(debrid.DebridError):
        asyncio.run(debrid.progress(debrid.parse_source(URL), transport=_transport({}, status=401)))
