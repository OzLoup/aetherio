from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import debrid
from app.auth import get_current_user
from app.models import User
from app.ratelimit import SlidingWindow, too_many

router = APIRouter(prefix="/debrid", tags=["debrid"])

# The player polls every few seconds; this is plenty and keeps it from
# being used as a way to hammer Real-Debrid.
_per_user = SlidingWindow(limit=40, seconds=60)


class ProgressIn(BaseModel):
    url: str = Field(min_length=1, max_length=4096)


@router.post("/progress")
async def progress(payload: ProgressIn, user: User = Depends(get_current_user)):
    """How the debrid download behind a stream URL is going. Signed-in only,
    so it's not an open proxy; the key in the URL is used once, not kept."""
    key = str(user.id)
    if _per_user.blocked(key):
        raise too_many()
    _per_user.hit(key)
    source = debrid.parse_source(payload.url)
    if source is None:
        return {"supported": False}
    try:
        data = await debrid.progress(source)
    except debrid.DebridError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"supported": True, "provider": source.provider, **data}
