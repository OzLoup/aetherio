import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import addons_service
from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import Profile, User
from app.parental import check_pin
from app.schemas import ProfileCreate, ProfileOut, ProfileUpdate

router = APIRouter(prefix="/profiles", tags=["profiles"])


def _get_owned(db: Session, user: User, profile_id: int) -> Profile:
    profile = db.get(Profile, profile_id)
    if profile is None or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Perfil no encontrado")
    return profile


def _count(db: Session, user: User) -> int:
    return db.scalar(select(func.count()).select_from(Profile).where(Profile.user_id == user.id)) or 0


@router.get("", response_model=list[ProfileOut])
def list_profiles(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.scalars(select(Profile).where(Profile.user_id == user.id).order_by(Profile.id)).all()


@router.post("", response_model=ProfileOut, status_code=status.HTTP_201_CREATED)
def create_profile(payload: ProfileCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if _count(db, user) >= settings.max_profiles_per_user:
        raise HTTPException(
            status_code=400, detail=f"Puedes tener como máximo {settings.max_profiles_per_user} perfiles"
        )
    source = _get_owned(db, user, payload.copy_addons_from) if payload.copy_addons_from else None
    profile = Profile(
        user_id=user.id,
        name=payload.name,
        color=payload.color,
        language=payload.language,
        ui_language=payload.ui_language,
        # Subtitles follow the audio language by default.
        subtitle_language=payload.language,
    )
    db.add(profile)
    db.flush()
    if source:
        addons_service.copy_addons(db, source, profile)
    db.commit()
    db.refresh(profile)
    return profile


@router.patch("/{profile_id}", response_model=ProfileOut)
def update_profile(
    profile_id: int, payload: ProfileUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    profile = _get_owned(db, user, profile_id)
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    pin = changes.pop("pin", None)
    # Allowing +18 content takes the parental PIN; taking it away doesn't.
    if changes.get("adult_content") and not profile.adult_content:
        check_pin(user, pin)
    for field, value in changes.items():
        setattr(profile, field, value)
    db.commit()
    db.refresh(profile)
    return profile


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(profile_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = _get_owned(db, user, profile_id)
    if _count(db, user) <= 1:
        raise HTTPException(status_code=400, detail="La cuenta necesita al menos un perfil")
    db.delete(profile)
    db.commit()


# ---------- Profile photo ----------

MAX_AVATAR_BYTES = 300_000
# Magic numbers of the formats the app sends (it crops to a small JPEG).
_SIGNATURES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
}


def _image_type(data: bytes) -> str | None:
    for mime, sigs in _SIGNATURES.items():
        if any(data.startswith(sig) for sig in sigs):
            if mime == "image/webp" and data[8:12] != b"WEBP":
                continue
            return mime
    return None


@router.put("/{profile_id}/avatar", response_model=ProfileOut)
async def upload_avatar(
    profile_id: int, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Raw image bytes in the body (already cropped and resized by the app)."""
    profile = _get_owned(db, user, profile_id)
    data = await request.body()
    if not data or len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="La foto debe pesar menos de 300 KB")
    mime = _image_type(data)
    if mime is None:
        raise HTTPException(status_code=400, detail="La foto debe ser JPG, PNG o WebP")
    profile.avatar = data
    profile.avatar_type = mime
    profile.avatar_key = secrets.token_urlsafe(24)
    db.commit()
    db.refresh(profile)
    return profile


@router.delete("/{profile_id}/avatar", response_model=ProfileOut)
def delete_avatar(profile_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = _get_owned(db, user, profile_id)
    profile.avatar = None
    profile.avatar_type = None
    profile.avatar_key = None
    db.commit()
    db.refresh(profile)
    return profile


avatars = APIRouter(tags=["profiles"])


@avatars.get("/avatars/{key}")
def get_avatar(key: str, db: Session = Depends(get_db)):
    """Public (an <img> can't send the login token), but only reachable with
    the unguessable key; a new upload gets a new key, so it caches forever."""
    profile = db.scalar(select(Profile).where(Profile.avatar_key == key))
    if profile is None or not profile.avatar:
        raise HTTPException(status_code=404, detail="Foto no encontrada")
    return Response(
        content=profile.avatar,
        media_type=profile.avatar_type or "image/jpeg",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
        },
    )
