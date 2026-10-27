"""ratings (no me gusta / me gusta / me encanta)

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ratings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("profile_id", sa.Integer(), sa.ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("meta_id", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=500), nullable=False),
        sa.Column("poster", sa.Text(), nullable=True),
        sa.Column("genres", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("profile_id", "meta_id", name="uq_rating_profile_meta"),
    )
    op.create_index("ix_ratings_profile_id", "ratings", ["profile_id"])


def downgrade() -> None:
    op.drop_index("ix_ratings_profile_id", table_name="ratings")
    op.drop_table("ratings")
