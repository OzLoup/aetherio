"""Download progress of a source the debrid service is still fetching.

When you pick a source that isn't in your debrid's cache, Torrentio asks
the service to download it and plays a short "downloading" clip. This reads
how that download is going (percent, speed, seeds) so the app can show it
and start playing when it's done.

Real-Debrid only for now. The API key travels inside the stream URL
Torrentio gave the app (…/resolve/realdebrid/{key}/{infohash}/…); it is
used for this one request to api.real-debrid.com and never stored or logged.
Real-Debrid's API doesn't allow calls from web pages (no CORS), hence the
backend in the middle.
"""

import asyncio
import logging
import re
from dataclasses import dataclass
from urllib.parse import quote

import httpx

log = logging.getLogger(__name__)
RETRY_DELAY = 1.0

RD_API = "https://api.real-debrid.com/rest/1.0"
# Torrentio: /resolve/realdebrid/{apiKey}/{infoHash}/{cachedEntryInfo}/{fileIndex}/{name}
TORRENTIO_RD = re.compile(r"/resolve/realdebrid/([A-Za-z0-9]{20,100})/([a-fA-F0-9]{40})(?:/|$)")


class DebridError(Exception):
    """`bad_key`: Real-Debrid rejected the key (not a passing failure)."""

    def __init__(self, message: str, bad_key: bool = False) -> None:
        super().__init__(message)
        self.bad_key = bad_key


@dataclass
class Source:
    provider: str
    key: str
    infohash: str


def parse_source(url: str) -> Source | None:
    """The debrid source behind a stream URL, if we know how to read it."""
    m = TORRENTIO_RD.search(url or "")
    if m:
        return Source("realdebrid", m.group(1), m.group(2).lower())
    return None


async def progress(source: Source, transport: httpx.AsyncBaseTransport | None = None) -> dict:
    """{found, status, progress (0-100), speed (bytes/s), seeders, filename}."""
    if source.provider != "realdebrid":
        raise DebridError("Proveedor no soportado")
    headers = {"Authorization": f"Bearer {source.key}"}
    async with httpx.AsyncClient(base_url=RD_API, timeout=10, headers=headers, transport=transport) as client:
        try:
            res = await client.get("/torrents", params={"limit": 100})
        except httpx.HTTPError as exc:
            raise DebridError("Real-Debrid no responde") from exc
        if res.status_code == 401:
            raise DebridError("La clave de Real-Debrid no es válida")
        if res.status_code == 204:
            return {"found": False}
        if res.status_code != 200:
            raise DebridError(f"Real-Debrid respondió {res.status_code}")
        match = next((t for t in res.json() if str(t.get("hash", "")).lower() == source.infohash), None)
        if match is None:
            return {"found": False}
        try:
            info = await client.get(f"/torrents/info/{match['id']}")
            detail = info.json() if info.status_code == 200 else match
        except (httpx.HTTPError, ValueError):
            detail = match
    return {
        "found": True,
        "status": detail.get("status", match.get("status")),
        "progress": float(detail.get("progress", match.get("progress", 0)) or 0),
        "speed": int(detail.get("speed") or 0),
        "seeders": detail.get("seeders"),
        "filename": detail.get("filename") or match.get("filename"),
    }


# --- Downloads AetherIO asks for itself (key saved in Ajustes) -------------
#
# Instead of hoping the addon adds the torrent when the player opens its
# link, the app adds it to the user's Real-Debrid, picks the right file and
# follows it by id. Works for any addon whose stream carries the infohash.

VIDEO_EXT = (".mkv", ".mp4", ".avi", ".m4v", ".mov", ".ts", ".m2ts", ".webm", ".wmv", ".mpg", ".mpeg")
HASH_RE = re.compile(r"^[a-f0-9]{40}$")
FAILED_STATUSES = {"magnet_error", "error", "virus", "dead"}
# How many of the user's torrents we look through to find one by hash.
SCAN_PAGES = 5
PAGE_SIZE = 100

# Real-Debrid error codes worth saying in words (others: their own message).
RD_ERRORS = {
    8: "La clave de Real-Debrid no es válida",
    9: "Real-Debrid no permite esta acción con tu cuenta",
    20: "Tu cuenta de Real-Debrid no es premium",
    21: "Tienes demasiadas descargas activas en Real-Debrid. Espera a que termine alguna o cancélala.",
    23: "Tu cuenta de Real-Debrid llegó a su límite de tráfico",
    29: "Real-Debrid rechazó el archivo (demasiado grande)",
    30: "Real-Debrid no pudo leer este torrent",
    34: "Demasiadas peticiones a Real-Debrid. Espera un momento.",
    35: "Real-Debrid bloqueó este torrent por derechos de autor y no lo descarga para nadie. Elige otra fuente.",
}


# Open public trackers added to every magnet, as most torrent clients do: a
# bare infohash leaves the debrid to find peers through DHT only, and it
# often gives up on torrents that do have seeds.
DEFAULT_TRACKERS = (
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.demonii.com:1337/announce",
)
TRACKER_RE = re.compile(r"^(udp|https?|wss?)://[^\s/?#]+(?::\d+)?(/[^\s]*)?$", re.I)
MAX_TRACKERS = 30


def magnet(infohash: str, trackers: list[str] | tuple[str, ...] = ()) -> str:
    """magnet: link with the addon's trackers (only plain tracker URLs) plus ours."""
    seen: list[str] = []
    for tr in [*trackers, *DEFAULT_TRACKERS]:
        tr = str(tr).strip()
        if TRACKER_RE.match(tr) and tr not in seen:
            seen.append(tr)
    return f"magnet:?xt=urn:btih:{infohash}" + "".join(
        f"&tr={quote(tr, safe='')}" for tr in seen[:MAX_TRACKERS]
    )


def video_files(files: list[dict]) -> list[dict]:
    vids = [f for f in files if str(f.get("path", "")).lower().endswith(VIDEO_EXT)]
    return vids or list(files)


def _basename(path: str) -> str:
    return path.rsplit("/", 1)[-1].strip().lower()


def pick_file(
    files: list[dict],
    filename: str | None = None,
    file_idx: int | None = None,
    season: int | None = None,
    episode: int | None = None,
) -> dict | None:
    """The file of the torrent the user chose: by name, then episode code,
    then the addon's file index, then the biggest video."""
    if not files:
        return None
    ordered = sorted(files, key=lambda f: int(f.get("id", 0)))
    vids = video_files(ordered)
    if filename:
        want = _basename(filename)
        for f in ordered:
            if _basename(str(f.get("path", ""))) == want:
                return f
    if season is not None and episode is not None:
        code = re.compile(rf"(?:s0*{season}\s*[._ -]?e0*{episode}(?!\d)|(?<!\d)0*{season}x0*{episode}(?!\d))", re.I)
        hits = [f for f in vids if code.search(_basename(str(f.get("path", ""))))]
        if hits:
            return max(hits, key=lambda f: int(f.get("bytes", 0)))
    if file_idx is not None and 0 <= file_idx < len(ordered) and ordered[file_idx] in vids:
        return ordered[file_idx]
    return max(vids, key=lambda f: int(f.get("bytes", 0)))


def link_for(info: dict, file_id: int | None) -> str | None:
    """Real-Debrid gives one link per selected file, in file order."""
    links = info.get("links") or []
    if not links:
        return None
    selected = sorted((int(f["id"]) for f in info.get("files") or [] if f.get("selected")))
    if file_id is not None and file_id in selected:
        i = selected.index(file_id)
        if i < len(links):
            return links[i]
    return links[0] if len(links) == 1 else None


def summary(t: dict) -> dict:
    """What the app shows of one torrent."""
    status = t.get("status") or "unknown"
    return {
        "status": status,
        "progress": float(t.get("progress") or 0),
        "speed": int(t.get("speed") or 0),
        "seeders": t.get("seeders"),
        "filename": t.get("filename"),
        "bytes": int(t.get("bytes") or 0),
        "ready": status == "downloaded",
        "failed": status in FAILED_STATUSES,
    }


class RealDebrid:
    """A small Real-Debrid client for one user's key (used per request)."""

    def __init__(self, key: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._client = httpx.AsyncClient(
            base_url=RD_API, timeout=15, headers={"Authorization": f"Bearer {key}"}, transport=transport
        )
        # Failed torrents start() deleted from the account.
        self.removed: list[str] = []

    async def __aenter__(self) -> "RealDebrid":
        return self

    async def __aexit__(self, *exc) -> None:
        await self._client.aclose()

    async def _call(self, method: str, path: str, **kw) -> httpx.Response:
        # Real-Debrid has short hiccups (5xx, timeouts): reads are tried once
        # more before giving up. Writes aren't, so nothing is added twice.
        tries = 2 if method == "GET" else 1
        for attempt in range(tries):
            try:
                res = await self._client.request(method, path, **kw)
            except httpx.HTTPError as exc:
                if attempt + 1 < tries:
                    await asyncio.sleep(RETRY_DELAY)
                    continue
                raise DebridError("Real-Debrid no responde") from exc
            if res.status_code >= 500 and attempt + 1 < tries:
                await asyncio.sleep(RETRY_DELAY)
                continue
            break
        if res.status_code == 401:
            raise DebridError("La clave de Real-Debrid no es válida", bad_key=True)
        if res.status_code >= 400:
            code, message = None, None
            try:
                body = res.json()
                code, message = body.get("error_code"), body.get("error")
            except ValueError:
                pass
            text = RD_ERRORS.get(code) or f"Real-Debrid respondió {res.status_code}" + (f" ({message})" if message else "")
            # Only the path's first part: the rest can be a torrent id.
            log.warning("Real-Debrid %s %s -> %s %s", method, "/".join(path.split("/")[:3]), res.status_code, message or code)
            raise DebridError(text, bad_key=code == 8)
        return res

    async def user(self) -> dict:
        return (await self._call("GET", "/user")).json()

    async def torrents(self, pages: int = SCAN_PAGES) -> list[dict]:
        """The user's torrents, newest first (up to pages × 100)."""
        out: list[dict] = []
        for page in range(1, pages + 1):
            res = await self._call("GET", "/torrents", params={"limit": PAGE_SIZE, "page": page})
            if res.status_code == 204 or not res.content:
                break
            batch = res.json()
            out.extend(batch)
            if len(batch) < PAGE_SIZE:
                break
        return out

    async def info(self, torrent_id: str) -> dict:
        return (await self._call("GET", f"/torrents/info/{torrent_id}")).json()

    async def add_magnet(self, infohash: str, trackers: list[str] | tuple[str, ...] = ()) -> str:
        res = await self._call("POST", "/torrents/addMagnet", data={"magnet": magnet(infohash, trackers)})
        return str(res.json()["id"])

    async def select_files(self, torrent_id: str, file_ids: list[int]) -> None:
        await self._call("POST", f"/torrents/selectFiles/{torrent_id}", data={"files": ",".join(map(str, file_ids))})

    async def delete(self, torrent_id: str) -> None:
        await self._call("DELETE", f"/torrents/delete/{torrent_id}")

    async def unrestrict(self, link: str) -> dict:
        return (await self._call("POST", "/unrestrict/link", data={"link": link})).json()

    async def start(
        self,
        infohash: str,
        filename: str | None = None,
        file_idx: int | None = None,
        season: int | None = None,
        episode: int | None = None,
        trackers: list[str] | tuple[str, ...] = (),
    ) -> tuple[dict, int | None]:
        """Add (or reuse) the torrent and select the chosen file.
        Returns (torrent info, chosen file id). Torrents of this hash that had
        failed are deleted and asked for again (ids in `self.removed`): reusing
        them would only show the same error forever."""
        infohash = infohash.lower()
        existing = [t for t in await self.torrents() if str(t.get("hash", "")).lower() == infohash]
        for t in existing:
            if t.get("status") in FAILED_STATUSES:
                await self.delete(str(t["id"]))
                self.removed.append(str(t["id"]))
                continue
            info = await self.info(str(t["id"]))
            file = pick_file(info.get("files") or [], filename, file_idx, season, episode)
            fid = int(file["id"]) if file else None
            if info.get("status") == "waiting_files_selection" and fid is not None:
                await self.select_files(str(info["id"]), [fid])
                return await self.info(str(info["id"])), fid
            selected = {int(f["id"]) for f in info.get("files") or [] if f.get("selected")}
            # Already there with our file (or still reading the magnet): follow it.
            if fid is None or fid in selected:
                return info, fid
        torrent_id = await self.add_magnet(infohash, trackers)
        info = await self.info(torrent_id)
        fid = None
        # The file list shows up once the magnet is read (usually right away
        # for known torrents); otherwise the next status check selects it.
        if info.get("status") == "waiting_files_selection":
            file = pick_file(info.get("files") or [], filename, file_idx, season, episode)
            if file:
                fid = int(file["id"])
                await self.select_files(torrent_id, [fid])
                info = await self.info(torrent_id)
        return info, fid
