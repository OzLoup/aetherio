from fastapi import APIRouter, Depends, HTTPException, status
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
