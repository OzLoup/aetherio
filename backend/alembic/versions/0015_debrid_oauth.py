"""Real-Debrid connected with a code (renewable token)

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-18

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("realdebrid_oauth", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "realdebrid_oauth")
