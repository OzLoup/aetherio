"""'Mi lista': titles saved per profile, newest first."""

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_profile
from app.database import get_db
from app.models import LibraryItem, Profile
from app.schemas import LibraryItemIn, LibraryItemOut

router = APIRouter(prefix="/library", tags=["library"])

MAX_ITEMS = 500


def _find(db: Session, profile: Profile, meta_id: str) -> LibraryItem | None:
    return db.scalar(select(LibraryItem).where(LibraryItem.profile_id == profile.id, LibraryItem.meta_id == meta_id))


@router.get("", response_model=list[LibraryItemOut])
def list_library(profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    return db.scalars(
        select(LibraryItem)
        .where(LibraryItem.profile_id == profile.id)
        .order_by(LibraryItem.added_at.desc(), LibraryItem.id.desc())
        .limit(MAX_ITEMS)
    ).all()


@router.put("/{meta_id:path}", response_model=LibraryItemOut)
def add_to_library(
    meta_id: str, payload: LibraryItemIn, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)
):
    item = _find(db, profile, meta_id)
    if item is None:
        item = LibraryItem(profile_id=profile.id, meta_id=meta_id[:255])
        db.add(item)
    item.type = payload.type
    item.name = payload.name
    item.poster = payload.poster
    item.poster_shape = payload.poster_shape
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{meta_id:path}", status_code=status.HTTP_204_NO_CONTENT)
def remove_from_library(meta_id: str, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    item = _find(db, profile, meta_id)
    if item is not None:
        db.delete(item)
        db.commit()
