"""Fetching and validating Stremio addon manifests.

Normally the browser downloads the manifest and sends it along (that's how
Stremio Web does it, and some addons such as Torrentio block requests coming
from servers). The backend only validates it. `fetch_manifest` is the
fallback for when the browser can't reach the addon (CORS, http addon from an
https page) and is also used to seed the default addons.

Catalog/meta/stream requests are made by the clients directly, so video
metadata and streams never go through our server.
"""

import ipaddress
import json
import socket
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from pydantic import ValidationError

from app.config import settings
from app.stremio.manifest import Manifest

MAX_REDIRECTS = 3


class AddonError(Exception):
    """Something the user can fix (bad URL, addon down, invalid manifest).
    The message is shown in the UI as-is."""


def normalize_manifest_url(raw: str) -> str:
    """Turn whatever the user pasted into the canonical manifest URL.

    Accepts `stremio://host/path/manifest.json` (Stremio's install links,
    which mean https), a URL without `/manifest.json`, and stray whitespace.
    """
    url = raw.strip()
    if not url:
        raise AddonError("Pega la URL del addon")
    if url.startswith("stremio://"):
        url = "https://" + url[len("stremio://") :]
    if "://" not in url:
        url = "https://" + url

    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise AddonError("La URL debe empezar con http://, https:// o stremio://")
    if not parts.hostname:
        raise AddonError("La URL no tiene un dominio válido")

    path = parts.path
    if not path.endswith("/manifest.json"):
        path = path.rstrip("/") + "/manifest.json"
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, ""))


def base_url(manifest_url: str) -> str:
    """Addon base URL: what resource paths (/catalog/..., /stream/...) hang off."""
    return manifest_url[: -len("/manifest.json")]


def _check_host_allowed(url: str) -> None:
    if settings.addon_allow_private_hosts:
        return
    host = urlsplit(url).hostname or ""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise AddonError(f"No se pudo resolver el dominio {host}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise AddonError("No se permiten addons alojados en redes privadas o locales")


def fetch_manifest(manifest_url: str) -> tuple[Manifest, dict]:
    """Download and validate a manifest. Returns (parsed, raw_json)."""
    url = manifest_url
    with httpx.Client(timeout=settings.addon_fetch_timeout_seconds, follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            _check_host_allowed(url)
            try:
                with client.stream("GET", url, headers={"Accept": "application/json"}) as resp:
                    if resp.is_redirect:
                        url = urljoin(url, resp.headers.get("location", ""))
                        continue
                    if resp.status_code != 200:
                        raise AddonError(f"El addon respondió con error {resp.status_code}")
                    body = bytearray()
                    for chunk in resp.iter_bytes():
                        body.extend(chunk)
                        if len(body) > settings.addon_manifest_max_bytes:
                            raise AddonError("El manifest es demasiado grande")
                    break
            except httpx.TimeoutException as exc:
                raise AddonError("El addon tardó demasiado en responder") from exc
            except httpx.HTTPError as exc:
                raise AddonError("No se pudo conectar con el addon") from exc
        else:
            raise AddonError("El addon redirige demasiadas veces")

    try:
        raw = json.loads(body)
    except ValueError as exc:
        raise AddonError("La URL no devuelve un manifest JSON válido") from exc

    return parse_manifest(raw), raw


def parse_manifest(raw: object) -> Manifest:
    """Validate a manifest, whether we downloaded it or the browser sent it."""
    if not isinstance(raw, dict):
        raise AddonError("La URL no devuelve un manifest JSON válido")
    if len(json.dumps(raw)) > settings.addon_manifest_max_bytes:
        raise AddonError("El manifest es demasiado grande")
    try:
        return Manifest.model_validate(raw)
    except ValidationError as exc:
        first = exc.errors()[0]
        field = ".".join(str(p) for p in first["loc"]) or "manifest"
        raise AddonError(f"Manifest inválido ({field}: {first['msg']})") from exc


def resolve_manifest(manifest_url: str, client_manifest: dict | None) -> tuple[Manifest, dict]:
    """Use the manifest the browser fetched if there is one; otherwise fetch it here."""
    if client_manifest is not None:
        return parse_manifest(client_manifest), client_manifest
    return fetch_manifest(manifest_url)
