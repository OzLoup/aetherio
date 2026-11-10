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


# --- Downloads the app asks for itself ------------------------------------

FILES = [
    {"id": 1, "path": "/Show.S01/Sample.mkv", "bytes": 10, "selected": 0},
    {"id": 2, "path": "/Show.S01/Show.S01E01.1080p.mkv", "bytes": 1000, "selected": 0},
    {"id": 3, "path": "/Show.S01/Show.S01E02.1080p.mkv", "bytes": 900, "selected": 0},
    {"id": 4, "path": "/Show.S01/info.nfo", "bytes": 5, "selected": 0},
]


def test_pick_file_by_name_episode_index_or_biggest():
    assert debrid.pick_file(FILES, filename="show.s01e02.1080p.mkv")["id"] == 3
    assert debrid.pick_file(FILES, season=1, episode=2)["id"] == 3
    assert debrid.pick_file(FILES, season=1, episode=1)["id"] == 2
    assert debrid.pick_file(FILES, file_idx=2)["id"] == 3  # 0-based, in torrent order
    assert debrid.pick_file(FILES, file_idx=3)["id"] == 2  # .nfo isn't a video: biggest
    assert debrid.pick_file(FILES)["id"] == 2
    assert debrid.pick_file([]) is None


def test_link_for_the_chosen_file():
    info = {"links": ["L2", "L3"], "files": [{**f, "selected": 1 if f["id"] in (2, 3) else 0} for f in FILES]}
    assert debrid.link_for(info, 3) == "L3"
    assert debrid.link_for(info, 2) == "L2"
    assert debrid.link_for(info, 9) is None
    assert debrid.link_for({"links": ["only"], "files": []}, None) == "only"
    assert debrid.link_for({"links": []}, 2) is None


def _rd_transport(state):
    """A tiny fake Real-Debrid: one account, torrents in `state`."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api.real-debrid.com"
        path = request.url.path.removeprefix("/rest/1.0")
        if path == "/torrents":
            items = [{"id": t["id"], "hash": t["hash"], "status": t["status"]} for t in state["torrents"]]
            return httpx.Response(200, json=items) if items else httpx.Response(204)
        if path.startswith("/torrents/info/"):
            tid = path.rsplit("/", 1)[1]
            return httpx.Response(200, json=next(t for t in state["torrents"] if t["id"] == tid))
        if path == "/torrents/addMagnet":
            assert HASH in request.content.decode()
            state["torrents"].insert(0, {"id": "NEW", "hash": HASH, "status": "waiting_files_selection", "files": [dict(f) for f in FILES], "links": []})
            return httpx.Response(201, json={"id": "NEW"})
        if path.startswith("/torrents/delete/"):
            tid = path.rsplit("/", 1)[1]
            state["torrents"] = [t for t in state["torrents"] if t["id"] != tid]
            state.setdefault("deleted", []).append(tid)
            return httpx.Response(204)
        if path.startswith("/torrents/selectFiles/"):
            tid = path.rsplit("/", 1)[1]
            chosen = request.content.decode().split("=", 1)[1]
            state["selected"] = chosen
            t = next(t for t in state["torrents"] if t["id"] == tid)
            for f in t["files"]:
                f["selected"] = 1 if str(f["id"]) == chosen else 0
            t["status"] = "downloading"
            return httpx.Response(204)
        if path == "/unrestrict/link":
            return httpx.Response(200, json={"download": "https://download.real-debrid.com/x/Show.S01E02.mkv", "filename": "Show.S01E02.mkv", "filesize": 900})
        if path == "/user":
            return httpx.Response(200, json={"username": "oz", "type": "premium"})
        return httpx.Response(404, json={"error": "unknown_ressource", "error_code": 7})

    return httpx.MockTransport(handler)


async def _start(state, **kw):
    async with debrid.RealDebrid(KEY, transport=_rd_transport(state)) as rd:
        return await rd.start(HASH, **kw)


def test_start_adds_the_magnet_and_selects_the_episode():
    state = {"torrents": []}
    info, fid = asyncio.run(_start(state, season=1, episode=2))
    assert fid == 3 and state["selected"] == "3"
    assert info["id"] == "NEW" and info["status"] == "downloading"


def test_start_reuses_a_torrent_already_downloading_that_file():
    files = [{**f, "selected": 1 if f["id"] == 2 else 0} for f in FILES]
    state = {"torrents": [{"id": "OLD", "hash": HASH, "status": "downloading", "progress": 12, "files": files, "links": []}]}
    info, fid = asyncio.run(_start(state, filename="Show.S01E01.1080p.mkv"))
    assert info["id"] == "OLD" and fid == 2 and "selected" not in state


def test_start_adds_again_when_the_existing_one_has_another_file():
    files = [{**f, "selected": 1 if f["id"] == 2 else 0} for f in FILES]
    state = {"torrents": [{"id": "OLD", "hash": HASH, "status": "downloaded", "files": files, "links": ["L2"]}]}
    info, fid = asyncio.run(_start(state, season=1, episode=2))
    assert info["id"] == "NEW" and fid == 3


def test_start_replaces_a_dead_torrent_instead_of_reusing_it():
    files = [{**f, "selected": 1 if f["id"] == 2 else 0} for f in FILES]
    state = {"torrents": [{"id": "OLD", "hash": HASH, "status": "dead", "files": files, "links": []}]}

    async def go():
        async with debrid.RealDebrid(KEY, transport=_rd_transport(state)) as rd:
            info, fid = await rd.start(HASH, season=1, episode=1)
            return info, fid, rd.removed

    info, fid, removed = asyncio.run(go())
    assert removed == ["OLD"] and state["deleted"] == ["OLD"]
    assert info["id"] == "NEW" and fid == 2 and info["status"] == "downloading"


def test_magnet_carries_trackers():
    m = debrid.magnet(HASH, ["udp://tracker.example.org:1337/announce", "javascript:alert(1)", "dht:" + HASH])
    assert m.startswith(f"magnet:?xt=urn:btih:{HASH}&tr=udp%3A%2F%2Ftracker.example.org%3A1337%2Fannounce")
    assert "javascript" not in m and "dht" not in m
    assert m.count("&tr=") == 1 + len(debrid.DEFAULT_TRACKERS)


def test_reads_are_retried_once_after_a_hiccup(monkeypatch):
    monkeypatch.setattr(debrid, "RETRY_DELAY", 0)
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(503, json={"error": "service_unavailable", "error_code": 25})
        return httpx.Response(200, json={"username": "oz", "type": "premium"})

    async def go():
        async with debrid.RealDebrid(KEY, transport=httpx.MockTransport(handler)) as rd:
            return await rd.user()

    assert asyncio.run(go())["username"] == "oz" and len(calls) == 2


def test_only_a_rejected_key_counts_as_a_bad_key(monkeypatch):
    monkeypatch.setattr(debrid, "RETRY_DELAY", 0)

    def go(response):
        async def run():
            async with debrid.RealDebrid(KEY, transport=httpx.MockTransport(lambda r: response)) as rd:
                await rd.user()

        with pytest.raises(debrid.DebridError) as err:
            asyncio.run(run())
        return err.value.bad_key

    assert go(httpx.Response(401, json={"error": "bad_token", "error_code": 8})) is True
    assert go(httpx.Response(503, json={"error": "service_unavailable", "error_code": 25})) is False


def test_real_debrid_errors_are_said_in_words():
    def handler(request):
        return httpx.Response(503, json={"error": "too_many_active_downloads", "error_code": 21})

    async def go():
        async with debrid.RealDebrid(KEY, transport=httpx.MockTransport(handler)) as rd:
            await rd.add_magnet(HASH)

    with pytest.raises(debrid.DebridError, match="demasiadas descargas activas"):
        asyncio.run(go())
