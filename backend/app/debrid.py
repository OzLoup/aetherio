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

import re
from dataclasses import dataclass

import httpx

RD_API = "https://api.real-debrid.com/rest/1.0"
# Torrentio: /resolve/realdebrid/{apiKey}/{infoHash}/{cachedEntryInfo}/{fileIndex}/{name}
TORRENTIO_RD = re.compile(r"/resolve/realdebrid/([A-Za-z0-9]{20,100})/([a-fA-F0-9]{40})(?:/|$)")


class DebridError(Exception):
    pass


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
