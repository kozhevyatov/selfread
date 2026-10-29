"""Мастер первоначальной настройки: выбор БД и создание администратора.

Медиатеки добавляются следующим шагом уже от имени администратора (/api/admin/libraries).
"""
from __future__ import annotations

import ipaddress

import secrets

from fastapi import APIRouter, Header, HTTPException, Request, Response
from sqlalchemy import URL, func, select

from .. import db as dbmod
from ..app_settings import get_setting, set_setting
from ..config import settings, sqlite_url
from ..models import User
from ..schemas import AdminCreate, DatabaseConfig, SetupStatus, TokenOut
from ..security import hash_password
from .auth import issue_tokens

router = APIRouter(prefix="/api/setup", tags=["setup"])


def _setup_complete() -> bool:
    if not dbmod.is_configured():
        return False
    with dbmod.session_scope() as db:
        return get_setting(db, "setup_complete") == "1"


def _check_token(token: str | None) -> None:
    if settings.setup_token and not secrets.compare_digest(token or "", settings.setup_token):
        raise HTTPException(403, "Неверный токен настройки")


def _guard(token: str | None, request: Request) -> None:
    if _setup_complete():
        raise HTTPException(409, "Настройка уже завершена")
    _check_token(token)
    if not settings.setup_token and not _is_local(request):
        # Без SETUP_TOKEN мастер доступен только из домашней сети: иначе первый, кто
        # найдёт открытый порт в интернете, стал бы администратором.
        raise HTTPException(
            403,
            "Мастер установки открыт только из локальной сети. Откройте его с компьютера дома "
            "или задайте SETUP_TOKEN в docker-compose.yml.",
        )


def _is_local(request: Request) -> bool:
    host = request.client.host if request.client else ""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or ip.is_link_local


def _build_url(cfg: DatabaseConfig) -> str:
    if cfg.type == "sqlite":
        return sqlite_url()
    if not (cfg.host and cfg.user and cfg.database):
        raise HTTPException(422, "Укажите хост, пользователя и имя базы")
    return URL.create(
        "mysql+pymysql",
        username=cfg.user,
        password=cfg.password or "",
        host=cfg.host,
        port=cfg.port or 3306,
        database=cfg.database,
        query={"charset": "utf8mb4"},
    ).render_as_string(hide_password=False)


@router.get("/status", response_model=SetupStatus)
def status() -> SetupStatus:
    return SetupStatus(
        database_configured=dbmod.is_configured(),
        database_from_env=settings.database_from_env,
        setup_complete=_setup_complete(),
        setup_token_required=bool(settings.setup_token),
    )


@router.post("/test-db")
def test_db(cfg: DatabaseConfig, request: Request, x_setup_token: str | None = Header(default=None)) -> dict:
    _guard(x_setup_token, request)
    url = _build_url(cfg)
    try:
        dbmod.test_connection(url)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Не удалось подключиться: {exc.__class__.__name__}: {str(exc)[:300]}")
    return {"ok": True}


@router.post("/database")
def configure_database(cfg: DatabaseConfig, request: Request, x_setup_token: str | None = Header(default=None)) -> dict:
    _guard(x_setup_token, request)
    if settings.database_from_env:
        raise HTTPException(409, "База задана через DATABASE_URL")
    url = _build_url(cfg)
    try:
        dbmod.init_db(url)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Ошибка инициализации БД: {exc.__class__.__name__}: {str(exc)[:300]}")
    settings.save_database_url(url)
    return {"ok": True}


@router.post("/admin", response_model=TokenOut)
def create_admin(
    data: AdminCreate,
    request: Request,
    response: Response,
    x_setup_token: str | None = Header(default=None),
) -> TokenOut:
    _guard(x_setup_token, request)
    if not dbmod.is_configured():
        raise HTTPException(409, "Сначала настройте базу данных")
    with dbmod.session_scope() as db:
        if db.scalar(select(func.count()).select_from(User)):
            raise HTTPException(409, "Администратор уже создан")
        user = User(
            username=data.username,
            email=data.email.lower(),
            display_name=data.display_name or data.username,
            password_hash=hash_password(data.password),
            is_admin=True,
        )
        db.add(user)
        set_setting(db, "site_name", data.site_name.strip() or "SelfRead")
        set_setting(db, "registration_mode", data.registration_mode)
        set_setting(db, "setup_complete", "1")
        db.commit()
        db.refresh(user)
        return issue_tokens(user, request, response)
