"""Alembic env. Подключение передаётся из приложения (app.db.run_migrations)
или берётся из DATABASE_URL / config.json при запуске из CLI."""
from __future__ import annotations

import sys
from pathlib import Path

from alembic import context

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import models  # noqa: E402,F401  — регистрирует модели
from app.db import Base, make_engine  # noqa: E402

target_metadata = Base.metadata


def _run(connection) -> None:  # noqa: ANN001
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=connection.dialect.name == "sqlite",
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


connection = context.config.attributes.get("connection")
if connection is not None:
    _run(connection)
else:
    from app.config import settings

    if not settings.database_url:
        raise SystemExit("DATABASE_URL не задан и мастер настройки не пройден")
    engine = make_engine(settings.database_url)
    with engine.begin() as conn:
        _run(conn)
