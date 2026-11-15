"""Папка книги (books.folder) — для раздела «Папки».

Revision ID: 0003
Revises: 0002
"""
from pathlib import PurePosixPath

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def _folder_of(key: str) -> str:
    parent = PurePosixPath(key or ".").parent.as_posix()
    return "" if parent == "." else parent


def upgrade() -> None:
    with op.batch_alter_table("books") as batch:
        batch.add_column(sa.Column("folder", sa.Text(), nullable=True))

    conn = op.get_bind()
    books = sa.table("books", sa.column("id", sa.Integer), sa.column("key", sa.Text), sa.column("folder", sa.Text))
    rows = conn.execute(sa.select(books.c.id, books.c.key)).all()
    batch_rows = []
    for book_id, key in rows:
        batch_rows.append({"bid": book_id, "f": _folder_of(key)})
        if len(batch_rows) >= 1000:
            conn.execute(books.update().where(books.c.id == sa.bindparam("bid")).values(folder=sa.bindparam("f")), batch_rows)
            batch_rows = []
    if batch_rows:
        conn.execute(books.update().where(books.c.id == sa.bindparam("bid")).values(folder=sa.bindparam("f")), batch_rows)


def downgrade() -> None:
    with op.batch_alter_table("books") as batch:
        batch.drop_column("folder")
