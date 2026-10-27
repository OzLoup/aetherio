"""encrypt addon URLs at rest (they can carry API keys)

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-26

Adds `url_hash` (keyed hash, for uniqueness/lookups) and encrypts every
`transport_url` with DATA_ENCRYPTION_KEY (see app/crypto.py).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.crypto import decrypt, encrypt, url_hash

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("profile_addons", sa.Column("url_hash", sa.String(length=64), nullable=True))
    conn = op.get_bind()
    for row_id, url in conn.execute(sa.text("SELECT id, transport_url FROM profile_addons")).fetchall():
        plain = decrypt(url)
        conn.execute(
            sa.text("UPDATE profile_addons SET transport_url = :u, url_hash = :h WHERE id = :id"),
            {"u": encrypt(plain), "h": url_hash(plain), "id": row_id},
        )
    op.alter_column("profile_addons", "url_hash", nullable=False)
    op.drop_constraint("uq_profile_addon_url", "profile_addons", type_="unique")
    op.create_unique_constraint("uq_profile_addon_url", "profile_addons", ["profile_id", "url_hash"])


def downgrade() -> None:
    conn = op.get_bind()
    for row_id, url in conn.execute(sa.text("SELECT id, transport_url FROM profile_addons")).fetchall():
        conn.execute(sa.text("UPDATE profile_addons SET transport_url = :u WHERE id = :id"), {"u": decrypt(url), "id": row_id})
    op.drop_constraint("uq_profile_addon_url", "profile_addons", type_="unique")
    op.create_unique_constraint("uq_profile_addon_url", "profile_addons", ["profile_id", "transport_url"])
    op.drop_column("profile_addons", "url_hash")
