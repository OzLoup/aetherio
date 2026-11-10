"""Debrid: the account's Real-Debrid key, the downloads a profile asks for
(Descargas) and their live progress.

The key is saved encrypted per account and only sent to api.real-debrid.com
(fixed host). Progress always comes live from Real-Debrid; our table only
remembers which torrent/file belongs to which title.
"""

import time

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import debrid
from app.auth import get_current_profile, get_current_user
from app.database import get_db
from app.models import DebridDownload, Profile, User
from app.ratelimit import SlidingWindow, too_many

router = APIRouter(prefix="/debrid", tags=["debrid"])

# Pages poll every few seconds; this is plenty and keeps the app from
# being used to hammer Real-Debrid (it allows ~250 requests/min per key).
_per_user = SlidingWindow(limit=90, seconds=60)
MAX_DOWNLOADS = 200
# Torrent list per account, reused for a few seconds: Streams and
# Descargas may both be polling.
_LIST_TTL = 4.0
_list_cache: dict[int, tuple[float, list[dict]]] = {}


def _limit(user: User) -> None:
    key = str(user.id)
    if _per_user.blocked(key):
        raise too_many()
    _per_user.hit(key)


def _key(user: User) -> str:
    if not user.realdebrid_key:
        raise HTTPException(status_code=409, detail="Conecta tu cuenta de Real-Debrid en Ajustes")
    return user.realdebrid_key


def _bad_gateway(exc: debrid.DebridError) -> HTTPException:
    return HTTPException(status_code=502, detail=str(exc))


async def _torrents(user: User, rd: debrid.RealDebrid, fresh: bool = False) -> list[dict]:
    hit = _list_cache.get(user.id)
    if hit and not fresh and time.monotonic() - hit[0] < _LIST_TTL:
        return hit[1]
    items = await rd.torrents()
    if len(_list_cache) > 5000:
        _list_cache.clear()
    _list_cache[user.id] = (time.monotonic(), items)
    return items


# --- Account ---------------------------------------------------------------


class AccountIn(BaseModel):
    key: str = Field(min_length=20, max_length=200, pattern=r"^[A-Za-z0-9]+$")


def _account_out(info: dict) -> dict:
    return {
        "connected": True,
        "valid": True,
        "username": info.get("username"),
        "premium": info.get("type") == "premium",
        "expiration": info.get("expiration"),
    }


@router.get("/account")
async def get_account(user: User = Depends(get_current_user)):
    if not user.realdebrid_key:
        return {"connected": False}
    _limit(user)
    try:
        async with debrid.RealDebrid(user.realdebrid_key) as rd:
            return _account_out(await rd.user())
    except debrid.DebridError as exc:
        # A passing Real-Debrid failure isn't a bad key: the app keeps using it.
        return {"connected": True, "valid": False if exc.bad_key else None, "error": str(exc)}


@router.put("/account")
async def set_account(payload: AccountIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Checks the key with Real-Debrid before saving it."""
    _limit(user)
    try:
        async with debrid.RealDebrid(payload.key) as rd:
            info = await rd.user()
    except debrid.DebridError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    user.realdebrid_key = payload.key
    db.commit()
    _list_cache.pop(user.id, None)
    return _account_out(info)


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.realdebrid_key = None
    db.commit()
    _list_cache.pop(user.id, None)


# --- Downloads -------------------------------------------------------------


class DownloadIn(BaseModel):
    infohash: str = Field(pattern=r"^[A-Fa-f0-9]{40}$")
    file_idx: int | None = Field(default=None, ge=0, le=100_000)
    filename: str | None = Field(default=None, max_length=1000)
    # The addon's trackers for this torrent (only tracker URLs are used).
    trackers: list[str] = Field(default_factory=list, max_length=50)
    type: str = Field(min_length=1, max_length=30)
    meta_id: str = Field(min_length=1, max_length=255)
    video_id: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=500)
    poster: str | None = Field(default=None, max_length=2000)
    season: int | None = None
    episode: int | None = None
    episode_title: str | None = Field(default=None, max_length=500)
    # name/title/description/languages of the source, for display and the player.
    source: dict = Field(default_factory=dict)


def _clean_source(source: dict) -> dict:
    """Only what we draw; never a URL (it can carry the debrid key)."""
    out: dict = {}
    for k in ("name", "title", "description", "headline", "quality", "size"):
        v = source.get(k)
        if isinstance(v, str):
            out[k] = v[:2000]
    langs = source.get("languages")
    if isinstance(langs, list):
        out["languages"] = [str(x)[:20] for x in langs[:10]]
    hints = source.get("behaviorHints")
    if isinstance(hints, dict):
        keep = {k: hints[k] for k in ("filename", "videoSize", "bingeGroup", "notWebReady") if k in hints}
        if keep:
            out["behaviorHints"] = keep
    return out


def _out(row: DebridDownload, live: dict | None) -> dict:
    return {
        "id": row.id,
        "infohash": row.infohash,
        "type": row.type,
        "meta_id": row.meta_id,
        "video_id": row.video_id,
        "name": row.name,
        "poster": row.poster,
        "season": row.season,
        "episode": row.episode,
        "episode_title": row.episode_title,
        "source": row.source or {},
        "created_at": row.created_at.isoformat() if row.created_at else None,
        # No live data: Real-Debrid no longer has it (deleted there).
        **(live if live is not None else {"status": "removed", "progress": 0, "speed": 0, "seeders": None, "ready": False, "failed": True}),
    }


async def _finish_selection(rd: debrid.RealDebrid, row: DebridDownload, info: dict) -> dict:
    """The magnet was still being read when it was added: pick the file now."""
    if info.get("status") != "waiting_files_selection":
        return info
    file = debrid.pick_file(info.get("files") or [], row.filename, row.file_idx, row.season, row.episode)
    if not file:
        return info
    row.file_id = int(file["id"])
    await rd.select_files(row.torrent_id, [row.file_id])
    return await rd.info(row.torrent_id)


def _rows(db: Session, profile: Profile) -> list[DebridDownload]:
    return list(
        db.scalars(
            select(DebridDownload)
            .where(DebridDownload.profile_id == profile.id)
            .order_by(DebridDownload.created_at.desc(), DebridDownload.id.desc())
            .limit(MAX_DOWNLOADS)
        )
    )


def _row(db: Session, profile: Profile, download_id: int) -> DebridDownload:
    row = db.get(DebridDownload, download_id)
    if row is None or row.profile_id != profile.id:
        raise HTTPException(status_code=404, detail="Descarga no encontrada")
    return row


@router.post("/downloads", status_code=status.HTTP_201_CREATED)
async def start_download(
    payload: DownloadIn,
    user: User = Depends(get_current_user),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """Ask Real-Debrid to download this source (or reuse the torrent if it's
    already in the account) and remember it in Descargas."""
    _limit(user)
    key = _key(user)
    infohash = payload.infohash.lower()
    try:
        async with debrid.RealDebrid(key) as rd:
            info, file_id = await rd.start(
                infohash,
                payload.filename,
                payload.file_idx,
                payload.season,
                payload.episode,
                trackers=[t[:500] for t in payload.trackers],
            )
            removed = rd.removed
    except debrid.DebridError as exc:
        raise _bad_gateway(exc) from exc
    _list_cache.pop(user.id, None)
    torrent_id = str(info["id"])
    # The failed torrent was replaced: drop its entry from Descargas.
    if removed:
        for old in db.scalars(
            select(DebridDownload).where(DebridDownload.profile_id == profile.id, DebridDownload.torrent_id.in_(removed))
        ):
            db.delete(old)
        db.flush()
    row = db.scalar(
        select(DebridDownload).where(DebridDownload.profile_id == profile.id, DebridDownload.torrent_id == torrent_id)
    )
    if row is None:
        row = DebridDownload(profile_id=profile.id, torrent_id=torrent_id)
        db.add(row)
    row.infohash = infohash
    row.file_id = file_id
    row.filename = payload.filename
    row.file_idx = payload.file_idx
    row.type = payload.type
    row.meta_id = payload.meta_id
    row.video_id = payload.video_id
    row.name = payload.name
    row.poster = payload.poster
    row.season = payload.season
    row.episode = payload.episode
    row.episode_title = payload.episode_title
    row.source = _clean_source(payload.source)
    db.commit()
    db.refresh(row)
    return _out(row, debrid.summary(info))


@router.get("/downloads")
async def list_downloads(
    user: User = Depends(get_current_user),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    rows = _rows(db, profile)
    if not rows:
        return []
    _limit(user)
    try:
        async with debrid.RealDebrid(_key(user)) as rd:
            by_id = {str(t["id"]): t for t in await _torrents(user, rd)}
            out = []
            changed = False
            for row in rows:
                t = by_id.get(row.torrent_id)
                if t is not None and t.get("status") == "waiting_files_selection":
                    t = await _finish_selection(rd, row, await rd.info(row.torrent_id))
                    changed = True
                out.append(_out(row, debrid.summary(t) if t is not None else None))
    except debrid.DebridError as exc:
        raise _bad_gateway(exc) from exc
    if changed:
        db.commit()
        _list_cache.pop(user.id, None)
    return out


@router.get("/downloads/{download_id}")
async def get_download(
    download_id: int,
    user: User = Depends(get_current_user),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    row = _row(db, profile, download_id)
    _limit(user)
    try:
        async with debrid.RealDebrid(_key(user)) as rd:
            try:
                info = await rd.info(row.torrent_id)
            except debrid.DebridError:
                # Deleted on Real-Debrid's side (404 there).
                return _out(row, None)
            before = row.file_id
            info = await _finish_selection(rd, row, info)
    except debrid.DebridError as exc:
        raise _bad_gateway(exc) from exc
    if row.file_id != before:
        db.commit()
    return _out(row, debrid.summary(info))


@router.post("/downloads/{download_id}/play")
async def play_download(
    download_id: int,
    user: User = Depends(get_current_user),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """A direct link to the downloaded file (Real-Debrid "unrestrict")."""
    row = _row(db, profile, download_id)
    _limit(user)
    try:
        async with debrid.RealDebrid(_key(user)) as rd:
            info = await rd.info(row.torrent_id)
            if info.get("status") != "downloaded":
                raise HTTPException(status_code=409, detail="Todavía se está descargando")
            link = debrid.link_for(info, row.file_id)
            if not link:
                raise HTTPException(status_code=409, detail="No encontramos el archivo dentro de esta descarga")
            data = await rd.unrestrict(link)
    except debrid.DebridError as exc:
        raise _bad_gateway(exc) from exc
    return {"url": data.get("download"), "filename": data.get("filename"), "size": data.get("filesize")}


@router.delete("/downloads/{download_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_download(
    download_id: int,
    cancel: bool = False,
    user: User = Depends(get_current_user),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """Remove it from Descargas. With `cancel`, also delete the unfinished
    torrent from Real-Debrid (finished ones stay there)."""
    row = _row(db, profile, download_id)
    if cancel and user.realdebrid_key:
        _limit(user)
        try:
            async with debrid.RealDebrid(user.realdebrid_key) as rd:
                info = await rd.info(row.torrent_id)
                if info.get("status") != "downloaded":
                    await rd.delete(row.torrent_id)
        except debrid.DebridError:
            pass  # gone already or not reachable: still remove it here
        _list_cache.pop(user.id, None)
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Status of sources on the Streams page --------------------------------


class StatusIn(BaseModel):
    hashes: list[str] = Field(max_length=300)


@router.post("/status")
async def torrents_status(
    payload: StatusIn,
    user: User = Depends(get_current_user),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """For each infohash already in the user's Real-Debrid: its progress, and
    our download id when this profile asked for it. Unknown hashes are left out."""
    if not user.realdebrid_key:
        return {"connected": False, "items": {}}
    wanted = {h.lower() for h in payload.hashes if debrid.HASH_RE.match(h.lower())}
    if not wanted:
        return {"connected": True, "items": {}}
    _limit(user)
    try:
        async with debrid.RealDebrid(user.realdebrid_key) as rd:
            torrents = await _torrents(user, rd)
    except debrid.DebridError as exc:
        raise _bad_gateway(exc) from exc
    ours = {
        r.infohash: r.id
        for r in db.scalars(
            select(DebridDownload).where(DebridDownload.profile_id == profile.id, DebridDownload.infohash.in_(wanted))
        )
    }
    items: dict[str, dict] = {}
    # Newest first: the first torrent seen for a hash is the one that counts.
    for t in torrents:
        h = str(t.get("hash", "")).lower()
        if h in wanted and h not in items:
            items[h] = {**debrid.summary(t), "download_id": ours.get(h)}
    return {"connected": True, "items": items}


# --- Legacy: progress read from a Torrentio link (no key saved) -----------


class ProgressIn(BaseModel):
    url: str = Field(min_length=1, max_length=4096)


@router.post("/progress")
async def progress(payload: ProgressIn, user: User = Depends(get_current_user)):
    """How the debrid download behind a stream URL is going. Signed-in only,
    so it's not an open proxy; the key in the URL is used once, not kept."""
    _limit(user)
    source = debrid.parse_source(payload.url)
    if source is None:
        return {"supported": False}
    try:
        data = await debrid.progress(source)
    except debrid.DebridError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"supported": True, "provider": source.provider, **data}
