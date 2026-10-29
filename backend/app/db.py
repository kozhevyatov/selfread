"""Подключение к БД. Движок создаётся динамически: до прохождения мастера его нет."""
from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import HTTPException
from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

ALEMBIC_DIR = Path(__file__).parent.parent / "migrations"
log = logging.getLogger("uvicorn.error")


class Base(DeclarativeBase):
    pass


_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None
_listeners: list = []


def on_ready(fn) -> None:  # noqa: ANN001
    """Колбэк, который вызывается после подключения к БД (запуск сканера и т.п.)."""
    _listeners.append(fn)


def make_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _):  # noqa: ANN001
            # Встроенный lower() в SQLite понимает только ASCII — заменяем на Python,
            # чтобы поиск по кириллице был регистронезависимым.
            dbapi_conn.create_function(
                "lower", 1, lambda s: s.lower() if isinstance(s, str) else s, deterministic=True
            )
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.close()

        return engine
    return create_engine(url, pool_pre_ping=True, pool_recycle=3600, pool_size=10, max_overflow=20)


def test_connection(url: str) -> None:
    engine = make_engine(url)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    finally:
        engine.dispose()


def run_migrations(engine: Engine) -> None:
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")


def init_db(url: str) -> None:
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = make_engine(url)
    run_migrations(_engine)
    _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    for fn in _listeners:
        try:
            fn()
        except Exception:  # noqa: BLE001
            log.exception("Ошибка в обработчике запуска")


def is_configured() -> bool:
    return _SessionLocal is not None


def get_db() -> Iterator[Session]:
    if _SessionLocal is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Сессия для фоновых задач (сканер, планировщик)."""
    if _SessionLocal is None:
        raise RuntimeError("База данных не настроена")
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


def startup() -> None:
    if not settings.database_url:
        return
    from sqlalchemy.exc import OperationalError

    for attempt in range(1, 31):
        try:
            init_db(settings.database_url)
            return
        except OperationalError as exc:  # БД ещё не готова — ждём, а не падаем в цикл перезапусков
            log.warning("База данных недоступна (попытка %s/30): %s", attempt, str(exc.orig)[:200])
            time.sleep(min(2 * attempt, 10))
    init_db(settings.database_url)
