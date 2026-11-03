"""The own catalogs as a Stremio addon: /stremio/tmdb/{country}/manifest.json

Installed like any other addon (one per profile, so each profile picks its
country). Public and read-only: only TMDB metadata, no user data.
"""

from urllib.parse import parse_qsl, unquote

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app import tmdb

router = APIRouter(prefix="/stremio/tmdb", tags=["stremio"])

# Any app (Stremio too) may read it; cached by browsers/CDNs for an hour.
HEADERS = {"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600"}


def _check(country: str) -> tuple[str, str]:
    if not tmdb.enabled():
        raise HTTPException(503, "Los catálogos propios no están activados (falta TMDB_API_KEY)")
    info = tmdb.country_info(country)
    if not info:
        raise HTTPException(404, "País no disponible")
    return info


@router.get("/countries.json")
def countries():
    """Countries the addon can be installed for (and whether it's on)."""
    return JSONResponse(
        {"enabled": tmdb.enabled(), "countries": [{"code": c, "name": n} for c, (n, _) in tmdb.COUNTRIES.items()]},
        headers=HEADERS,
    )


@router.get("/suggest.json")
async def suggest(q: str = "", lang: str = "es-419"):
    """Suggestions while typing in a search box. Empty when the catalogs are
    off or nothing matches (the box then just shows no list)."""
    if not tmdb.enabled():
        return JSONResponse({"metas": []}, headers={**HEADERS, "Cache-Control": "public, max-age=300"})
    try:
        metas = await tmdb.suggest(q, lang)
    except tmdb.TmdbError:
        metas = []
    return JSONResponse({"metas": metas}, headers={**HEADERS, "Cache-Control": "public, max-age=300"})


@router.get("/similar/{type_}/{imdb_id}.json")
async def similar(type_: str, imdb_id: str, lang: str = "es-419"):
    """"Títulos similares" on a detail page. Empty when the catalogs are off
    or TMDB doesn't know the title (the page then hides the row)."""
    if not tmdb.enabled():
        return JSONResponse({"metas": []}, headers=HEADERS)
    try:
        metas = await tmdb.similar(type_, imdb_id, lang)
    except tmdb.TmdbError:
        metas = []
    return JSONResponse({"metas": metas}, headers=HEADERS)


@router.get("/{country}/manifest.json")
async def manifest(country: str):
    name, language = _check(country)
    try:
        movie_genres = list(await tmdb.genres("movie", language))
        tv_genres = list(await tmdb.genres("tv", language))
    except tmdb.TmdbError as exc:
        raise HTTPException(502, str(exc)) from exc
    return JSONResponse(
        {
            "id": f"app.aetherio.tmdb.{country.lower()}",
            "version": "1.2.0",
            "name": f"Catálogos AetherIO ({name})",
            "description": (
                f"Qué hay en Netflix, Prime Video, Disney+, Max, Apple TV+ y Paramount+ en {name}, "
                "tendencias, estrenos, búsqueda y fichas en español. Datos de TMDB y JustWatch."
            ),
            "types": ["movie", "series"],
            "resources": ["catalog", {"name": "meta", "types": ["movie", "series"], "idPrefixes": ["tt"]}],
            "idPrefixes": ["tt"],
            # Interleaved by topic (Tendencias: movies, series; Estrenos: …),
            # so Home reads by topic instead of all movies, then all series.
            "catalogs": [c for pair in zip(tmdb.catalog_defs("movie", movie_genres), tmdb.catalog_defs("series", tv_genres)) for c in pair],
            "behaviorHints": {"configurable": False},
        },
        headers=HEADERS,
    )


async def _catalog(country: str, type_: str, catalog_id: str, extra: str = ""):
    _check(country)
    extras = dict(parse_qsl(unquote(extra), keep_blank_values=False))
    try:
        metas = await tmdb.catalog(country, type_, catalog_id, extras)
    except tmdb.TmdbError as exc:
        raise HTTPException(502, str(exc)) from exc
    return JSONResponse({"metas": metas}, headers=HEADERS)


@router.get("/{country}/catalog/{type_}/{catalog_id}.json")
async def catalog(country: str, type_: str, catalog_id: str):
    return await _catalog(country, type_, catalog_id)


@router.get("/{country}/catalog/{type_}/{catalog_id}/{extra}.json")
async def catalog_extra(country: str, type_: str, catalog_id: str, extra: str):
    return await _catalog(country, type_, catalog_id, extra)


@router.get("/{country}/meta/{type_}/{meta_id}.json")
async def meta(country: str, type_: str, meta_id: str):
    _, language = _check(country)
    try:
        data = await tmdb.meta(type_, meta_id, language)
    except tmdb.TmdbError as exc:
        raise HTTPException(502, str(exc)) from exc
    if data is None:
        # Not on TMDB: the app asks the next addon.
        raise HTTPException(404, "Título no encontrado")
    return JSONResponse({"meta": data}, headers=HEADERS)
