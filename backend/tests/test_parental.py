import pytest
from fastapi import HTTPException

from app import parental
from app.adult import is_adult_manifest, is_adult_text
from app.auth import hash_password
from app.models import User


def test_adult_manifests_are_spotted():
    assert is_adult_manifest({"name": "Cosas", "behaviorHints": {"adult": True}})
    assert is_adult_manifest({"name": "Canales XXX"})
    assert is_adult_manifest({"name": "Mix", "catalogs": [{"id": "c", "name": "Porn Hub"}]})
    assert is_adult_manifest({"name": "TV +18"})
    assert not is_adult_manifest({"name": "Torrentio", "description": "Provides torrent streams"})
    assert not is_adult_manifest({"name": "USA TV Next", "catalogs": [{"id": "all", "name": "Sexto sentido"}]})


def test_adult_text():
    assert is_adult_text("Canales para adultos")
    assert not is_adult_text("Canales en español", "https://iptv-org.github.io/iptv/languages/spa.m3u")


def test_pin_check_and_lockout(monkeypatch):
    monkeypatch.setattr(parental, "_failures", {})
    user = User(id=99, email="a@b.c", parental_pin_hash=hash_password("1234"))
    parental.check_pin(user, "1234")
    for _ in range(parental.MAX_FAILURES):
        with pytest.raises(HTTPException) as e:
            parental.check_pin(user, "0000")
        assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        parental.check_pin(user, "1234")  # right PIN, but locked for a while
    assert e.value.status_code == 429


def test_pin_needed_before_it_exists():
    with pytest.raises(HTTPException) as e:
        parental.check_pin(User(id=1, email="x@y.z"), "1234")
    assert e.value.status_code == 400
