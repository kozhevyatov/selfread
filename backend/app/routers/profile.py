"""Личный кабинет: имя, email, пароль, аватарка, оформление и настройки читалки."""
from __future__ import annotations

import io
import time

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import ratelimit
from ..config import DATA_DIR
from ..db import get_db
from ..models import User
from ..schemas import PasswordChange, ProfileUpdate, TokenOut, UserOut
from ..security import (
    REFRESH_COOKIE,
    decode_token,
    get_current_user,
    get_media_user,
    hash_password,
    verify_password,
)
from .auth import issue_tokens

router = APIRouter(prefix="/api/me", tags=["profile"])


@router.get("", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.patch("", response_model=UserOut)
def update_profile(data: ProfileUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> User:
    if data.display_name is not None:
        user.display_name = " ".join(data.display_name.split()) or user.username
    if data.username is not None and data.username != user.username:
        if db.scalar(select(func.count()).select_from(User).where(User.username == data.username, User.id != user.id)):
            raise HTTPException(409, "Этот логин уже занят")
        user.username = data.username
    if data.email is not None:
        email = data.email.strip().lower()
        if email != user.email:
            taken = db.scalar(select(func.count()).select_from(User).where(User.email == email, User.id != user.id))
            if taken:
                raise HTTPException(409, "Этот email уже занят")
            user.email = email
    for name in ("palette", "palette_auto", "palette_day", "palette_night", "library_scope", "reader_prefs"):
        value = getattr(data, name)
        if value is not None:
            setattr(user, name, value)
    db.commit()
    db.refresh(user)
    return user


@router.post("/password", response_model=TokenOut)
def change_password(
    data: PasswordChange,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TokenOut:
    ip = request.client.host if request.client else "?"
    ratelimit.check(user.username, ip)
    if not verify_password(data.current_password, user.password_hash):
        ratelimit.fail(user.username, ip)
        raise HTTPException(400, "Текущий пароль указан неверно")
    user.password_hash = hash_password(data.new_password)
    user.token_version += 1  # остальные устройства выходят
    db.commit()
    db.refresh(user)
    remember = True
    cookie = request.cookies.get(REFRESH_COOKIE)
    if cookie:
        try:
            remember = bool(decode_token(cookie, "refresh").get("rem", True))
        except HTTPException:
            pass
    return issue_tokens(user, request, response, remember)


# ---------------- аватарка ----------------

AVATAR_DIR = DATA_DIR / "avatars"
AVATAR_SIZE = 512


def avatar_file(user_id: int):  # noqa: ANN201
    return AVATAR_DIR / f"u{user_id}.webp"


def save_avatar(db: Session, user: User, file: UploadFile) -> User:
    """Картинку обрезает в квадрат браузер; здесь — проверка, страховочная обрезка по центру и WebP 512×512."""
    data = file.file.read(15 * 1024 * 1024 + 1)
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "Картинка больше 15 МБ")
    try:
        img = Image.open(io.BytesIO(data))
        if img.width * img.height > 50_000_000:
            raise ValueError("слишком большая")  # распаковка такой картинки съест сотни МБ памяти
        img.draft("RGB", (AVATAR_SIZE * 2, AVATAR_SIZE * 2))  # JPEG: декодируем сразу в уменьшенном размере
        img = ImageOps.exif_transpose(img).convert("RGB")
        img = ImageOps.fit(img, (AVATAR_SIZE, AVATAR_SIZE), Image.LANCZOS)
    except Image.DecompressionBombError:
        raise HTTPException(413, "Картинка слишком большая — больше 50 мегапикселей")
    except ValueError as exc:
        if "слишком" in str(exc):
            raise HTTPException(413, "Картинка слишком большая — больше 50 мегапикселей")
        raise HTTPException(415, "Это не картинка")
    except Exception:  # noqa: BLE001
        raise HTTPException(415, "Это не картинка")
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    tmp = AVATAR_DIR / f".u{user.id}.{time.time_ns()}.tmp"
    img.save(tmp, "WEBP", quality=88, method=4)
    tmp.replace(avatar_file(user.id))
    user.avatar_version = int(time.time())
    db.commit()
    db.refresh(user)
    return user


def remove_avatar(db: Session, user: User) -> User:
    avatar_file(user.id).unlink(missing_ok=True)
    user.avatar_version = 0
    db.commit()
    db.refresh(user)
    return user


@router.post("/avatar", response_model=UserOut)
def upload_avatar(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> User:
    return save_avatar(db, user, file)


@router.delete("/avatar", response_model=UserOut)
def delete_avatar(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> User:
    return remove_avatar(db, user)


avatar_router = APIRouter(tags=["profile"])


@avatar_router.get("/api/avatar/{user_id}")
def get_avatar(user_id: int, _: User = Depends(get_media_user)) -> FileResponse:
    path = avatar_file(user_id)
    if not path.is_file():
        raise HTTPException(404, "Аватарки нет")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "private, max-age=31536000, immutable"})
