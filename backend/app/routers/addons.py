from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import addons_service
from app.adult import is_adult_manifest
from app.auth import get_current_profile
from app.database import get_db
from app.models import Profile, ProfileAddon
from app.schemas import AddonOrderIn, AddonOut, AddonPreviewOut, AddonRefreshIn, AddonUpdate, AddonUrlIn
from app.stremio.client import AddonError, normalize_manifest_url, resolve_manifest

router = APIRouter(prefix="/addons", tags=["addons"])


def _bad_request(exc: AddonError) -> HTTPException:
    code = status.HTTP_403_FORBIDDEN if isinstance(exc, addons_service.AdultNotAllowed) else status.HTTP_400_BAD_REQUEST
    return HTTPException(status_code=code, detail=str(exc))


def _get_owned(db: Session, profile: Profile, addon_id: int) -> ProfileAddon:
    addon = db.get(ProfileAddon, addon_id)
    if addon is None or addon.profile_id != profile.id or (addon.adult and not profile.adult_content):
        raise HTTPException(status_code=404, detail="Addon no encontrado")
    return addon


@router.get("", response_model=list[AddonOut])
def list_addons(profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    q = select(ProfileAddon).where(ProfileAddon.profile_id == profile.id)
    # Adult addons only show up on profiles that allow them.
    if not profile.adult_content:
        q = q.where(ProfileAddon.adult.is_(False))
    return db.scalars(q.order_by(ProfileAddon.position, ProfileAddon.id)).all()


@router.post("/preview", response_model=AddonPreviewOut)
def preview_addon(payload: AddonUrlIn, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    try:
        url = normalize_manifest_url(payload.url)
        _, raw = resolve_manifest(url, payload.manifest)
    except AddonError as exc:
        raise _bad_request(exc) from exc
    return AddonPreviewOut(
        transport_url=url,
        manifest=raw,
        adult=is_adult_manifest(raw),
        already_installed=addons_service.find_by_url(db, profile, url) is not None,
    )


@router.post("", response_model=AddonOut, status_code=status.HTTP_201_CREATED)
def install_addon(payload: AddonUrlIn, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    try:
        return addons_service.install(db, profile, payload.url, payload.manifest)
    except AddonError as exc:
        raise _bad_request(exc) from exc


# Declared before /{addon_id} routes so "order" isn't parsed as an id.
@router.put("/order", response_model=list[AddonOut])
def reorder_addons(payload: AddonOrderIn, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    addons = {a.id: a for a in db.scalars(select(ProfileAddon).where(ProfileAddon.profile_id == profile.id))}
    if not profile.adult_content:
        addons = {i: a for i, a in addons.items() if not a.adult}
    if len(payload.ids) != len(set(payload.ids)) or set(payload.ids) != set(addons):
        raise HTTPException(status_code=400, detail="La lista debe incluir cada addon instalado una sola vez")
    for position, addon_id in enumerate(payload.ids):
        addons[addon_id].position = position
    db.commit()
    return [addons[i] for i in payload.ids]


@router.patch("/{addon_id}", response_model=AddonOut)
def update_addon(
    addon_id: int, payload: AddonUpdate, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)
):
    addon = _get_owned(db, profile, addon_id)
    addon.enabled = payload.enabled
    db.commit()
    db.refresh(addon)
    return addon


@router.post("/{addon_id}/refresh", response_model=AddonOut)
def refresh_addon(
    addon_id: int,
    payload: AddonRefreshIn | None = None,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """Store a fresh copy of the manifest (picks up new catalogs/version)."""
    addon = _get_owned(db, profile, addon_id)
    try:
        _, raw = resolve_manifest(addon.transport_url, payload.manifest if payload else None)
    except AddonError as exc:
        raise _bad_request(exc) from exc
    addon.manifest = raw
    addon.adult = is_adult_manifest(raw)
    addon.manifest_updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(addon)
    return addon


@router.delete("/{addon_id}", status_code=status.HTTP_204_NO_CONTENT)
def uninstall_addon(addon_id: int, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    db.delete(_get_owned(db, profile, addon_id))
    db.commit()
