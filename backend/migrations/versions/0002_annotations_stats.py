"""Закладки и цитаты, статистика чтения, цель на год, ручная правка метаданных.

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

MYSQL_OPTS = {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}
LongText = sa.Text().with_variant(mysql.MEDIUMTEXT(), "mysql", "mariadb")

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("reading_goal", sa.Integer(), nullable=False, server_default="0"))
    with op.batch_alter_table("books") as batch:
        batch.add_column(sa.Column("locked", sa.String(length=512), nullable=False, server_default=""))

    op.create_table(
        "annotations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("position", sa.Text(), nullable=False),
        sa.Column("text", LongText, nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("chapter", sa.String(length=512), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        **MYSQL_OPTS,
    )
    op.create_index("ix_annotations_user_id", "annotations", ["user_id"])
    op.create_index("ix_annotations_book_id", "annotations", ["book_id"])
    op.create_index("ix_annotations_user_book", "annotations", ["user_id", "book_id"])

    op.create_table(
        "reading_days",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=True),
        sa.Column("day", sa.String(length=10), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("seconds", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "book_id", "day", name="uq_reading_day"),
        **MYSQL_OPTS,
    )
    op.create_index("ix_reading_days_book_id", "reading_days", ["book_id"])
    op.create_index("ix_reading_days_user_day", "reading_days", ["user_id", "day"])


def downgrade() -> None:
    # Колонки users.reading_goal и books.locked не удаляем: на SQLite это пересоздание таблиц,
    # и при включённых внешних ключах каскад стёр бы прогресс и полки. Лишние колонки ничему не мешают.
    op.drop_table("reading_days")
    op.drop_table("annotations")
