from app.config import Settings, check_production


def test_production_checks_catch_unsafe_settings():
    unsafe = Settings(_env_file=None, jwt_secret="change-me-in-.env", addon_allow_private_hosts=True)
    problems = check_production(unsafe)
    assert any("JWT_SECRET" in p for p in problems)
    assert any("DATA_ENCRYPTION_KEY" in p for p in problems)
    assert any("ADDON_ALLOW_PRIVATE_HOSTS" in p for p in problems)


def test_production_checks_pass_with_proper_settings():
    ok = Settings(
        _env_file=None,
        jwt_secret="x" * 48,
        data_encryption_key="k" * 44,
        addon_allow_private_hosts=False,
        session_https_only=True,
        frontend_url="https://aetherio.pages.dev",
    )
    assert check_production(ok) == []
