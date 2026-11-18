import base64
import json
from types import SimpleNamespace

from app import addons_service
from app.crypto import url_hash
from app.debrid_addons import _decode_comet, current_key, kind, with_key
from app.models import Profile, ProfileAddon, User

KEY = "A" * 52
OTHER = "B" * 52


def test_kind_by_manifest_id_or_host():
    assert kind("https://x.example/manifest.json", {"id": "com.stremio.torrentio.addon"}) == "torrentio"
    assert kind("https://x.example/manifest.json", {"id": "stremio.comet.fast"}) == "comet"
    assert kind("https://torrentio.strem.fun/manifest.json", {"id": "something.else"}) is None
    assert kind("https://comet.elfhosted.com/manifest.json") == "comet"
    assert kind("https://v3-cinemeta.strem.io/manifest.json") is None


def test_torrentio_key_added_replaced_and_removed():
    bare = "https://torrentio.strem.fun/manifest.json"
    assert with_key(bare, "torrentio", KEY) == f"https://torrentio.strem.fun/realdebrid={KEY}/manifest.json"

    configured = f"https://torrentio.strem.fun/providers=yts,eztv|sort=quality|realdebrid={OTHER}/manifest.json"
    updated = with_key(configured, "torrentio", KEY)
    assert updated == f"https://torrentio.strem.fun/providers=yts,eztv|sort=quality|realdebrid={KEY}/manifest.json"
    assert current_key(updated, "torrentio") == KEY

    # Percent-encoded config (as some installs paste it) keeps its settings.
    encoded = "https://torrentio.strem.fun/providers%3Dyts%7Csort%3Dquality/manifest.json"
    assert with_key(encoded, "torrentio", KEY).endswith(f"/providers=yts|sort=quality|realdebrid={KEY}/manifest.json")

    assert with_key(updated, "torrentio", None) == "https://torrentio.strem.fun/providers=yts,eztv|sort=quality/manifest.json"
    assert with_key(f"https://torrentio.strem.fun/realdebrid={KEY}/manifest.json", "torrentio", None) == bare


def _comet_config(url: str) -> dict:
    segment = url.split("/")[-2]
    assert "/" not in segment
    return _decode_comet(segment)


def test_comet_key_kept_with_other_settings_and_never_has_a_slash():
    original = {"maxResultsPerResolution": 5, "debridServices": [{"service": "torbox", "apiKey": "t"}]}
    url = "https://comet.example/" + base64.b64encode(json.dumps(original).encode()).decode() + "/manifest.json"
    updated = with_key(url, "comet", KEY)
    config = _comet_config(updated)
    assert config["maxResultsPerResolution"] == 5
    assert config["debridServices"] == [{"service": "realdebrid", "apiKey": KEY}, {"service": "torbox", "apiKey": "t"}]
    assert current_key(updated, "comet") == KEY

    # Many keys: whatever the bytes, the encoded config has no "/".
    for i in range(40):
        assert "/" not in with_key("https://comet.example/manifest.json", "comet", f"{i:0>52}").split("/")[-2]

    removed = _comet_config(with_key(updated, "comet", None))
    assert removed["debridServices"] == [{"service": "torbox", "apiKey": "t"}]


def test_comet_legacy_fields_follow_the_key():
    legacy = {"debridService": "realdebrid", "debridApiKey": OTHER}
    url = "https://comet.example/" + base64.b64encode(json.dumps(legacy).encode()).decode() + "/manifest.json"
    assert _comet_config(with_key(url, "comet", KEY))["debridApiKey"] == KEY
    gone = _comet_config(with_key(url, "comet", None))
    assert gone["debridService"] == "torrent" and gone["debridApiKey"] == ""


def _addon(url: str, manifest: dict) -> ProfileAddon:
    return ProfileAddon(transport_url=url, url_hash=url_hash(url), manifest=manifest)


def test_key_goes_to_every_profile_and_skips_duplicates():
    torrentio = {"id": "com.stremio.torrentio.addon"}
    p1 = Profile(addons=[_addon("https://torrentio.strem.fun/manifest.json", torrentio), _addon("https://v3-cinemeta.strem.io/manifest.json", {"id": "com.linvo.cinemeta"})])
    # Same Torrentio twice: one already with the key → the other is left alone.
    keyed = f"https://torrentio.strem.fun/realdebrid={KEY}/manifest.json"
    p2 = Profile(addons=[_addon(keyed, torrentio), _addon(f"https://torrentio.strem.fun/realdebrid={OTHER}/manifest.json", torrentio)])
    user = User(profiles=[p1, p2])
    db = SimpleNamespace(commit=lambda: None)

    assert addons_service.apply_debrid_key(db, user, KEY) == 1
    assert p1.addons[0].transport_url == keyed and p1.addons[0].url_hash == url_hash(keyed)
    assert p1.addons[1].transport_url == "https://v3-cinemeta.strem.io/manifest.json"
    assert p2.addons[1].transport_url.endswith(f"realdebrid={OTHER}/manifest.json")


def test_install_preview_uses_the_account_key():
    profile = Profile(user=User(realdebrid_key=KEY))
    url, keyed = addons_service.keyed_url(profile, "https://torrentio.strem.fun/manifest.json", {"id": "com.stremio.torrentio.addon"})
    assert keyed and url.endswith(f"realdebrid={KEY}/manifest.json")
    url, keyed = addons_service.keyed_url(Profile(user=User()), "https://torrentio.strem.fun/manifest.json", None)
    assert not keyed and url == "https://torrentio.strem.fun/manifest.json"
