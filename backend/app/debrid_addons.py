"""Put the account's Real-Debrid key into addons that take it in their URL,
so nobody has to open each addon's configure page.

Only formats checked against the real servers (2026-11-18):
- Torrentio: `https://host/{k=v|k=v}/manifest.json`, key in `realdebrid=`.
- Comet: `https://host/{base64(JSON)}/manifest.json`, key in
  `debridServices: [{service: "realdebrid", apiKey}]` (older configs use
  `debridService`/`debridApiKey`). A `/` in the base64 breaks Comet even
  when percent-encoded, so the JSON spacing is changed until there is none.

Any other addon is left as is: the app downloads its torrents through
Real-Debrid by itself (routers/debrid.py).
"""

import base64
import binascii
import json
from urllib.parse import unquote, urlsplit, urlunsplit

TORRENTIO_IDS = {"com.stremio.torrentio.addon"}
COMET_IDS = {"stremio.comet.fast"}


def kind(url: str, manifest: dict | None = None) -> str | None:
    """"torrentio", "comet" or None. By manifest id, else by host name (an
    unconfigured ElfHosted Comet has no manifest to read)."""
    addon_id = (manifest or {}).get("id")
    if addon_id in TORRENTIO_IDS:
        return "torrentio"
    if addon_id in COMET_IDS:
        return "comet"
    if addon_id:
        return None
    host = (urlsplit(url).hostname or "").lower()
    if "torrentio" in host:
        return "torrentio"
    if "comet" in host:
        return "comet"
    return None


def _split(url: str):
    """URL parts and the path segments before manifest.json (the config is
    the last of them, when there is one)."""
    parts = urlsplit(url)
    segments = [s for s in parts.path.split("/") if s]
    if segments and segments[-1] == "manifest.json":
        segments = segments[:-1]
    return parts, segments


def _join(parts, segments: list[str]) -> str:
    path = "/" + "/".join([*segments, "manifest.json"])
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, ""))


# --- Torrentio ----------------------------------------------------------------


def _torrentio(url: str, key: str | None) -> str:
    parts, segments = _split(url)
    pairs: list[tuple[str, str]] = []
    if segments and "=" in unquote(segments[-1]):
        for item in unquote(segments.pop()).split("|"):
            name, _, value = item.partition("=")
            if name:
                pairs.append((name, value))
    pairs = [(n, v) for n, v in pairs if n != "realdebrid"]
    if key:
        pairs.append(("realdebrid", key))
    if pairs:
        segments.append("|".join(f"{n}={v}" for n, v in pairs))
    return _join(parts, segments)


# --- Comet --------------------------------------------------------------------


def _decode_comet(segment: str) -> dict | None:
    text = unquote(segment)
    for decode in (base64.b64decode, base64.urlsafe_b64decode):
        try:
            data = json.loads(decode(text + "=" * (-len(text) % 4)))
        except (binascii.Error, ValueError, UnicodeDecodeError):
            continue
        if isinstance(data, dict):
            return data
    return None


def _encode_comet(config: dict) -> str:
    """Standard base64 without `/`: extra spaces after the JSON (still the
    same JSON) shift the bytes until no `/` comes out."""
    raw = json.dumps(config, separators=(",", ":"))
    for spaces in range(12):
        encoded = base64.b64encode((raw + " " * spaces).encode()).decode()
        if "/" not in encoded:
            return encoded
    raise ValueError("No se pudo preparar la configuración de Comet")


def _comet(url: str, key: str | None) -> str:
    parts, segments = _split(url)
    config: dict = {}
    if segments:
        decoded = _decode_comet(segments[-1])
        if decoded is not None:
            config = decoded
            segments.pop()
    services = [
        s for s in (config.get("debridServices") or []) if isinstance(s, dict) and s.get("service") != "realdebrid"
    ]
    if key:
        services.insert(0, {"service": "realdebrid", "apiKey": key})
    config["debridServices"] = services
    if config.get("debridService") == "realdebrid":
        if key:
            config["debridApiKey"] = key
        else:
            config["debridService"] = "torrent"
            config["debridApiKey"] = ""
    segments.append(_encode_comet(config))
    return _join(parts, segments)


def with_key(url: str, addon_kind: str, key: str | None) -> str:
    """The addon URL with the Real-Debrid key set (or removed with None).
    Other settings and other debrid services in the URL are kept."""
    if addon_kind == "torrentio":
        return _torrentio(url, key)
    if addon_kind == "comet":
        return _comet(url, key)
    return url


def current_key(url: str, addon_kind: str) -> str | None:
    """The Real-Debrid key an addon URL carries, if any."""
    parts, segments = _split(url)
    if not segments:
        return None
    if addon_kind == "torrentio":
        for item in unquote(segments[-1]).split("|"):
            name, _, value = item.partition("=")
            if name == "realdebrid":
                return value or None
        return None
    if addon_kind == "comet":
        config = _decode_comet(segments[-1]) or {}
        for s in config.get("debridServices") or []:
            if isinstance(s, dict) and s.get("service") == "realdebrid":
                return s.get("apiKey") or None
        if config.get("debridService") == "realdebrid":
            return config.get("debridApiKey") or None
    return None
