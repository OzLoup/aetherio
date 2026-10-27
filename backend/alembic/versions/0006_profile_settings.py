"""profile settings: app language, subtitles, max quality

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("profiles", sa.Column("ui_language", sa.String(length=5), nullable=False, server_default="es"))
    op.add_column("profiles", sa.Column("subtitle_language", sa.String(length=10), nullable=False, server_default="es-419"))
    op.add_column("profiles", sa.Column("subtitles_mode", sa.String(length=10), nullable=False, server_default="auto"))
    op.add_column("profiles", sa.Column("max_quality", sa.String(length=10), nullable=False, server_default="max"))
    # Subtitles follow each profile's audio language to start with.
    op.execute("UPDATE profiles SET subtitle_language = language")


def downgrade() -> None:
    for col in ("max_quality", "subtitles_mode", "subtitle_language", "ui_language"):
        op.drop_column("profiles", col)
