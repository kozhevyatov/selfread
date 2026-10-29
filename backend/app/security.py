from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User

ALGORITHM = "HS256"
REFRESH_COOKIE = "sr_refresh"
# Cookie для <audio>, <img> и файлов книг: они не умеют передавать заголовок Authorization
MEDIA_COOKIE = "sr_media"
_ph = PasswordHasher()


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


# ---------- токены ----------


def _encode(payload: dict, lifetime: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {**payload, "iat": now, "exp": now + lifetime}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def create_access_token(user: User) -> str:
    return _encode(
        {"sub": str(user.id), "type": "access", "adm": user.is_admin},
        timedelta(minutes=settings.access_token_minutes),
    )


SHORT_SESSION = timedelta(days=1)


def refresh_lifetime(remember: bool) -> timedelta:
    return timedelta(days=settings.refresh_token_days) if remember else SHORT_SESSION


def create_refresh_token(user: User, remember: bool = True) -> str:
    return _encode(
        {"sub": str(user.id), "type": "refresh", "ver": user.token_version, "rem": remember},
        refresh_lifetime(remember),
    )


def create_media_token(user: User, remember: bool = True) -> str:
    return _encode({"sub": str(user.id), "type": "media", "ver": user.token_version}, refresh_lifetime(remember))


def decode_token(token: str, expected_type: str) -> dict:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Недействительный токен")
    if payload.get("type") != expected_type:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Недействительный токен")
    return payload


def _is_secure(request: Request) -> bool:
    if settings.cookie_secure == "auto":
        # За reverse proxy схема берётся из X-Forwarded-Proto (uvicorn --proxy-headers).
        return request.url.scheme == "https"
    return settings.cookie_secure.lower() in ("1", "true", "yes")


def set_session_cookies(response: Response, user: User, refresh: str, request: Request, remember: bool = True) -> None:
    max_age = settings.refresh_token_days * 86400 if remember else None
    secure = _is_secure(request)
    response.set_cookie(
        REFRESH_COOKIE, refresh, max_age=max_age, httponly=True, secure=secure, samesite="lax", path="/api/auth"
    )
    response.set_cookie(
        MEDIA_COOKIE,
        create_media_token(user, remember),
        max_age=max_age,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/api",
    )


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")
    response.delete_cookie(MEDIA_COOKIE, path="/api")


def _bearer(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def _active_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Пользователь не найден")
    return user


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = _bearer(request)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется авторизация")
    payload = decode_token(token, "access")
    return _active_user(db, int(payload["sub"]))


def get_media_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Для файлов книг, аудио и обложек: Bearer-токен, media-cookie (браузер) или media-токен в ссылке ?mt=…
    (нативный плеер Android-приложения: системный плеер и экран блокировки не передают cookie)."""
    if _bearer(request):
        return get_current_user(request, db)
    token = request.cookies.get(MEDIA_COOKIE) or request.query_params.get("mt") or request.headers.get("X-Media-Token")
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется авторизация")
    payload = decode_token(token, "media")
    user = _active_user(db, int(payload["sub"]))
    if payload.get("ver") != user.token_version:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия истекла")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нужны права администратора")
    return user
