from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.adult import is_adult_manifest
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


def install(db: Session, profile: Profile, raw_url: str, client_manifest: dict | None = None) -> ProfileAddon:
    url = normalize_manifest_url(raw_url)
    if find_by_url(db, profile, url):
        raise AddonError("Ese addon ya está instalado")
    manifest, raw = resolve_manifest(url, client_manifest)
    if manifest.behaviorHints.configurationRequired:
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
            )
        )
