from app.crypto import EncryptedText, decrypt, encrypt, url_hash

URL = "https://torrentio.strem.fun/realdebrid=SECRETKEY123|lang=latino/manifest.json"


def test_round_trip_and_key_not_visible():
    stored = encrypt(URL)
    assert stored.startswith("enc:")
    assert "SECRETKEY123" not in stored
    assert decrypt(stored) == URL
    # fresh ciphertext each time (so lookups go through url_hash)
    assert encrypt(URL) != stored


def test_hash_is_stable_and_hides_the_key():
    assert url_hash(URL) == url_hash(URL)
    assert url_hash(URL) != url_hash(URL + "x")
    assert "SECRETKEY123" not in url_hash(URL)


def test_legacy_plaintext_still_reads():
    assert decrypt("https://v3-cinemeta.strem.io/manifest.json") == "https://v3-cinemeta.strem.io/manifest.json"


def test_column_type_encrypts_on_write():
    col = EncryptedText()
    written = col.process_bind_param(URL, None)
    assert written != URL and col.process_result_value(written, None) == URL
