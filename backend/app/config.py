from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # "production" turns on the startup safety checks (see check_production).
    environment: str = "development"

    # Database
    database_url: str = "postgresql+psycopg://aetherio:aetherio@localhost:5433/aetherio"

    # Encrypts secrets at rest (addon URLs with API keys). Fernet key; see app/crypto.py.
    data_encryption_key: str = ""

    # JWT
    jwt_secret: str = "change-me-in-.env"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    # Google OAuth (create credentials at https://console.cloud.google.com/apis/credentials)
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/auth/google/callback"

    # Frontend URL (for redirect after Google login, and CORS)
    frontend_url: str = "http://localhost:5173"
    # Other origins allowed by CORS: the macOS app serves its UI from app://ui.
    extra_cors_origins: list[str] = ["app://ui"]
    # Where the macOS app receives the Google login result (custom URL scheme
    # registered by the app).
    desktop_auth_redirect: str = "aetherio://auth/callback"
    # Cookie for the OAuth handshake: True in production (HTTPS only).
    session_https_only: bool = False

    # Addon manifest fetching
    addon_allow_private_hosts: bool = False
    addon_fetch_timeout_seconds: float = 10.0
    addon_manifest_max_bytes: int = 1_000_000

    # Max profiles per account (Netflix uses 5).
    max_profiles_per_user: int = 5


settings = Settings()


def check_production(s: Settings) -> list[str]:
    """Problems that must not reach a public server. Empty = fine."""
    problems = []
    if s.jwt_secret in ("", "change-me-in-.env", "replace-with-a-long-random-string") or len(s.jwt_secret) < 32:
        problems.append("JWT_SECRET must be a long random value")
    if not s.data_encryption_key:
        problems.append("DATA_ENCRYPTION_KEY is required (encrypts addon URLs with API keys)")
    if s.addon_allow_private_hosts:
        problems.append("ADDON_ALLOW_PRIVATE_HOSTS must be false (SSRF protection)")
    if not s.session_https_only:
        problems.append("SESSION_HTTPS_ONLY must be true")
    if s.frontend_url.startswith("http://"):
        problems.append("FRONTEND_URL must be https")
    return problems
