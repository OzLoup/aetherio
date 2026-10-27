"""'Mi lista' (library items per profile)

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "library_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("profile_id", sa.Integer(), sa.ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("meta_id", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=500), nullable=False),
        sa.Column("poster", sa.Text(), nullable=True),
        sa.Column("poster_shape", sa.String(length=20), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("profile_id", "meta_id", name="uq_library_profile_meta"),
    )
    op.create_index("ix_library_items_profile_id", "library_items", ["profile_id"])
    op.create_index("ix_library_items_added_at", "library_items", ["added_at"])


def downgrade() -> None:
    op.drop_index("ix_library_items_added_at", table_name="library_items")
    op.drop_index("ix_library_items_profile_id", table_name="library_items")
    op.drop_table("library_items")
