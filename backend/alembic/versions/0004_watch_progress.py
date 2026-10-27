"""watch progress: continue watching, history, watched marks

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "watch_progress",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("profile_id", sa.Integer(), sa.ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("meta_id", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column("video_id", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Float(), nullable=False, server_default="0"),
        sa.Column("duration", sa.Float(), nullable=False, server_default="0"),
        sa.Column("watched", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("hidden", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("name", sa.String(length=500), nullable=False),
        sa.Column("poster", sa.Text(), nullable=True),
        sa.Column("season", sa.Integer(), nullable=True),
        sa.Column("episode", sa.Integer(), nullable=True),
        sa.Column("episode_title", sa.String(length=500), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("profile_id", "video_id", name="uq_progress_profile_video"),
    )
    op.create_index("ix_watch_progress_profile_id", "watch_progress", ["profile_id"])
    op.create_index("ix_watch_progress_meta_id", "watch_progress", ["meta_id"])
    op.create_index("ix_watch_progress_updated_at", "watch_progress", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_watch_progress_updated_at", table_name="watch_progress")
    op.drop_index("ix_watch_progress_meta_id", table_name="watch_progress")
    op.drop_index("ix_watch_progress_profile_id", table_name="watch_progress")
    op.drop_table("watch_progress")
