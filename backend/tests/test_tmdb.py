import asyncio

import pytest
from fastapi.testclient import TestClient

from app import tmdb
from app.config import settings
from app.main import app


def test_page_for_tolerates_short_pages():
    assert tmdb.page_for(0) == 1
    assert tmdb.page_for(18) == 2  # page 1 lost two titles without IMDb id
    assert tmdb.page_for(20) == 2
    assert tmdb.page_for(37) == 3


def test_to_meta_localized_fields():
    item = {
        "id": 1, "title": "El Padrino", "poster_path": "/p.jpg", "backdrop_path": "/b.jpg",
        "overview": "Sinopsis", "release_date": "1972-03-14", "vote_average": 8.7, "vote_count": 20000,
    }
    meta = tmdb.to_meta(item, "movie", "tt0068646")
    assert meta["id"] == "tt0068646" and meta["name"] == "El Padrino"
    assert meta["poster"].endswith("/w342/p.jpg") and meta["releaseInfo"] == "1972"
    assert meta["imdbRating"] == "8.7"


def test_catalog_defs_have_platforms_and_sort():
    defs = tmdb.catalog_defs("series", ["Drama"])
    ids = [d["id"] for d in defs]
    assert {"aetherio.trending", "aetherio.new", "aetherio.netflix", "aetherio.max"} <= set(ids)
    netflix = next(d for d in defs if d["id"] == "aetherio.netflix")
    assert {"name": "sort", "options": list(tmdb.SORTS)} in netflix["extra"]


def test_catalog_queries_provider_region_and_sort(monkeypatch):
    calls = []

    async def fake_get(path, **params):
        calls.append((path, params))
        if path.startswith("/genre/"):
            return {"genres": [{"id": 18, "name": "Drama"}]}
        return {"results": [{"id": 1, "name": "Serie A"}, {"id": 2, "name": "Sin IMDb"}]}

    async def fake_ids(kind, ids):
        return {1: "tt1"}

    monkeypatch.setattr(tmdb, "_get", fake_get)
    monkeypatch.setattr(tmdb, "imdb_ids", fake_ids)
    metas = asyncio.run(tmdb.catalog("ar", "series", "aetherio.netflix", {"genre": "Drama", "sort": "recent", "skip": "20"}))

    assert [m["id"] for m in metas] == ["tt1"]  # titles without IMDb id are dropped
    path, params = next(c for c in calls if c[0].startswith("/discover/"))
    assert path == "/discover/tv"
    assert params["with_watch_providers"] == "8" and params["watch_region"] == "AR"
    assert params["language"] == "es-AR" and params["sort_by"] == "first_air_date.desc"
    assert params["with_genres"] == 18 and params["page"] == 2


def test_unknown_country_or_catalog_is_empty():
    assert asyncio.run(tmdb.catalog("XX", "movie", "aetherio.netflix", {})) == []
    assert asyncio.run(tmdb.catalog("MX", "movie", "other.catalog", {})) == []


@pytest.fixture
def client():
    return TestClient(app)


def test_endpoints_off_without_key(client, monkeypatch):
    monkeypatch.setattr(settings, "tmdb_api_key", "")
    assert client.get("/stremio/tmdb/countries.json").json()["enabled"] is False
    assert client.get("/stremio/tmdb/MX/manifest.json").status_code == 503


def test_catalog_endpoint_parses_extras(client, monkeypatch):
    monkeypatch.setattr(settings, "tmdb_api_key", "k")
    seen = {}

    async def fake_catalog(country, type_, catalog_id, extra):
        seen.update(country=country, type=type_, id=catalog_id, extra=extra)
        return [{"id": "tt1", "type": "movie", "name": "A"}]

    monkeypatch.setattr(tmdb, "catalog", fake_catalog)
    res = client.get("/stremio/tmdb/MX/catalog/movie/aetherio.netflix/genre=Acci%C3%B3n&skip=20.json")
    assert res.status_code == 200 and res.headers["access-control-allow-origin"] == "*"
    assert res.json()["metas"][0]["id"] == "tt1"
    assert seen["extra"] == {"genre": "Acción", "skip": "20"}


def test_similar_uses_recommendations_then_similar(monkeypatch):
    calls = []

    async def fake_get(path, **params):
        calls.append((path, params.get("language")))
        if path.startswith("/find/"):
            return {"movie_results": [{"id": 10}]}
        if path.endswith("/recommendations"):
            return {"results": []}  # none: falls back to /similar
        return {"results": [{"id": 10, "title": "Itself"}, {"id": 11, "title": "Otra"}]}

    async def fake_ids(kind, ids):
        return {11: "tt11"}

    monkeypatch.setattr(tmdb, "_get", fake_get)
    monkeypatch.setattr(tmdb, "imdb_ids", fake_ids)
    metas = asyncio.run(tmdb.similar("movie", "tt1", "es-419"))
    assert [m["id"] for m in metas] == ["tt11"]  # the title itself is left out
    assert calls[-1] == ("/movie/10/similar", "es-MX")


def test_similar_endpoint_empty_when_off(client, monkeypatch):
    monkeypatch.setattr(settings, "tmdb_api_key", "")
    res = client.get("/stremio/tmdb/similar/movie/tt1.json")
    assert res.status_code == 200 and res.json() == {"metas": []}


def test_search_catalog_is_search_only():
    defs = tmdb.catalog_defs("movie", [])
    search = next(d for d in defs if d["id"] == "aetherio.search")
    assert search["extra"] == [{"name": "search", "isRequired": True}]


def test_search_queries_tmdb(monkeypatch):
    calls = []

    async def fake_get(path, **params):
        calls.append((path, params))
        return {"results": [{"id": 5, "title": "Matrix"}]}

    async def fake_ids(kind, ids):
        return {5: "tt0133093"}

    monkeypatch.setattr(tmdb, "_get", fake_get)
    monkeypatch.setattr(tmdb, "imdb_ids", fake_ids)
    metas = asyncio.run(tmdb.catalog("MX", "movie", "aetherio.search", {"search": " matrix "}))
    assert metas[0]["id"] == "tt0133093"
    search = next(c for c in calls if c[0].startswith("/search/"))
    assert search[0] == "/search/movie" and search[1]["query"] == "matrix"
    assert asyncio.run(tmdb.catalog("MX", "movie", "aetherio.search", {})) == []


def test_series_meta_lists_episodes(monkeypatch):
    async def fake_get(path, **params):
        if path.startswith("/find/"):
            return {"tv_results": [{"id": 7}]}
        if path == "/tv/7":
            return {"id": 7, "name": "Serie", "first_air_date": "2020-01-01", "in_production": True,
                    "genres": [{"name": "Drama"}], "seasons": [{"season_number": 0}, {"season_number": 1}],
                    "credits": {"cast": [{"name": "Actor"}]}, "created_by": [{"name": "Creadora"}],
                    "videos": {"results": [{"site": "YouTube", "type": "Trailer", "key": "abc"}]}}
        n = int(path.rsplit("/", 1)[1])
        return {"episodes": [{"episode_number": 1, "name": f"Ep S{n}", "air_date": "2020-01-01"}]}

    monkeypatch.setattr(tmdb, "_get", fake_get)
    m = asyncio.run(tmdb.meta("series", "tt9", "es-MX"))
    assert m["releaseInfo"] == "2020–" and m["cast"] == ["Actor"] and m["director"] == ["Creadora"]
    assert m["trailerStreams"][0]["ytId"] == "abc"
    assert [v["id"] for v in m["videos"]] == ["tt9:0:1", "tt9:1:1"]


def test_catalog_items_carry_genre_names(monkeypatch):
    async def fake_get(path, **params):
        if path.startswith("/genre/"):
            return {"genres": [{"id": 28, "name": "Acción"}]}
        return {"results": [{"id": 1, "title": "A", "genre_ids": [28, 99]}]}

    async def fake_ids(kind, ids):
        return {1: "tt1"}

    monkeypatch.setattr(tmdb, "_get", fake_get)
    monkeypatch.setattr(tmdb, "imdb_ids", fake_ids)
    metas = asyncio.run(tmdb.catalog("MX", "movie", "aetherio.trending", {}))
    assert metas[0]["genres"] == ["Acción"]


def test_default_addons(monkeypatch):
    from types import SimpleNamespace

    from app import addons_service

    installed = []

    def fake_install(db, profile, url):
        installed.append(url)
        return SimpleNamespace(show_catalogs=True)

    class FakeDb:
        def commit(self):
            pass

        def rollback(self):
            pass

    monkeypatch.setattr(addons_service, "install", fake_install)
    monkeypatch.setattr(settings, "tmdb_api_key", "k")
    monkeypatch.setattr(settings, "public_url", "https://api.example")
    addons_service.install_defaults(FakeDb(), SimpleNamespace(language="es-ES"))
    assert installed == ["https://api.example/stremio/tmdb/ES/manifest.json", addons_service.CINEMETA_URL]


def test_suggest_mixes_movies_and_series(monkeypatch):
    async def fake_get(path, **params):
        assert path == "/search/multi"
        return {"results": [
            {"id": 1, "media_type": "movie", "title": "Matrix", "release_date": "1999-03-31"},
            {"id": 2, "media_type": "person", "name": "Keanu"},
            {"id": 3, "media_type": "tv", "name": "Matrix: la serie"},
            {"id": 4, "media_type": "movie", "title": "Sin IMDb"},
        ]}

    async def fake_ids(kind, ids):
        return {1: "tt1"} if kind == "movie" else {3: "tt3"}

    monkeypatch.setattr(tmdb, "_get", fake_get)
    monkeypatch.setattr(tmdb, "imdb_ids", fake_ids)
    metas = asyncio.run(tmdb.suggest("matrix", "es-419"))
    assert [(m["id"], m["type"]) for m in metas] == [("tt1", "movie"), ("tt3", "series")]
    assert asyncio.run(tmdb.suggest("m", "es-419")) == []
