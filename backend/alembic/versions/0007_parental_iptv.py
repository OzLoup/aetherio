"""parental control (PIN, adult content per profile) and IPTV playlists

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("parental_pin_hash", sa.String(length=255), nullable=True))
    op.add_column("profiles", sa.Column("adult_content", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("profile_addons", sa.Column("adult", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        "profile_playlists",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("profile_id", sa.Integer(), sa.ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("url_hash", sa.String(length=64), nullable=False),
        sa.Column("adult", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("profile_id", "url_hash", name="uq_profile_playlist_url"),
    )
    op.create_index("ix_profile_playlists_profile_id", "profile_playlists", ["profile_id"])


def downgrade() -> None:
    op.drop_index("ix_profile_playlists_profile_id", table_name="profile_playlists")
    op.drop_table("profile_playlists")
    op.drop_column("profile_addons", "adult")
    op.drop_column("profiles", "adult_content")
    op.drop_column("users", "parental_pin_hash")
