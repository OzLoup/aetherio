"""token version (password change signs out other sessions) and indexes
for Continuar viendo / history

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-03

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))
    # "Continuar viendo" and history read a profile's rows newest first; a
    # title's page reads a profile's rows for one title.
    op.create_index("ix_watch_progress_profile_updated", "watch_progress", ["profile_id", sa.text("updated_at DESC")])
    op.create_index("ix_watch_progress_profile_meta", "watch_progress", ["profile_id", "meta_id"])


def downgrade() -> None:
    op.drop_index("ix_watch_progress_profile_meta", table_name="watch_progress")
    op.drop_index("ix_watch_progress_profile_updated", table_name="watch_progress")
    op.drop_column("users", "token_version")
