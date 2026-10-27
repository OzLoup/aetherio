from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import check_production, settings
from app.routers import addons, auth, playlists, profiles, progress

if settings.environment == "production" and (problems := check_production(settings)):
    raise RuntimeError("Refusing to start in production: " + "; ".join(problems))

app = FastAPI(title="AetherIO", description="AetherIO: reproductor compatible con addons de Stremio.")

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
app.include_router(addons.router)
app.include_router(progress.router)
app.include_router(playlists.router)


@app.get("/health")
def health():
    return {"status": "ok"}
