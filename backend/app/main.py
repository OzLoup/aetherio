from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import check_production, settings
from app.routers import addons, auth, debrid, library, playlists, profiles, progress, ratings, stremio_tmdb

if settings.environment == "production" and (problems := check_production(settings)):
    raise RuntimeError("Refusing to start in production: " + "; ".join(problems))

_production = settings.environment == "production"
app = FastAPI(
    title="AetherIO",
    description="AetherIO: reproductor compatible con addons de Stremio.",
    # The interactive API docs are for development only.
    docs_url=None if _production else "/docs",
    redoc_url=None if _production else "/redoc",
    openapi_url=None if _production else "/openapi.json",
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    h = response.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("Referrer-Policy", "no-referrer")
    h.setdefault("X-Frame-Options", "DENY")
    # Answers for a signed-in user (progress, addons with keys in their
    # URLs…) must not sit in shared caches.
    if "authorization" in request.headers and "cache-control" not in h:
        h["Cache-Control"] = "no-store"
    return response


# Catalog/meta JSON (a long series is hundreds of episodes) compresses ~10x.
app.add_middleware(GZipMiddleware, minimum_size=1024)

# Required by Authlib's OAuth state handling during the Google login flow.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.jwt_secret,
    same_site="lax",
    https_only=settings.session_https_only,
    max_age=600,  # only lives through the Google round trip
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, *settings.extra_cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(profiles.router)
app.include_router(profiles.avatars)
app.include_router(addons.router)
app.include_router(progress.router)
app.include_router(playlists.router)
app.include_router(library.router)
app.include_router(ratings.router)
app.include_router(stremio_tmdb.router)
app.include_router(debrid.router)


@app.get("/health")
def health():
    return {"status": "ok"}
