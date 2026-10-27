import pytest

from app.stremio.client import AddonError, base_url, normalize_manifest_url
from app.stremio.manifest import Manifest


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://v3-cinemeta.strem.io/manifest.json", "https://v3-cinemeta.strem.io/manifest.json"),
        ("  https://v3-cinemeta.strem.io/manifest.json  ", "https://v3-cinemeta.strem.io/manifest.json"),
        ("stremio://torrentio.strem.fun/manifest.json", "https://torrentio.strem.fun/manifest.json"),
        ("https://torrentio.strem.fun", "https://torrentio.strem.fun/manifest.json"),
        ("https://torrentio.strem.fun/", "https://torrentio.strem.fun/manifest.json"),
        ("torrentio.strem.fun/providers=yts/manifest.json", "https://torrentio.strem.fun/providers=yts/manifest.json"),
        ("http://127.0.0.1:7000/manifest.json", "http://127.0.0.1:7000/manifest.json"),
    ],
)
def test_normalize_manifest_url(raw, expected):
    assert normalize_manifest_url(raw) == expected


@pytest.mark.parametrize("raw", ["", "   ", "ftp://example.com/manifest.json", "https://"])
def test_normalize_manifest_url_rejects(raw):
    with pytest.raises(AddonError):
        normalize_manifest_url(raw)


def test_base_url():
    assert base_url("https://a.b/cfg/manifest.json") == "https://a.b/cfg"


def test_manifest_accepts_mixed_resources_and_unknown_keys():
    m = Manifest.model_validate(
        {
            "id": "org.example",
            "name": "Example",
            "version": "1.0.0",
            "resources": ["catalog", {"name": "stream", "types": ["movie"], "idPrefixes": ["tt"]}],
            "types": ["movie"],
            "catalogs": [{"type": "movie", "id": "top", "extra": [{"name": "genre", "options": ["Drama"]}]}],
            "somethingCustom": True,
        }
    )
    assert m.resource_names() == ["catalog", "stream"]
    assert m.catalogs[0].extra[0].name == "genre"


def test_manifest_requires_resources():
    with pytest.raises(ValueError):
        Manifest.model_validate({"id": "x", "name": "X", "version": "1", "resources": []})


def test_resolve_manifest_uses_client_copy_without_fetching(monkeypatch):
    from app.stremio import client

    def boom(_url):
        raise AssertionError("should not fetch when the browser sent the manifest")

    monkeypatch.setattr(client, "fetch_manifest", boom)
    raw = {"id": "com.stremio.torrentio.addon", "name": "Torrentio", "version": "0.0.15", "resources": ["stream"]}
    manifest, stored = client.resolve_manifest("https://torrentio.strem.fun/manifest.json", raw)
    assert manifest.name == "Torrentio"
    assert stored is raw


@pytest.mark.parametrize("raw", [[], "x", {"id": "x"}, {"id": "x", "name": "X", "version": "1", "resources": "stream"}])
def test_parse_manifest_rejects_invalid(raw):
    from app.stremio.client import parse_manifest

    with pytest.raises(AddonError):
        parse_manifest(raw)


def test_parse_manifest_rejects_oversized(monkeypatch):
    from app.config import settings
    from app.stremio.client import parse_manifest

    monkeypatch.setattr(settings, "addon_manifest_max_bytes", 50)
    with pytest.raises(AddonError, match="demasiado grande"):
        parse_manifest({"id": "x", "name": "X", "version": "1", "resources": ["stream"], "description": "a" * 100})
