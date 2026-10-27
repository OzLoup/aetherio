"""Writes an account's addons and IPTV lists (decrypted) to a local Markdown
file, to keep a personal copy of the configuration. Prints only counts.

    cd backend
    DATABASE_URL=… DATA_ENCRYPTION_KEY=… .venv/bin/python scripts/export_my_configs.py you@example.com ../MIS_CONFIGURACIONES.local.md

The output contains API keys: keep it out of git (it's in .gitignore)."""

import os
import sys
from datetime import date

from sqlalchemy import create_engine, text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.crypto import decrypt  # noqa: E402

email, out_path = sys.argv[1], sys.argv[2]
engine = create_engine(os.environ["DATABASE_URL"])
with engine.connect() as db:
    user = db.execute(text("select id, email from users where lower(email)=lower(:e)"), {"e": email}).first()
    if not user:
        print("NO_USER", db.execute(text("select count(*) from users")).scalar())
        sys.exit(1)
    profiles = db.execute(
        text("select id, name, language, adult_content from profiles where user_id=:u order by id"), {"u": user.id}
    ).all()
    lines = [
        "# Mis configuraciones de AetherIO",
        "",
        f"Exportado el {date.today().isoformat()}. **Solo local** (está en .gitignore):",
        "las URLs llevan API keys y la configuración de cada addon. No lo compartas.",
        "",
        "Para reinstalar: Addons → Instalar addon → pegar la URL (o TV en vivo → Agregar lista).",
        "",
    ]
    n_addons = n_lists = 0
    for p in profiles:
        lines += [f"## Perfil: {p.name}", "", f"- Idioma de audio: `{p.language}` · +18: {'activado' if p.adult_content else 'apagado'}", ""]
        addons = db.execute(
            text(
                "select transport_url, manifest->>'name' as name, manifest->>'version' as version, enabled, adult "
                "from profile_addons where profile_id=:p order by position, id"
            ),
            {"p": p.id},
        ).all()
        lines += ["### Addons (en orden de prioridad)", ""]
        if not addons:
            lines += ["_Ninguno._", ""]
        for i, a in enumerate(addons, 1):
            flags = [x for x in ("desactivado" if not a.enabled else "", "+18" if a.adult else "") if x]
            lines += [
                f"{i}. **{a.name}** v{a.version}" + (f" ({', '.join(flags)})" if flags else ""),
                f"   `{decrypt(a.transport_url)}`",
            ]
            n_addons += 1
        lists = db.execute(
            text("select name, url, adult from profile_playlists where profile_id=:p order by position, id"), {"p": p.id}
        ).all()
        lines += ["", "### Listas de TV en vivo (IPTV)", ""]
        if not lists:
            lines += ["_Ninguna._", ""]
        for pl in lists:
            lines += [f"- **{pl.name}**" + (" (+18)" if pl.adult else ""), f"  `{decrypt(pl.url)}`"]
            n_lists += 1
        lines.append("")

with open(out_path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
os.chmod(out_path, 0o600)
print(f"OK profiles={len(profiles)} addons={n_addons} lists={n_lists}")
