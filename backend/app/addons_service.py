from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import debrid_addons
from app.adult import is_adult_manifest
from app.config import settings
from app.crypto import url_hash
from app.models import Profile, ProfileAddon
from app.stremio.client import AddonError, normalize_manifest_url, resolve_manifest


class AdultNotAllowed(AddonError):
    def __init__(self) -> None:
        super().__init__(
            "Este contenido es para adultos. Actívalo en Ajustes → Control parental de este perfil para instalarlo aquí."
        )


def _next_position(db: Session, profile: Profile) -> int:
    current = db.scalar(select(func.max(ProfileAddon.position)).where(ProfileAddon.profile_id == profile.id))
    return 0 if current is None else current + 1


def find_by_url(db: Session, profile: Profile, transport_url: str) -> ProfileAddon | None:
    return db.scalar(
        select(ProfileAddon).where(
            ProfileAddon.profile_id == profile.id, ProfileAddon.url_hash == url_hash(transport_url)
        )
    )


CINEMETA_URL = "https://v3-cinemeta.strem.io/manifest.json"
# Profile language → country of the own catalogs installed by default.
DEFAULT_COUNTRY = {"es-419": "MX", "es-ES": "ES", "pt-BR": "BR", "en": "US"}


def install_defaults(db: Session, profile: Profile) -> None:
    """New profiles start with metadata only (never streams): the own
    catalogs (catalogs, search and details in the profile's language) and
    Cinemeta below them as a backup for details, its catalogs hidden so
    nothing shows twice. An addon that can't be reached is just skipped."""
    from app import tmdb  # avoid an import cycle at startup

    wanted: list[tuple[str, bool]] = []
    if tmdb.enabled():
        country = DEFAULT_COUNTRY.get(profile.language, "MX")
        wanted.append((f"{settings.public_url.rstrip('/')}/stremio/tmdb/{country}/manifest.json", True))
    # Without the own catalogs, Cinemeta keeps its catalogs and search.
    wanted.append((CINEMETA_URL, not wanted))
    for url, show_catalogs in wanted:
        try:
            addon = install(db, profile, url)
        except Exception:  # noqa: BLE001 - a default addon is never worth failing the profile
            db.rollback()
            continue
        if addon.show_catalogs != show_catalogs:
            addon.show_catalogs = show_catalogs
            db.commit()


def keyed_url(profile: Profile, url: str, manifest: dict | None) -> tuple[str, bool]:
    """Torrentio/Comet take the account's Real-Debrid key in their URL, so
    nobody needs their configure page. (url, whether the key was put in)."""
    key = profile.user.realdebrid_key
    addon_kind = debrid_addons.kind(url, manifest)
    if not key or not addon_kind:
        return url, False
    return debrid_addons.with_key(url, addon_kind, key), True


def install(db: Session, profile: Profile, raw_url: str, client_manifest: dict | None = None) -> ProfileAddon:
    url, keyed = keyed_url(profile, normalize_manifest_url(raw_url), client_manifest)
    if find_by_url(db, profile, url):
        raise AddonError("Ese addon ya está instalado")
    manifest, raw = resolve_manifest(url, client_manifest)
    if manifest.behaviorHints.configurationRequired and not keyed:
        raise AddonError(
            "Este addon necesita configurarse antes de instalarse. Ábrelo en su página de "
            "configuración y copia la URL que te da."
        )
    adult = is_adult_manifest(raw)
    if adult and not profile.adult_content:
        raise AdultNotAllowed()
    addon = ProfileAddon(
        profile_id=profile.id,
        transport_url=url,
        url_hash=url_hash(url),
        manifest=raw,
        position=_next_position(db, profile),
        adult=adult,
    )
    db.add(addon)
    db.commit()
    db.refresh(addon)
    return addon


def copy_addons(db: Session, source: Profile, target: Profile) -> None:
    """Give `target` the same addons as `source` (same order and on/off
    state). Adult addons stay on their profile: they're never copied."""
    for addon in source.addons:
        if addon.adult:
            continue
        db.add(
            ProfileAddon(
                profile_id=target.id,
                transport_url=addon.transport_url,
                url_hash=addon.url_hash,
                manifest=addon.manifest,
                position=addon.position,
                enabled=addon.enabled,
                show_catalogs=addon.show_catalogs,
            )
        )


def apply_debrid_key(db: Session, user, key: str | None) -> int:
    """Set (or remove, with None) the account's Real-Debrid key in every
    Torrentio/Comet installed on its profiles. Returns how many changed.
    The cached manifest is kept: only the name and debrid catalogs (hidden
    anyway) differ, and Torrentio refuses requests from servers."""
    changed = 0
    for profile in user.profiles:
        taken = {addon.url_hash for addon in profile.addons}
        for addon in profile.addons:
            addon_kind = debrid_addons.kind(addon.transport_url, addon.manifest)
            if not addon_kind:
                continue
            new_url = debrid_addons.with_key(addon.transport_url, addon_kind, key)
            new_hash = url_hash(new_url)
            if new_url == addon.transport_url or new_hash in taken:
                continue  # already right, or would duplicate another install
            taken.discard(addon.url_hash)
            taken.add(new_hash)
            addon.transport_url = new_url
            addon.url_hash = new_hash
            changed += 1
    db.commit()
    return changed
