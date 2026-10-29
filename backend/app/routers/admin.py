"""Управление: настройки сервиса, пользователи и доступ, медиатеки, сканирование."""
from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..access import fs_writable, grant_default_access, set_user_access
from ..app_settings import admin_settings, public_settings, set_setting
from ..bookmeta import file_format
from ..config import MEDIA_ROOT, UPLOAD_ROOT
from ..db import get_db
from ..models import Book, Library, LibraryAccess, User
from ..scanner import cover_path, scanner
from ..schemas import (
    AccessList,
    AdminSettings,
    LibraryCreate,
    LibraryUpdate,
    PasswordReset,
    PublicSettings,
    ScanRequest,
    SettingsUpdate,
    UserAdminCreate,
    UserAdminUpdate,
    UserOut,
)
from ..security import hash_password, require_admin
from .profile import remove_avatar, save_avatar

router = APIRouter(prefix="/api", tags=["admin"])


# ---------------- настройки ----------------


@router.get("/settings", response_model=PublicSettings)
def get_public_settings(db: Session = Depends(get_db)) -> dict:
    """Публичные настройки: название сервиса, открыта ли регистрация."""
    return public_settings(db)


@router.get("/admin/settings", response_model=AdminSettings)
def get_admin_settings(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    return admin_settings(db)


@router.patch("/admin/settings", response_model=AdminSettings)
def update_settings(data: SettingsUpdate, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    if data.site_name is not None:
        set_setting(db, "site_name", data.site_name.strip() or "SelfRead")
    if data.registration_mode is not None:
        set_setting(db, "registration_mode", data.registration_mode)
    if data.scan_interval is not None:
        set_setting(db, "scan_interval", str(data.scan_interval))
    if data.public_url is not None:
        set_setting(db, "public_url", data.public_url.strip().rstrip("/"))
    db.commit()
    return admin_settings(db)


# ---------------- пользователи ----------------


def _user_out(db: Session, user: User) -> dict:
    data = UserOut.model_validate(user).model_dump()
    data["access"] = [
        {"library_id": row.library_id, "can_write": row.can_write}
        for row in db.scalars(select(LibraryAccess).where(LibraryAccess.user_id == user.id))
    ]
    data["personal_libraries"] = list(db.scalars(select(Library.id).where(Library.owner_id == user.id)))
    return data


@router.get("/admin/users")
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[dict]:
    return [_user_out(db, u) for u in db.scalars(select(User).order_by(User.id))]


@router.post("/admin/users")
def create_user(data: UserAdminCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    """Админ добавляет пользователя сам — работает и при закрытой регистрации."""
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
        is_admin=data.is_admin,
    )
    db.add(user)
    db.flush()
    grant_default_access(db, user)
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.patch("/admin/users/{user_id}")
def update_user(
    user_id: int, data: UserAdminUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)
) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    if user.id == admin.id and (data.is_admin is False or data.is_active is False):
        raise HTTPException(400, "Нельзя снять права или отключить самого себя")
    if data.is_admin is not None:
        user.is_admin = data.is_admin
    if data.is_active is not None:
        user.is_active = data.is_active
        if not data.is_active:
            user.token_version += 1
    if data.username is not None and data.username != user.username:
        if db.scalar(select(func.count()).select_from(User).where(User.username == data.username, User.id != user.id)):
            raise HTTPException(409, "Этот логин уже занят")
        user.username = data.username
    if data.email is not None:
        email = data.email.strip().lower()
        if email != user.email:
            if db.scalar(select(func.count()).select_from(User).where(User.email == email, User.id != user.id)):
                raise HTTPException(409, "Этот email уже занят")
            user.email = email
    if data.display_name is not None:
        user.display_name = " ".join(data.display_name.split()) or user.username
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.post("/admin/users/{user_id}/avatar")
def admin_upload_avatar(user_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    return _user_out(db, save_avatar(db, user, file))


@router.delete("/admin/users/{user_id}/avatar")
def admin_delete_avatar(user_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    return _user_out(db, remove_avatar(db, user))


@router.put("/admin/users/{user_id}/access")
def set_access(user_id: int, data: AccessList, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    """Доступ к общим медиатекам: наличие строки — чтение, can_write — ещё и загрузка книг."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    set_user_access(db, user.id, [(a.library_id, a.can_write) for a in data.access])
    db.commit()
    return _user_out(db, user)


@router.post("/admin/users/{user_id}/password")
def reset_password(
    user_id: int, data: PasswordReset, db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    user.password_hash = hash_password(data.password)
    user.token_version += 1  # выкидывает со всех устройств
    db.commit()
    return {"ok": True}


@router.delete("/admin/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    if user_id == admin.id:
        raise HTTPException(400, "Нельзя удалить самого себя")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    if scanner.status()["running"]:
        raise HTTPException(409, "Идёт сканирование — дождитесь окончания")
    # обложки книг из личных медиатек пользователя
    for (book_id,) in db.execute(select(Book.id).join(Library, Library.id == Book.library_id).where(Library.owner_id == user.id)):
        cover_path(book_id).unlink(missing_ok=True)
    db.delete(user)
    db.commit()
    return {"ok": True}


# ---------------- медиатеки ----------------


def _library_out(db: Session, lib: Library) -> dict:
    users = db.scalar(select(func.count()).select_from(LibraryAccess).where(LibraryAccess.library_id == lib.id))
    owner = db.get(User, lib.owner_id) if lib.owner_id else None
    return {
        "id": lib.id,
        "name": lib.name,
        "path": lib.path,
        "scope": "personal" if owner else "shared",
        "owner": {"id": owner.id, "name": owner.display_name or owner.username} if owner else None,
        "writable": fs_writable(lib.path),
        "enabled": lib.enabled,
        "default_access": lib.default_access,
        "book_count": lib.book_count,
        "audio_count": lib.audio_count,
        "total_size": lib.total_size,
        "last_scan_at": lib.last_scan_at,
        "last_scan_error": lib.last_scan_error,
        "exists": os.path.isdir(lib.path),
        "user_count": (users or 0) if not owner else 1,
    }


def _slug(name: str) -> str:
    s = re.sub(r"[^\w.-]+", "_", name, flags=re.UNICODE).strip("._")
    return s or "user"


def _check_path(db: Session, raw: str, exclude_id: int | None = None) -> str:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = MEDIA_ROOT / path
    path = path.resolve()
    if not path.is_dir():
        raise HTTPException(400, f"Папка не найдена внутри контейнера: {path}. Проверьте volumes в docker-compose.")
    for other in db.scalars(select(Library)):
        if other.id == exclude_id:
            continue
        o = Path(other.path).resolve()
        if path == o or o in path.parents or path in o.parents:
            raise HTTPException(409, f"Пересекается с медиатекой «{other.name}» ({other.path})")
    return path.as_posix()


def _personal_dir(db: Session, owner: User) -> str:
    """Новая папка для личной медиатеки: media/<логин>/books (books-2, books-3… если уже занята)."""
    base = UPLOAD_ROOT / _slug(owner.username)
    taken = {Path(p).resolve() for p in db.scalars(select(Library.path))}
    for n in range(1, 100):
        path = base / ("books" if n == 1 else f"books-{n}")
        if path.resolve() not in taken:
            try:
                path.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                raise HTTPException(400, f"Не удалось создать папку {path}: {exc.strerror}. Проверьте, что media/ подключена на запись.")
            return path.resolve().as_posix()
    raise HTTPException(409, "Слишком много личных медиатек у пользователя")


@router.get("/admin/libraries")
def list_libraries(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[dict]:
    return [_library_out(db, lib) for lib in db.scalars(select(Library).order_by(Library.owner_id.is_not(None), Library.id))]


@router.post("/admin/libraries")
def create_library(data: LibraryCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    owner = None
    if data.scope == "personal":
        if not data.owner_id:
            raise HTTPException(422, "Выберите владельца личной медиатеки")
        owner = db.get(User, data.owner_id)
        if not owner:
            raise HTTPException(404, "Пользователь не найден")
        path = _check_path(db, data.path) if data.path.strip() else _personal_dir(db, owner)
    else:
        if not data.path.strip():
            raise HTTPException(422, "Выберите папку для общей медиатеки")
        path = _check_path(db, data.path)
    lib = Library(
        name=data.name.strip(),
        path=path,
        owner_id=owner.id if owner else None,
        default_access=data.default_access if owner is None else False,
    )
    db.add(lib)
    db.flush()
    if owner is None and data.default_access:
        # Открыта по умолчанию — сразу видна всем существующим пользователям (только чтение)
        for uid in db.scalars(select(User.id)):
            db.add(LibraryAccess(user_id=uid, library_id=lib.id))
    db.commit()
    scanner.start(library_id=lib.id)
    return _library_out(db, lib)


@router.patch("/admin/libraries/{library_id}")
def update_library(
    library_id: int, data: LibraryUpdate, db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> dict:
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Медиатека не найдена")
    rescan = False
    if data.name is not None:
        lib.name = data.name.strip()
    if data.path is not None:
        new_path = _check_path(db, data.path, exclude_id=lib.id)
        rescan = new_path != lib.path
        lib.path = new_path
    if data.enabled is not None:
        lib.enabled = data.enabled
    if data.default_access is not None and lib.owner_id is None:
        lib.default_access = data.default_access
    db.commit()
    if rescan:
        scanner.start(library_id=lib.id, full=True)
    return _library_out(db, lib)


@router.delete("/admin/libraries/{library_id}")
def delete_library(library_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    """Удаляет медиатеку из сервиса (с прогрессом и полками по её книгам). Файлы на диске не трогаются."""
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Медиатека не найдена")
    if scanner.status()["running"]:
        raise HTTPException(409, "Идёт сканирование — дождитесь окончания")
    for (book_id,) in db.execute(select(Book.id).where(Book.library_id == lib.id)):
        cover_path(book_id).unlink(missing_ok=True)
    db.delete(lib)
    db.commit()
    return {"ok": True}


@router.get("/admin/fs")
def browse(path: str = "", _: User = Depends(require_admin)) -> dict:
    """Обзор папок внутри MEDIA_ROOT — чтобы выбрать папку с книгами, а не вводить путь руками."""
    root = MEDIA_ROOT.resolve()
    if not root.is_dir():
        return {"root": root.as_posix(), "root_exists": False, "path": "", "parent": None, "dirs": [], "book_files": 0}
    target = (root / path.lstrip("/")).resolve() if path else root
    if target != root and root not in target.parents:
        raise HTTPException(400, "Путь вне разрешённой папки")
    if not target.is_dir():
        raise HTTPException(404, "Папка не найдена")
    dirs = []
    books = 0
    try:
        with os.scandir(target) as it:
            for entry in it:
                if entry.name.startswith((".", "@", "#")):  # @eaDir и прочий служебный мусор Synology
                    continue
                if entry.is_dir(follow_symlinks=True):
                    dirs.append(entry.name)
                elif file_format(entry.name):
                    books += 1
    except PermissionError:
        raise HTTPException(403, "Нет доступа к папке")
    rel = target.relative_to(root).as_posix()
    rel = "" if rel == "." else rel
    return {
        "root": root.as_posix(),
        "root_exists": True,
        "path": rel,
        "abs_path": target.as_posix(),
        "parent": None if target == root else ("" if target.parent == root else target.parent.relative_to(root).as_posix()),
        "dirs": sorted(dirs, key=str.lower),
        "book_files": books,
    }


# ---------------- сканирование ----------------


@router.get("/admin/scan")
def scan_status(_: User = Depends(require_admin)) -> dict:
    return scanner.status()


@router.post("/admin/scan")
def start_scan(data: ScanRequest, _: User = Depends(require_admin)) -> dict:
    started = scanner.start(library_id=data.library_id, full=data.full)
    return {**scanner.status(), "started": started}
