from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import ratelimit
from ..access import grant_default_access
from ..app_settings import get_setting
from ..db import get_db
from ..models import User
from ..schemas import LoginIn, RefreshIn, RegisterIn, TokenOut, UserOut
from ..security import (
    REFRESH_COOKIE,
    clear_session_cookies,
    create_access_token,
    create_media_token,
    create_refresh_token,
    decode_token,
    get_current_user,
    hash_password,
    set_session_cookies,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def issue_tokens(user: User, request: Request, response: Response, remember: bool = True) -> TokenOut:
    refresh = create_refresh_token(user, remember)
    set_session_cookies(response, user, refresh, request, remember)
    return TokenOut(
        access_token=create_access_token(user),
        refresh_token=refresh,
        media_token=create_media_token(user, remember),
        user=UserOut.model_validate(user),
    )


@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    login_value = data.login.strip()
    ip = request.client.host if request.client else "?"
    ratelimit.check(login_value, ip)
    user = db.scalar(
        select(User).where(or_(User.username == login_value, User.email == login_value.lower()))
    )
    if not user or not verify_password(data.password, user.password_hash):
        ratelimit.fail(login_value, ip)
        raise HTTPException(401, "Неверный логин или пароль")
    ratelimit.success(login_value, ip)
    if not user.is_active:
        raise HTTPException(403, "Учётная запись отключена")
    user.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return issue_tokens(user, request, response, data.remember)


@router.post("/register", response_model=TokenOut)
def register(
    data: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)
) -> TokenOut:
    if get_setting(db, "setup_complete") != "1":
        raise HTTPException(409, "Сервис ещё не настроен")
    if get_setting(db, "registration_mode") != "open":
        raise HTTPException(403, "Регистрация закрыта")
    email = data.email.lower()
    exists = db.scalar(
        select(func.count()).select_from(User).where(or_(User.username == data.username, User.email == email))
    )
    if exists:
        raise HTTPException(409, "Пользователь с таким логином или email уже есть")
    user = User(
        username=data.username,
        email=email,
        display_name=data.display_name or data.username,
        password_hash=hash_password(data.password),
    )
    db.add(user)
    db.flush()
    grant_default_access(db, user)
    db.commit()
    db.refresh(user)
    return issue_tokens(user, request, response)


@router.post("/refresh", response_model=TokenOut)
def refresh(
    request: Request,
    response: Response,
    data: RefreshIn | None = None,
    db: Session = Depends(get_db),
) -> TokenOut:
    token = (data.refresh_token if data else None) or request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise HTTPException(401, "Нет refresh-токена")
    payload = decode_token(token, "refresh")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active or payload.get("ver") != user.token_version:
        raise HTTPException(401, "Сессия истекла")
    user.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return issue_tokens(user, request, response, bool(payload.get("rem", True)))


@router.post("/logout")
def logout(response: Response) -> dict:
    clear_session_cookies(response)
    return {"ok": True}


@router.post("/logout-all")
def logout_all(response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    user.token_version += 1
    db.commit()
    clear_session_cookies(response)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user
