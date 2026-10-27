from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

# ---------- Auth ----------


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str | None = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    name: str | None = None
    has_password: bool = False
    google_linked: bool = False
    has_pin: bool = False


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)


class PasswordChange(BaseModel):
    # Not needed for accounts that only used Google so far.
    current_password: str | None = None
    new_password: str = Field(min_length=8, max_length=200)


# Parental control PIN: 4 to 8 digits.
Pin = Field(pattern=r"^\d{4,8}$")


class PinSet(BaseModel):
    pin: str = Pin
    # Changing an existing PIN takes the current one, or the account password
    # (for a forgotten PIN).
    current_pin: str | None = None
    password: str | None = None


class PinVerify(BaseModel):
    pin: str = Field(max_length=8)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ---------- Profiles ----------

# Avatar colors, matching the --series-N CSS variables in the frontend.
ProfileColor = Literal[
    "series-1", "series-2", "series-3", "series-4", "series-5", "series-6", "series-7", "series-8"
]


# es-419 = español latino, es-ES = castellano.
ProfileLanguage = Literal["es-419", "es-ES", "en", "pt-BR"]
# Language of the app itself.
UiLanguage = Literal["es", "en"]
# auto = on when the audio isn't in my language; always; off.
SubtitlesMode = Literal["auto", "always", "off"]
# Prefer streams up to this quality (slow connections / small screens).
MaxQuality = Literal["max", "1080p", "720p", "480p"]


class _ProfileName(BaseModel):
    @field_validator("name", check_fields=False)
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("El nombre no puede estar vacío")
        return v


class ProfileCreate(_ProfileName):
    name: str = Field(min_length=1, max_length=50)
    color: ProfileColor = "series-1"
    language: ProfileLanguage = "es-419"
    ui_language: UiLanguage = "es"
    # Start with the same addons as this other profile of the account.
    copy_addons_from: int | None = None


class ProfileUpdate(_ProfileName):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    color: ProfileColor | None = None
    language: ProfileLanguage | None = None
    ui_language: UiLanguage | None = None
    subtitle_language: ProfileLanguage | None = None
    subtitles_mode: SubtitlesMode | None = None
    max_quality: MaxQuality | None = None
    adult_content: bool | None = None
    # Required to turn adult_content on.
    pin: str | None = Field(default=None, max_length=8)


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str
    language: str
    ui_language: str
    subtitle_language: str
    subtitles_mode: str
    max_quality: str
    adult_content: bool = False


# ---------- Addons ----------


class AddonUrlIn(BaseModel):
    url: str = Field(min_length=1, max_length=4096)
    # Manifest as downloaded by the browser. When missing, the backend
    # downloads it itself (fallback; some addons block server requests).
    manifest: dict | None = None


class AddonRefreshIn(BaseModel):
    manifest: dict | None = None


class AddonPreviewOut(BaseModel):
    """What an addon would look like if installed — shown in the install
    dialog so the user can confirm before adding it."""

    transport_url: str
    manifest: dict
    already_installed: bool
    # +18 addon: installable only on profiles that allow adult content.
    adult: bool = False


class AddonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    transport_url: str
    manifest: dict
    position: int
    enabled: bool
    adult: bool = False
    installed_at: datetime
    manifest_updated_at: datetime


class AddonUpdate(BaseModel):
    enabled: bool


class AddonOrderIn(BaseModel):
    """Every installed addon id, in the new order."""

    ids: list[int]


# ---------- Watch progress ----------


class ProgressItem(BaseModel):
    """What identifies a title for the progress rows (copied in so rows can
    be drawn without asking addons)."""

    meta_id: str = Field(min_length=1, max_length=255)
    type: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=500)
    poster: str | None = Field(default=None, max_length=4096)


class EpisodeInfo(BaseModel):
    video_id: str = Field(min_length=1, max_length=255)
    season: int | None = None
    episode: int | None = None
    episode_title: str | None = Field(default=None, max_length=500)


class ProgressIn(ProgressItem):
    position: float = Field(ge=0)
    duration: float = Field(ge=0)
    season: int | None = None
    episode: int | None = None
    episode_title: str | None = Field(default=None, max_length=500)


class WatchedIn(ProgressItem):
    """Mark one or many videos (a whole season) as watched / not watched."""

    watched: bool
    videos: list[EpisodeInfo] = Field(min_length=1, max_length=500)


class ProgressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    video_id: str
    meta_id: str
    type: str
    name: str
    poster: str | None
    season: int | None
    episode: int | None
    episode_title: str | None
    position: float
    duration: float
    watched: bool
    updated_at: datetime


# ---------- IPTV playlists ----------


class PlaylistIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=1, max_length=4096)


class PlaylistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    url: str
    adult: bool
    position: int
    created_at: datetime
