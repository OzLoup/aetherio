"""No me gusta / Me gusta / Me encanta, per profile (feeds "Para ti")."""

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_profile
from app.database import get_db
from app.models import Profile, Rating
from app.schemas import RatingIn, RatingOut

router = APIRouter(prefix="/ratings", tags=["ratings"])

MAX_RATINGS = 2000


def _find(db: Session, profile: Profile, meta_id: str) -> Rating | None:
    return db.scalar(select(Rating).where(Rating.profile_id == profile.id, Rating.meta_id == meta_id))


@router.get("", response_model=list[RatingOut])
def list_ratings(profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    return db.scalars(
        select(Rating).where(Rating.profile_id == profile.id).order_by(Rating.updated_at.desc()).limit(MAX_RATINGS)
    ).all()


@router.put("/{meta_id:path}", response_model=RatingOut)
def rate(meta_id: str, payload: RatingIn, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    item = _find(db, profile, meta_id)
    if item is None:
        item = Rating(profile_id=profile.id, meta_id=meta_id[:255])
        db.add(item)
    item.rating = payload.rating
    item.type = payload.type
    item.name = payload.name
    item.poster = payload.poster
    item.genres = [g[:60] for g in payload.genres]
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{meta_id:path}", status_code=status.HTTP_204_NO_CONTENT)
def unrate(meta_id: str, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    item = _find(db, profile, meta_id)
    if item is not None:
        db.delete(item)
        db.commit()
