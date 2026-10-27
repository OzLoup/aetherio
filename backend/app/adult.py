"""Spotting adult (+18) addons and playlists by what they say about
themselves. Only explicit signals: the manifest's own `adult` flag, or words
like "xxx"/"porn"/"+18" in names, descriptions or catalog names. Mixed
sources (a general IPTV list with an adult group) aren't adult as a whole;
the app hides those groups per profile instead."""

import re

ADULT_WORDS = re.compile(
    r"(\bxxx\b|porn|\bnsfw\b|\b18\s*\+|\+\s*18\b|\badult(s|os|o|e|es)?\b|\bpara adultos\b|\berotic|\ber[oó]tic|\bhentai\b|\bsexy?\b|\bonlyfans\b)",
    re.IGNORECASE,
)


def is_adult_text(*texts: str | None) -> bool:
    return any(t and ADULT_WORDS.search(t) for t in texts)


def is_adult_manifest(raw: dict) -> bool:
    hints = raw.get("behaviorHints") or {}
    if isinstance(hints, dict) and hints.get("adult") is True:
        return True
    texts = [raw.get("name"), raw.get("description"), raw.get("id")]
    for catalog in raw.get("catalogs") or []:
        if isinstance(catalog, dict):
            texts += [catalog.get("name"), catalog.get("id")]
    return is_adult_text(*[t for t in texts if isinstance(t, str)])
