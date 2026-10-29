"""Загрузка книг и аудиокниг из браузера.

Куда можно загружать: в свои личные медиатеки и в общие, где у пользователя есть право записи
(администратор — во все общие). Папка на диске должна быть доступна на запись (не :ro).
После загрузки пачки файлов фронтенд вызывает /done — запускается сканирование медиатеки.
"""
from __future__ import annotations

import os
import re
import shutil
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..access import fs_writable
from ..bookmeta import IMAGE_EXT, file_format
from ..db import get_db
from ..models import Library, LibraryAccess, User
from ..scanner import scanner
from ..security import get_current_user

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

MAX_FILE = 2048 * 1024 * 1024  # 2 ГБ на файл
EXTRA_OK = {".opf"}  # metadata.opf из библиотеки Calibre


def _can_write(db: Session, user: User, lib: Library) -> bool:
    if not lib.enabled:
        return False
    if lib.owner_id is not None:
        return lib.owner_id == user.id
    if user.is_admin:
        return True
    row = db.get(LibraryAccess, (user.id, lib.id))
    return bool(row and row.can_write)


def _targets(db: Session, user: User) -> list[Library]:
    libs = db.scalars(select(Library).where(Library.enabled.is_(True)).order_by(Library.owner_id.is_(None), Library.name))
    return [lib for lib in libs if _can_write(db, user, lib) and fs_writable(lib.path)]


@router.get("/targets")
def targets(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    """Медиатеки, куда пользователь может загружать книги."""
    return [{"id": lib.id, "name": lib.name, "scope": "personal" if lib.owner_id else "shared"} for lib in _targets(db, user)]


_BAD = re.compile(r'[\x00-\x1f<>:"\\|?*]+')


def _clean_part(part: str) -> str:
    part = _BAD.sub("_", part).strip().strip(".")
    return part[:180]


def _safe_rel(raw: str) -> PurePosixPath:
    """Путь от корня медиатеки без «..», абсолютных путей и служебных символов."""
    parts = [_clean_part(p) for p in raw.replace("\\", "/").split("/")]
    parts = [p for p in parts if p and p not in (".", "..") and not p.startswith(("@", "#"))]
    return PurePosixPath(*parts) if parts else PurePosixPath()


def _free_name(target: Path) -> Path:
    """Не перезаписываем существующий файл: «Книга (2).epub»."""
    if not target.exists():
        return target
    stem, suffix = target.name, ""
    if target.name.lower().endswith(".fb2.zip"):
        stem, suffix = target.name[: -len(".fb2.zip")], target.name[-len(".fb2.zip"):]
    else:
        stem, suffix = target.stem, target.suffix
    for n in range(2, 1000):
        candidate = target.with_name(f"{stem} ({n}){suffix}")
        if not candidate.exists():
            return candidate
    raise HTTPException(409, "Слишком много файлов с таким именем")


@router.post("")
def upload(
    library_id: int = Form(...),
    path: str = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Один файл. path — путь внутри медиатеки вместе с именем файла (папка аудиокниги и т.п.)."""
    lib = db.get(Library, library_id)
    if not lib or not _can_write(db, user, lib):
        raise HTTPException(403, "Нет права загружать в эту медиатеку")
    root = Path(lib.path)
    if not fs_writable(lib.path):
        raise HTTPException(400, "Папка медиатеки доступна только для чтения")
    rel = _safe_rel(path or file.filename or "")
    if not rel.name:
        raise HTTPException(422, "Пустое имя файла")
    suffix = PurePosixPath(rel.name.lower()).suffix
    if not (file_format(rel.name) or suffix in IMAGE_EXT or suffix in EXTRA_OK):
        raise HTTPException(415, f"Формат не поддерживается: {rel.name}")
    target = (root / rel).resolve()
    if root.resolve() not in target.parents:
        raise HTTPException(400, "Недопустимый путь")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise HTTPException(400, f"Не удалось создать папку: {exc.strerror}")
    target = _free_name(target)
    tmp = target.with_name(f".{target.name}.uploading")
    size = 0
    try:
        with open(tmp, "wb") as out:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_FILE:
                    raise HTTPException(413, "Файл больше 2 ГБ")
                out.write(chunk)
        os.replace(tmp, target)
    except HTTPException:
        tmp.unlink(missing_ok=True)
        raise
    except OSError as exc:
        tmp.unlink(missing_ok=True)
        raise HTTPException(500, f"Не удалось сохранить файл: {exc.strerror}")
    return {"path": target.relative_to(root.resolve()).as_posix(), "size": size}


class DoneIn(BaseModel):
    library_id: int


@router.post("/done")
def done(data: DoneIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Пачка загружена — найти новые книги в медиатеке."""
    lib = db.get(Library, data.library_id)
    if not lib or not _can_write(db, user, lib):
        raise HTTPException(403, "Нет права загружать в эту медиатеку")
    scanner.start(library_id=lib.id)
    return {"ok": True}


@router.get("/status")
def status(_: User = Depends(get_current_user)) -> dict:
    """Идёт ли сканирование (чтобы показать «Добавляю в библиотеку…»)."""
    s = scanner.status()
    return {"running": s["running"], "done": s["done"], "total": s["total"]}
