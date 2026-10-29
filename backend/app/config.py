"""Конфигурация приложения.

Источники (по приоритету):
1. Переменные окружения (DATABASE_URL, SECRET_KEY и т.д.).
2. Файл /data/config.json, который пишет мастер первоначальной настройки.
"""
from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
CONFIG_FILE = DATA_DIR / "config.json"
SECRET_FILE = DATA_DIR / "secret.key"
COVER_DIR = DATA_DIR / "covers"

# Корень, внутри которого админ выбирает папки с книгами (обзор папок в управлении).
# В docker-compose сюда монтируются папки NAS: /volume2/books:/library/books:ro
MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", "/library"))
# Здесь создаются личные папки пользователей (монтируется на запись): media/<логин>/books
UPLOAD_ROOT = Path(os.getenv("UPLOAD_ROOT", "/uploads"))

VERSION = "0.1.0"


def _ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _load_secret_key() -> str:
    env = os.getenv("SECRET_KEY")
    if env:
        return env
    _ensure_data_dir()
    if SECRET_FILE.exists():
        return SECRET_FILE.read_text().strip()
    key = secrets.token_urlsafe(48)
    SECRET_FILE.write_text(key)
    try:
        SECRET_FILE.chmod(0o600)
    except OSError:
        pass
    return key


@dataclass
class Settings:
    secret_key: str = field(default_factory=_load_secret_key)
    database_url: str | None = None
    database_from_env: bool = False
    access_token_minutes: int = int(os.getenv("ACCESS_TOKEN_MINUTES", "15"))
    refresh_token_days: int = int(os.getenv("REFRESH_TOKEN_DAYS", "30"))
    # Токен для защиты мастера настройки (опционально).
    setup_token: str | None = os.getenv("SETUP_TOKEN") or None
    # Secure-флаг для cookie: auto = по схеме запроса (за reverse proxy с https будет secure).
    cookie_secure: str = os.getenv("COOKIE_SECURE", "auto")
    static_dir: Path = Path(os.getenv("STATIC_DIR", Path(__file__).parent / "static"))

    def load_database_url(self) -> None:
        env_url = os.getenv("DATABASE_URL")
        if env_url:
            self.database_url = env_url
            self.database_from_env = True
            return
        if CONFIG_FILE.exists():
            data = json.loads(CONFIG_FILE.read_text())
            self.database_url = data.get("database_url")

    def save_database_url(self, url: str) -> None:
        _ensure_data_dir()
        data = {}
        if CONFIG_FILE.exists():
            data = json.loads(CONFIG_FILE.read_text())
        data["database_url"] = url
        CONFIG_FILE.write_text(json.dumps(data, indent=2))
        try:
            CONFIG_FILE.chmod(0o600)
        except OSError:
            pass
        self.database_url = url


settings = Settings()
settings.load_database_url()


def sqlite_url() -> str:
    _ensure_data_dir()
    return f"sqlite:///{(DATA_DIR / 'selfread.db').as_posix()}"
