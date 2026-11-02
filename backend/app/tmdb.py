"""Own catalogs from TMDB, served as a Stremio addon (see routers/stremio_tmdb.py).

What's on each streaming platform in a country (TMDB's watch providers,
powered by JustWatch), trending and new releases, with titles and posters in
the country's language. Items carry IMDb ids, which streams addons use.
"""

import asyncio
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.config import settings
from app.database import SessionLocal
from app.models import TmdbId

API = "https://api.themoviedb.org/3"
IMAGES = "https://image.tmdb.org/t/p"
PAGE_SIZE = 20  # TMDB pages are always 20 results
CACHE_SECONDS = 3 * 3600
MISSING_RECHECK = timedelta(days=7)
# "Recent" lists: skip titles nobody has rated yet (shorts, obscure uploads).
MIN_VOTES_RECENT = 10

# Country → TMDB language for titles, overviews and posters.
COUNTRIES: dict[str, tuple[str, str]] = {
    "MX": ("México", "es-MX"),
    "AR": ("Argentina", "es-AR"),
    "CO": ("Colombia", "es-CO"),
    "CL": ("Chile", "es-CL"),
    "PE": ("Perú", "es-PE"),
    "EC": ("Ecuador", "es-EC"),
    "VE": ("Venezuela", "es-VE"),
    "UY": ("Uruguay", "es-UY"),
    "CR": ("Costa Rica", "es-CR"),
    "GT": ("Guatemala", "es-GT"),
    "ES": ("España", "es-ES"),
    "US": ("Estados Unidos", "es-US"),
    "BR": ("Brasil", "pt-BR"),
}

# Platform → TMDB provider ids ("|" = any of them: a service listed under
# old and new names).
PROVIDERS: list[tuple[str, str, str]] = [
    ("netflix", "Netflix", "8"),
    ("prime", "Prime Video", "119|9"),
    ("disney", "Disney+", "337"),
    ("max", "Max", "1899|384"),
    ("apple", "Apple TV+", "350"),
    ("paramount", "Paramount+", "531"),
]
ALL_PROVIDERS = "|".join(ids for _, _, ids in PROVIDERS)

# Stremio type ↔ TMDB kind.
KINDS = {"movie": "movie", "series": "tv"}

# The "sort" extra (Discover's "Ordenar"): our value → TMDB sort_by per kind.
SORTS = {
    "popular": {"movie": "popularity.desc", "tv": "popularity.desc"},
    "recent": {"movie": "primary_release_date.desc", "tv": "first_air_date.desc"},
    "rating": {"movie": "vote_average.desc", "tv": "vote_average.desc"},
    "az": {"movie": "title.asc", "tv": "name.asc"},
}


class TmdbError(Exception):
    pass


def enabled() -> bool:
    return bool(settings.tmdb_api_key)


def country_info(code: str) -> tuple[str, str] | None:
    return COUNTRIES.get(code.upper())


# --- HTTP + cache ---------------------------------------------------------------

_cache: dict[str, tuple[float, Any]] = {}
_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        key = settings.tmdb_api_key
        # A v4 "API Read Access Token" (long JWT) goes in the header; a v3 key as a param.
        bearer = len(key) > 40
        _client = httpx.AsyncClient(
            base_url=API,
            timeout=15,
            headers={"Authorization": f"Bearer {key}"} if bearer else {},
            params={} if bearer else {"api_key": key},
        )
    return _client


async def _get(path: str, **params: Any) -> Any:
    key = f"{path}?{sorted(params.items())}"
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    try:
        res = await _http().get(path, params={k: v for k, v in params.items() if v is not None})
    except httpx.HTTPError as exc:
        raise TmdbError(f"TMDB no responde: {exc}") from exc
    if res.status_code != 200:
        raise TmdbError(f"TMDB respondió {res.status_code}")
    data = res.json()
    if len(_cache) > 2000:
        _cache.clear()
    _cache[key] = (time.monotonic() + CACHE_SECONDS, data)
    return data


async def genres(kind: str, language: str) -> dict[str, int]:
    """Genre name (in that language) → id."""
    data = await _get(f"/genre/{kind}/list", language=language)
    return {g["name"]: g["id"] for g in data.get("genres", [])}


# --- TMDB → IMDb ids ----------------------------------------------------------------


async def imdb_ids(kind: str, tmdb_ids: list[int]) -> dict[int, str]:
    """IMDb id of each title (titles without one are left out). Remembered in
    the database: each title is asked once (unknown ones again after a week)."""
    if not tmdb_ids:
        return {}
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        rows = db.execute(select(TmdbId).where(TmdbId.kind == kind, TmdbId.tmdb_id.in_(tmdb_ids))).scalars().all()
    known = {r.tmdb_id: r for r in rows}
    found = {r.tmdb_id: r.imdb_id for r in rows if r.imdb_id}
    missing = [
        i for i in tmdb_ids
        if i not in known or (known[i].imdb_id is None and now - known[i].updated_at > MISSING_RECHECK)
    ]

    async def one(tmdb_id: int) -> tuple[int, str | None]:
        try:
            data = await _get(f"/{kind}/{tmdb_id}/external_ids")
        except TmdbError:
            return tmdb_id, None
        imdb = data.get("imdb_id")
        return tmdb_id, imdb if isinstance(imdb, str) and imdb.startswith("tt") else None

    if missing:
        results = await asyncio.gather(*(one(i) for i in missing))
        with SessionLocal() as db:
            for tmdb_id, imdb in results:
                stmt = insert(TmdbId).values(kind=kind, tmdb_id=tmdb_id, imdb_id=imdb, updated_at=now)
                db.execute(stmt.on_conflict_do_update(
                    index_elements=["kind", "tmdb_id"], set_={"imdb_id": imdb, "updated_at": now}
                ))
            db.commit()
        found.update({i: imdb for i, imdb in results if imdb})
    return found


# --- catalogs -----------------------------------------------------------------------


def catalog_defs(type_: str, genre_names: list[str]) -> list[dict]:
    """Stremio catalog entries for one type (movie/series)."""
    browse_extra = [
        {"name": "genre", "options": genre_names},
        {"name": "sort", "options": list(SORTS)},
        {"name": "skip"},
    ]
    defs = [
        {"type": type_, "id": "aetherio.trending", "name": "Tendencias", "extra": [{"name": "skip"}]},
        {"type": type_, "id": "aetherio.new", "name": "Estrenos", "extra": [{"name": "genre", "options": genre_names}, {"name": "skip"}]},
    ]
    defs += [{"type": type_, "id": f"aetherio.{key}", "name": name, "extra": browse_extra} for key, name, _ in PROVIDERS]
    return defs


def page_for(skip: int) -> int:
    """Stremio sends how many items it already has; titles without an IMDb
    id are dropped, so pages can come back a bit short of 20."""
    return -(-max(skip, 0) // PAGE_SIZE) + 1


def to_meta(item: dict, type_: str, imdb: str) -> dict:
    name = item.get("title") or item.get("name") or ""
    released = item.get("release_date") or item.get("first_air_date") or ""
    meta = {"id": imdb, "type": type_, "name": name}
    if item.get("poster_path"):
        meta["poster"] = f"{IMAGES}/w342{item['poster_path']}"
    if item.get("backdrop_path"):
        meta["background"] = f"{IMAGES}/w1280{item['backdrop_path']}"
    if item.get("overview"):
        meta["description"] = item["overview"]
    if released[:4].isdigit():
        meta["releaseInfo"] = released[:4]
    if item.get("vote_count", 0) >= 20 and item.get("vote_average"):
        meta["imdbRating"] = f"{item['vote_average']:.1f}"
    return meta


async def catalog(country: str, type_: str, catalog_id: str, extra: dict[str, str]) -> list[dict]:
    info = country_info(country)
    kind = KINDS.get(type_)
    if not info or not kind or not catalog_id.startswith("aetherio."):
        return []
    region, language = country.upper(), info[1]
    key = catalog_id.removeprefix("aetherio.")
    page = page_for(int(extra.get("skip") or 0))
    if page > 500:  # TMDB's limit
        return []

    params: dict[str, Any] = {"language": language, "page": page, "watch_region": region}
    genre = extra.get("genre")
    if genre:
        genre_id = (await genres(kind, language)).get(genre)
        if genre_id is None:
            return []
        params["with_genres"] = genre_id

    if key == "trending":
        data = await _get(f"/trending/{kind}/week", language=language, page=page)
    elif key == "new":
        today = date.today().isoformat()
        since = (date.today() - timedelta(days=120)).isoformat()
        field = "primary_release_date" if kind == "movie" else "first_air_date"
        data = await _get(
            f"/discover/{kind}",
            **params,
            sort_by=SORTS["recent"][kind],
            with_watch_providers=ALL_PROVIDERS,
            with_watch_monetization_types="flatrate",
            **{"vote_count.gte": MIN_VOTES_RECENT},
            **{f"{field}.lte": today, f"{field}.gte": since},
        )
    else:
        provider = next((ids for k, _, ids in PROVIDERS if k == key), None)
        if provider is None:
            return []
        sort = extra.get("sort") if extra.get("sort") in SORTS else "popular"
        params.update(
            sort_by=SORTS[sort][kind],
            with_watch_providers=provider,
            with_watch_monetization_types="flatrate",
        )
        if sort == "rating":
            params["vote_count.gte"] = 200  # not a 10/10 with three votes
        if sort == "recent":
            field = "primary_release_date" if kind == "movie" else "first_air_date"
            params[f"{field}.lte"] = date.today().isoformat()
            params["vote_count.gte"] = MIN_VOTES_RECENT
        data = await _get(f"/discover/{kind}", **params)

    items = [i for i in data.get("results", []) if i.get("id")]
    ids = await imdb_ids(kind, [i["id"] for i in items])
    return [to_meta(i, type_, ids[i["id"]]) for i in items if i["id"] in ids]
