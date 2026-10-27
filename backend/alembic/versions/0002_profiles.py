"""profiles: addons move from users to profiles

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-26

Every existing user gets one profile (named after the user) and keeps their
addons on it.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False, server_default="series-1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_profiles_user_id", "profiles", ["user_id"])
    op.execute(
        "INSERT INTO profiles (user_id, name) "
        "SELECT id, COALESCE(NULLIF(split_part(name, ' ', 1), ''), 'Principal') FROM users"
    )

    op.rename_table("user_addons", "profile_addons")
    op.add_column("profile_addons", sa.Column("profile_id", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE profile_addons pa SET profile_id = p.id FROM profiles p WHERE p.user_id = pa.user_id"
    )
    op.alter_column("profile_addons", "profile_id", nullable=False)
    op.create_foreign_key(
        "fk_profile_addons_profile_id", "profile_addons", "profiles", ["profile_id"], ["id"], ondelete="CASCADE"
    )
    op.drop_constraint("uq_user_addon_url", "profile_addons", type_="unique")
    op.drop_index("ix_user_addons_user_id", table_name="profile_addons")
    op.drop_column("profile_addons", "user_id")
    op.create_unique_constraint("uq_profile_addon_url", "profile_addons", ["profile_id", "transport_url"])
    op.create_index("ix_profile_addons_profile_id", "profile_addons", ["profile_id"])


def downgrade() -> None:
    # Keeps only the addons of each user's first profile.
    op.add_column("profile_addons", sa.Column("user_id", sa.Integer(), nullable=True))
    op.execute("UPDATE profile_addons pa SET user_id = p.user_id FROM profiles p WHERE p.id = pa.profile_id")
    op.execute(
        "DELETE FROM profile_addons WHERE profile_id NOT IN "
        "(SELECT MIN(id) FROM profiles GROUP BY user_id)"
    )
    op.drop_index("ix_profile_addons_profile_id", table_name="profile_addons")
    op.drop_constraint("uq_profile_addon_url", "profile_addons", type_="unique")
    op.drop_constraint("fk_profile_addons_profile_id", "profile_addons", type_="foreignkey")
    op.drop_column("profile_addons", "profile_id")
    op.alter_column("profile_addons", "user_id", nullable=False)
    op.create_foreign_key(None, "profile_addons", "users", ["user_id"], ["id"], ondelete="CASCADE")
    op.create_unique_constraint("uq_user_addon_url", "profile_addons", ["user_id", "transport_url"])
    op.create_index("ix_user_addons_user_id", "profile_addons", ["user_id"])
    op.rename_table("profile_addons", "user_addons")
    op.drop_index("ix_profiles_user_id", table_name="profiles")
    op.drop_table("profiles")
