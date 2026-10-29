"""Начальная схема: пользователи, медиатеки и доступ к ним, книги, статусы чтения, полки.

Revision ID: 0001
Revises:
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# Для MySQL/MariaDB — utf8mb4, иначе кириллица и эмодзи ломаются
MYSQL_OPTS = {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}
Double = sa.Float(precision=53).with_variant(mysql.DOUBLE(asdecimal=False), "mysql", "mariadb")
LongText = sa.Text().with_variant(mysql.MEDIUMTEXT(), "mysql", "mariadb")

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
        **MYSQL_OPTS,
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("token_version", sa.Integer(), nullable=False),
        sa.Column("palette", sa.String(length=16), nullable=False),
        sa.Column("palette_auto", sa.Boolean(), nullable=False),
        sa.Column("palette_day", sa.String(length=16), nullable=False),
        sa.Column("palette_night", sa.String(length=16), nullable=False),
        sa.Column("library_scope", sa.String(length=16), nullable=False),
        sa.Column("reader_prefs", sa.Text(), nullable=False),
        sa.Column("avatar_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        **MYSQL_OPTS,
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "libraries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("path", sa.String(length=1024), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("default_access", sa.Boolean(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=True),
        sa.Column("book_count", sa.Integer(), nullable=False),
        sa.Column("audio_count", sa.Integer(), nullable=False),
        sa.Column("total_size", sa.BigInteger(), nullable=False),
        sa.Column("last_scan_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_scan_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        **MYSQL_OPTS,
    )
    op.create_index("ix_libraries_owner_id", "libraries", ["owner_id"])

    op.create_table(
        "library_access",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("library_id", sa.Integer(), nullable=False),
        sa.Column("can_write", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["library_id"], ["libraries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "library_id"),
        **MYSQL_OPTS,
    )

    op.create_table(
        "books",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("library_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("key_hash", sa.String(length=40), nullable=False),
        sa.Column("format", sa.String(length=8), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("files", LongText, nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("sort_title", sa.String(length=512), nullable=False),
        sa.Column("authors", sa.String(length=1024), nullable=False),
        sa.Column("author_sort", sa.String(length=512), nullable=False),
        sa.Column("narrator", sa.String(length=512), nullable=False),
        sa.Column("series", sa.String(length=512), nullable=False),
        sa.Column("series_index", sa.Float(), nullable=True),
        sa.Column("language", sa.String(length=16), nullable=False),
        sa.Column("publisher", sa.String(length=255), nullable=False),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("isbn", sa.String(length=32), nullable=False),
        sa.Column("subjects", sa.String(length=1024), nullable=False),
        sa.Column("description", LongText, nullable=False),
        sa.Column("pages", sa.Integer(), nullable=True),
        sa.Column("duration", Double, nullable=False),
        sa.Column("chapters", LongText, nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("fingerprint", sa.String(length=40), nullable=False),
        sa.Column("cover_version", sa.Integer(), nullable=False),
        sa.Column("scan_error", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["library_id"], ["libraries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("library_id", "key_hash", name="uq_book_key"),
        **MYSQL_OPTS,
    )
    op.create_index("ix_books_library_id", "books", ["library_id"])
    op.create_index("ix_books_kind", "books", ["kind"])
    op.create_index("ix_books_format", "books", ["format"])
    op.create_index("ix_books_sort_title", "books", ["sort_title"])
    op.create_index("ix_books_author_sort", "books", ["author_sort"])
    op.create_index("ix_books_series", "books", ["series"])
    op.create_index("ix_books_library_added", "books", ["library_id", "created_at"])

    op.create_table(
        "read_states",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("position", sa.Text(), nullable=False),
        sa.Column("chapter", sa.String(length=512), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "book_id"),
        **MYSQL_OPTS,
    )
    op.create_index("ix_read_states_book_id", "read_states", ["book_id"])
    op.create_index("ix_read_states_user_updated", "read_states", ["user_id", "updated_at"])

    op.create_table(
        "shelves",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("is_shared", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        **MYSQL_OPTS,
    )
    op.create_index("ix_shelves_owner_id", "shelves", ["owner_id"])

    op.create_table(
        "shelf_books",
        sa.Column("shelf_id", sa.Integer(), nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shelf_id"], ["shelves.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("shelf_id", "book_id"),
        **MYSQL_OPTS,
    )
    op.create_index("ix_shelf_books_book_id", "shelf_books", ["book_id"])


def downgrade() -> None:
    for table in ("shelf_books", "shelves", "read_states", "books", "library_access", "libraries", "users", "app_settings"):
        op.drop_table(table)
