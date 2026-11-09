from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.crypto import EncryptedText
from app.database import Base


class User(Base):
    """An account (login). Everything personal — addons, and later history,
    library and preferences — hangs off its profiles, Netflix-style."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    # Parental control PIN (hashed like passwords): needed to allow adult
    # content on a profile and to enter a profile that allows it.
    parental_pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Goes up when the password changes: older login tokens stop working.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Real-Debrid API key (Ajustes), encrypted: lets the app ask for downloads
    # itself and follow them. Per account (one debrid subscription).
    realdebrid_key: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    profiles: Mapped[list["Profile"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", order_by="Profile.id"
    )


class Profile(Base):
    """One person watching under an account. Each profile has its own addons
    (a kids profile can skip the adult/torrent ones) and, from Phase 4 on,
    its own library and history."""

    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(50))
    # Avatar color key (see PROFILE_COLORS in schemas.py); the UI shows the
    # profile's initial on that color.
    color: Mapped[str] = mapped_column(String(20), default="series-1")
    # Preferred content language (BCP 47, see ProfileLanguage in schemas.py).
    # Drives which streams are shown first and the default subtitles.
    language: Mapped[str] = mapped_column(String(10), default="es-419")
    # Settings (see ProfileSettings in schemas.py).
    ui_language: Mapped[str] = mapped_column(String(5), default="es")
    subtitle_language: Mapped[str] = mapped_column(String(10), default="es-419")
    subtitles_mode: Mapped[str] = mapped_column(String(10), default="auto")
    max_quality: Mapped[str] = mapped_column(String(10), default="max")
    # +18 addons, playlists and channels. Off by default; turning it on
    # takes the account's parental PIN.
    adult_content: Mapped[bool] = mapped_column(Boolean, default=False)
    # Profile photo (small square image, cropped by the app). Served publicly
    # at /avatars/{avatar_key}; the random key changes on every upload.
    avatar: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    avatar_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    avatar_key: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="profiles")
    addons: Mapped[list["ProfileAddon"]] = relationship(
        back_populates="profile", cascade="all, delete-orphan", order_by="ProfileAddon.position"
    )
    progress: Mapped[list["WatchProgress"]] = relationship(back_populates="profile", cascade="all, delete-orphan")
    library: Mapped[list["LibraryItem"]] = relationship(back_populates="profile", cascade="all, delete-orphan")
    ratings: Mapped[list["Rating"]] = relationship(back_populates="profile", cascade="all, delete-orphan")
    downloads: Mapped[list["DebridDownload"]] = relationship(back_populates="profile", cascade="all, delete-orphan")
    playlists: Mapped[list["ProfilePlaylist"]] = relationship(
        back_populates="profile", cascade="all, delete-orphan", order_by="ProfilePlaylist.position"
    )


class ProfileAddon(Base):
    """A Stremio addon installed on a profile, identified like Stremio does:
    by its manifest URL ("transport URL"). Configured addons (Torrentio with a
    debrid key, etc.) encode their config in that URL, so the same addon id
    can be installed twice with different configs — hence the uniqueness is
    on the URL, not on the manifest id.

    `manifest` is a cached copy of the raw manifest JSON, refreshed on demand,
    so the app can build catalogs/streams without re-fetching it each time."""

    __tablename__ = "profile_addons"
    __table_args__ = (UniqueConstraint("profile_id", "url_hash", name="uq_profile_addon_url"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    # Encrypted at rest: configured addon URLs carry API keys (app/crypto.py).
    transport_url: Mapped[str] = mapped_column(EncryptedText)
    url_hash: Mapped[str] = mapped_column(String(64))
    manifest: Mapped[dict] = mapped_column(JSONB)
    # Lower = asked first / shown first (catalog rows, stream order), like
    # Stremio's addon order.
    position: Mapped[int] = mapped_column(default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Says itself it's +18 (app/adult.py): only on profiles that allow it.
    adult: Mapped[bool] = mapped_column(Boolean, default=False)
    # Off: its catalogs (rows, Discover, search) are hidden, but it still
    # serves details/streams/subtitles (e.g. Cinemeta as a backup for details).
    show_catalogs: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    installed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    manifest_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    profile: Mapped["Profile"] = relationship(back_populates="addons")


class WatchProgress(Base):
    """How far a profile got in one playable item: a movie, or one episode.
    Powers "Continuar viendo", the history, watched marks and resuming on
    any device (it lives here, not in the browser).

    `video_id` is the Stremio video id ("tt123" for a movie, "tt123:1:2"
    for an episode); `meta_id` the title it belongs to. Name/poster/episode
    info are copied in so the rows can be drawn without asking addons."""

    __tablename__ = "watch_progress"
    __table_args__ = (UniqueConstraint("profile_id", "video_id", name="uq_progress_profile_video"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    meta_id: Mapped[str] = mapped_column(String(255), index=True)
    type: Mapped[str] = mapped_column(String(30))
    video_id: Mapped[str] = mapped_column(String(255))
    position: Mapped[float] = mapped_column(Float, default=0)
    duration: Mapped[float] = mapped_column(Float, default=0)
    watched: Mapped[bool] = mapped_column(Boolean, default=False)
    # "Quitar de Continuar viendo": hidden until it's played again.
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    name: Mapped[str] = mapped_column(String(500))
    poster: Mapped[str | None] = mapped_column(Text, nullable=True)
    season: Mapped[int | None] = mapped_column(Integer, nullable=True)
    episode: Mapped[int | None] = mapped_column(Integer, nullable=True)
    episode_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), index=True
    )

    profile: Mapped["Profile"] = relationship(back_populates="progress")


class ProfilePlaylist(Base):
    """A live TV (IPTV) M3U playlist added to a profile. The browser/app
    downloads and parses it; video goes straight from the channel's server to
    the device. The URL may carry credentials, so it's encrypted at rest."""

    __tablename__ = "profile_playlists"
    __table_args__ = (UniqueConstraint("profile_id", "url_hash", name="uq_profile_playlist_url"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    url: Mapped[str] = mapped_column(EncryptedText)
    url_hash: Mapped[str] = mapped_column(String(64))
    adult: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    profile: Mapped["Profile"] = relationship(back_populates="playlists")


class LibraryItem(Base):
    """"Mi lista": titles a profile saved to watch later. Name/poster are
    copied in so the row can be drawn without asking addons."""

    __tablename__ = "library_items"
    __table_args__ = (UniqueConstraint("profile_id", "meta_id", name="uq_library_profile_meta"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    meta_id: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(500))
    poster: Mapped[str | None] = mapped_column(Text, nullable=True)
    poster_shape: Mapped[str | None] = mapped_column(String(20), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    profile: Mapped["Profile"] = relationship(back_populates="library")


class Rating(Base):
    """No me gusta (-1) / Me gusta (1) / Me encanta (2) on a title, per
    profile. Genres are copied in: "Para ti" learns tastes from them."""

    __tablename__ = "ratings"
    __table_args__ = (UniqueConstraint("profile_id", "meta_id", name="uq_rating_profile_meta"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    meta_id: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(500))
    poster: Mapped[str | None] = mapped_column(Text, nullable=True)
    genres: Mapped[list] = mapped_column(JSONB, default=list)
    rating: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    profile: Mapped["Profile"] = relationship(back_populates="ratings")


class TmdbId(Base):
    """TMDB → IMDb id, for the own catalogs: streams addons (Torrentio…)
    look titles up by IMDb id. imdb_id is null when TMDB has none (checked
    again after a while, see app/tmdb.py)."""

    __tablename__ = "tmdb_ids"

    kind: Mapped[str] = mapped_column(String(6), primary_key=True)  # movie | tv
    tmdb_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    imdb_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DebridDownload(Base):
    """A file this profile asked its debrid to download (Descargas). The
    progress lives in Real-Debrid; this row remembers which torrent/file it
    is and what title it belongs to, so it can be drawn and played later."""

    __tablename__ = "debrid_downloads"
    __table_args__ = (UniqueConstraint("profile_id", "torrent_id", name="uq_download_profile_torrent"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20), default="realdebrid")
    torrent_id: Mapped[str] = mapped_column(String(64))
    infohash: Mapped[str] = mapped_column(String(40), index=True)
    # Chosen file (Real-Debrid file id) and the hints to choose it later
    # when the file list wasn't known yet.
    file_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    filename: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_idx: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Title it belongs to (to draw the row and play it from Descargas).
    type: Mapped[str] = mapped_column(String(30))
    meta_id: Mapped[str] = mapped_column(String(255))
    video_id: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(500))
    poster: Mapped[str | None] = mapped_column(Text, nullable=True)
    season: Mapped[int | None] = mapped_column(Integer, nullable=True)
    episode: Mapped[int | None] = mapped_column(Integer, nullable=True)
    episode_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # The source as the addon described it (name/title/languages; never its URL,
    # which can carry the debrid key).
    source: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    profile: Mapped["Profile"] = relationship(back_populates="downloads")
