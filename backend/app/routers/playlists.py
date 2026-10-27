"""Live TV (IPTV) M3U playlists of a profile. The client downloads and
parses them itself; `/content` is a fallback for servers that don't allow
web pages to read them (it only relays the text list, never video)."""

from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.adult import is_adult_text
from app.auth import get_current_profile
from app.crypto import url_hash
from app.database import get_db
from app.models import Profile, ProfilePlaylist
from app.schemas import PlaylistIn, PlaylistOut
from app.stremio.client import AddonError, safe_get

router = APIRouter(prefix="/playlists", tags=["playlists"])

MAX_PLAYLIST_BYTES = 15_000_000
MAX_PLAYLISTS = 20


def _visible(profile: Profile):
    q = select(ProfilePlaylist).where(ProfilePlaylist.profile_id == profile.id)
    # A profile without adult content doesn't even see adult lists.
    if not profile.adult_content:
        q = q.where(ProfilePlaylist.adult.is_(False))
    return q.order_by(ProfilePlaylist.position, ProfilePlaylist.id)


def _get_owned(db: Session, profile: Profile, playlist_id: int) -> ProfilePlaylist:
    p = db.get(ProfilePlaylist, playlist_id)
    if p is None or p.profile_id != profile.id or (p.adult and not profile.adult_content):
        raise HTTPException(status_code=404, detail="Lista no encontrada")
    return p


def _clean_url(raw: str) -> str:
    url = raw.strip()
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise HTTPException(status_code=400, detail="La URL de la lista debe empezar con http:// o https://")
    return url


@router.get("", response_model=list[PlaylistOut])
def list_playlists(profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    return db.scalars(_visible(profile)).all()


@router.post("", response_model=PlaylistOut, status_code=status.HTTP_201_CREATED)
def add_playlist(payload: PlaylistIn, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    url = _clean_url(payload.url)
    h = url_hash(url)
    count = db.scalar(select(func.count()).select_from(ProfilePlaylist).where(ProfilePlaylist.profile_id == profile.id))
    if (count or 0) >= MAX_PLAYLISTS:
        raise HTTPException(status_code=400, detail=f"Puedes tener como máximo {MAX_PLAYLISTS} listas")
    if db.scalar(select(ProfilePlaylist).where(ProfilePlaylist.profile_id == profile.id, ProfilePlaylist.url_hash == h)):
        raise HTTPException(status_code=400, detail="Esa lista ya está agregada")
    adult = is_adult_text(payload.name, url)
    if adult and not profile.adult_content:
        raise HTTPException(
            status_code=403,
            detail="Esta lista es para adultos. Actívalo en Ajustes → Control parental de este perfil para agregarla aquí.",
        )
    current = db.scalar(select(func.max(ProfilePlaylist.position)).where(ProfilePlaylist.profile_id == profile.id))
    playlist = ProfilePlaylist(
        profile_id=profile.id,
        name=payload.name.strip(),
        url=url,
        url_hash=h,
        adult=adult,
        position=0 if current is None else current + 1,
    )
    db.add(playlist)
    db.commit()
    db.refresh(playlist)
    return playlist


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_playlist(playlist_id: int, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    db.delete(_get_owned(db, profile, playlist_id))
    db.commit()


@router.get("/{playlist_id}/content")
def playlist_content(playlist_id: int, profile: Profile = Depends(get_current_profile), db: Session = Depends(get_db)):
    playlist = _get_owned(db, profile, playlist_id)
    try:
        body = safe_get(playlist.url, MAX_PLAYLIST_BYTES, too_big="La lista es demasiado grande")
    except AddonError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(content=body, media_type="text/plain; charset=utf-8")
