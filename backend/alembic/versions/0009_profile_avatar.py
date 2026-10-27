"""profile photo

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("profiles", sa.Column("avatar", sa.LargeBinary(), nullable=True))
    op.add_column("profiles", sa.Column("avatar_type", sa.String(length=20), nullable=True))
    op.add_column("profiles", sa.Column("avatar_key", sa.String(length=64), nullable=True))
    op.create_unique_constraint("uq_profiles_avatar_key", "profiles", ["avatar_key"])


def downgrade() -> None:
    op.drop_constraint("uq_profiles_avatar_key", "profiles", type_="unique")
    for col in ("avatar_key", "avatar_type", "avatar"):
        op.drop_column("profiles", col)
