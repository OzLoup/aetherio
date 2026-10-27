"""profile preferred language

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "profiles", sa.Column("language", sa.String(length=10), nullable=False, server_default="es-419")
    )


def downgrade() -> None:
    op.drop_column("profiles", "language")
