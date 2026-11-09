"""Real-Debrid key per account and the downloads a profile asked for

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-09

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("realdebrid_key", sa.Text(), nullable=True))
    op.create_table(
        "debrid_downloads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("profile_id", sa.Integer(), sa.ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False, server_default="realdebrid"),
        sa.Column("torrent_id", sa.String(64), nullable=False),
        sa.Column("infohash", sa.String(40), nullable=False),
        sa.Column("file_id", sa.Integer(), nullable=True),
        sa.Column("filename", sa.String(1000), nullable=True),
        sa.Column("file_idx", sa.Integer(), nullable=True),
        sa.Column("type", sa.String(30), nullable=False),
        sa.Column("meta_id", sa.String(255), nullable=False),
        sa.Column("video_id", sa.String(255), nullable=False),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("poster", sa.Text(), nullable=True),
        sa.Column("season", sa.Integer(), nullable=True),
        sa.Column("episode", sa.Integer(), nullable=True),
        sa.Column("episode_title", sa.String(500), nullable=True),
        sa.Column("source", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("profile_id", "torrent_id", name="uq_download_profile_torrent"),
    )
    op.create_index("ix_debrid_downloads_profile_id", "debrid_downloads", ["profile_id"])
    op.create_index("ix_debrid_downloads_infohash", "debrid_downloads", ["infohash"])
    op.create_index("ix_debrid_downloads_created_at", "debrid_downloads", ["created_at"])


def downgrade() -> None:
    op.drop_table("debrid_downloads")
    op.drop_column("users", "realdebrid_key")
