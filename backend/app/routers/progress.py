"""Watch progress of the current profile (header X-Profile-Id)."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.auth import get_current_profile
from app.database import get_db
from app.models import Profile, WatchProgress
from app.schemas import ProgressIn, ProgressOut, WatchedIn

router = APIRouter(prefix="/progress", tags=["progress"])

# Past this share of the runtime (end credits) it counts as watched.
WATCHED_AT = 0.9
# Less than this and it was just a peek: not worth a "Continuar viendo".
MIN_POSITION = 30


def _upsert(db: Session, values: dict) -> None:
    stmt = insert(WatchProgress).values(**values)
    update_cols = {k: stmt.excluded[k] for k in values if k not in ("profile_id", "video_id")}
    update_cols["updated_at"] = func.now()
    db.execute(stmt.on_conflict_do_update(constraint="uq_progress_profile_video", set_=update_cols))


@router.put("/video/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
def save_progress(
    video_id: str, payload: ProgressIn, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)
):
    """Called by the player: on pause, on leaving, and about once a minute."""
    watched = payload.duration > 0 and payload.position / payload.duration >= WATCHED_AT
    _upsert(
        db,
        {
            "profile_id": profile.id,
            "video_id": video_id,
            **payload.model_dump(),
            "watched": watched,
            # Finished: next time it starts from the beginning.
            "position": 0 if watched else payload.position,
            "hidden": False,
        },
    )
    db.commit()


@router.get("/video/{video_id}", response_model=ProgressOut | None)
def get_video_progress(video_id: str, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    return db.scalar(
        select(WatchProgress).where(WatchProgress.profile_id == profile.id, WatchProgress.video_id == video_id)
    )


@router.delete("/video/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_video_progress(video_id: str, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    """Remove one entry from the history."""
    row = db.scalar(
        select(WatchProgress).where(WatchProgress.profile_id == profile.id, WatchProgress.video_id == video_id)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="No está en tu historial")
    db.delete(row)
    db.commit()


@router.get("/meta/{meta_id}", response_model=list[ProgressOut])
def get_meta_progress(meta_id: str, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    """Every episode (or the movie) of one title: watched marks + positions."""
    return db.scalars(
        select(WatchProgress).where(WatchProgress.profile_id == profile.id, WatchProgress.meta_id == meta_id)
    ).all()


@router.post("/watched", status_code=status.HTTP_204_NO_CONTENT)
def mark_watched(payload: WatchedIn, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    """Mark one video or a whole season as watched / not watched."""
    for v in payload.videos:
        _upsert(
            db,
            {
                "profile_id": profile.id,
                "video_id": v.video_id,
                "meta_id": payload.meta_id,
                "type": payload.type,
                "name": payload.name,
                "poster": payload.poster,
                "season": v.season,
                "episode": v.episode,
                "episode_title": v.episode_title,
                "watched": payload.watched,
                "position": 0,
            },
        )
    db.commit()


@router.post("/meta/{meta_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
def dismiss(meta_id: str, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    """"Quitar de Continuar viendo" (watched marks and history stay)."""
    db.execute(
        update(WatchProgress)
        .where(WatchProgress.profile_id == profile.id, WatchProgress.meta_id == meta_id)
        .values(hidden=True)
    )
    db.commit()


@router.get("/continue", response_model=list[ProgressOut])
def continue_watching(
    limit: int = Query(default=20, ge=1, le=50),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """Latest entry per title, newest first. A finished series episode is
    included (the client offers the next one); a finished movie is not."""
    latest = (
        select(WatchProgress.id, func.row_number().over(
            partition_by=WatchProgress.meta_id,
            # Same instant (a season marked at once): the furthest episode.
            order_by=(
                WatchProgress.updated_at.desc(),
                WatchProgress.season.desc().nulls_last(),
                WatchProgress.episode.desc().nulls_last(),
            ),
        ).label("rn"))
        .where(WatchProgress.profile_id == profile.id)
        .subquery()
    )
    rows = db.scalars(
        select(WatchProgress)
        .join(latest, latest.c.id == WatchProgress.id)
        .where(latest.c.rn == 1, WatchProgress.hidden.is_(False))
        .order_by(WatchProgress.updated_at.desc())
    ).all()
    result = []
    for r in rows:
        if r.watched and r.type == "movie":
            continue
        if not r.watched and r.position < MIN_POSITION:
            continue
        result.append(r)
        if len(result) >= limit:
            break
    return result


@router.get("/history", response_model=list[ProgressOut])
def history(
    limit: int = Query(default=100, ge=1, le=500),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    return db.scalars(
        select(WatchProgress)
        .where(
            WatchProgress.profile_id == profile.id,
            (WatchProgress.position >= MIN_POSITION) | WatchProgress.watched.is_(True),
        )
        .order_by(WatchProgress.updated_at.desc())
        .limit(limit)
    ).all()
