"""Загрузка книг и аудиокниг из браузера.

Куда можно загружать: в свои личные медиатеки и в общие, где у пользователя есть право записи
(администратор — во все общие). Папка на диске должна быть доступна на запись (не :ro).
После загрузки пачки файлов фронтенд вызывает /done — запускается сканирование медиатеки.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
import shutil
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..access import fs_writable
from ..bookmeta import IMAGE_EXT, file_format
from ..config import UPLOAD_ROOT
from ..db import get_db, session_scope
from ..models import Book, Library, LibraryAccess, Shelf, ShelfBook, User
from ..scanner import scanner
from ..security import get_current_user

router = APIRouter(prefix="/api/uploads", tags=["uploads"])
log = logging.getLogger("selfread.uploads")

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


PERSONAL_NAME = "Мои книги"


def _media_writable() -> bool:
    try:
        UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    except OSError:
        return False
    return fs_writable(str(UPLOAD_ROOT))


def _has_personal(db: Session, user: User) -> bool:
    return db.scalar(select(Library.id).where(Library.owner_id == user.id).limit(1)) is not None


@router.get("/targets")
def targets(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    """Медиатеки, куда пользователь может загружать книги.

    Если личной медиатеки ещё нет — предлагаем её (id 0): она создастся при первой загрузке.
    """
    out = [{"id": lib.id, "name": lib.name, "scope": "personal" if lib.owner_id else "shared"} for lib in _targets(db, user)]
    if not _has_personal(db, user) and _media_writable():
        out.insert(0, {"id": 0, "name": PERSONAL_NAME, "scope": "personal", "new": True})
    return out


@router.post("/personal")
def create_personal(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Создать личную медиатеку media/<логин>/books (или вернуть уже существующую)."""
    from .admin import _personal_dir

    lib = db.scalars(select(Library).where(Library.owner_id == user.id).order_by(Library.id)).first()
    if lib is None:
        lib = Library(name=PERSONAL_NAME, path=_personal_dir(db, user), owner_id=user.id, default_access=False)
        db.add(lib)
        db.commit()
        db.refresh(lib)
    return {"id": lib.id, "name": lib.name, "scope": "personal"}


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
    shelf_id: int | None = None
    paths: list[str] = []  # пути загруженных файлов (из ответа POST /api/uploads)


def _shelve(library_id: int, shelf_id: int, paths: set[str]) -> None:
    """После сканирования: книги, в которых есть загруженные файлы, — на полку."""
    with session_scope() as db:
        shelf = db.get(Shelf, shelf_id)
        if not shelf:
            return
        have = set(db.scalars(select(ShelfBook.book_id).where(ShelfBook.shelf_id == shelf_id)))
        added = 0
        for book in db.scalars(select(Book).where(Book.library_id == library_id)):
            if book.id in have:
                continue
            files = {f.get("path") for f in json.loads(book.files or "[]")}
            if files & paths:
                db.add(ShelfBook(shelf_id=shelf_id, book_id=book.id))
                have.add(book.id)
                added += 1
        if added:
            shelf.updated_at = datetime.now(timezone.utc)
        db.commit()
        log.info("На полку %s добавлено загруженных книг: %s", shelf_id, added)


@router.post("/done")
def done(data: DoneIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Пачка загружена — найти новые книги в медиатеке (и, если выбрана, положить их на полку)."""
    lib = db.get(Library, data.library_id)
    if not lib or not _can_write(db, user, lib):
        raise HTTPException(403, "Нет права загружать в эту медиатеку")
    shelf_id = None
    if data.shelf_id:
        shelf = db.get(Shelf, data.shelf_id)
        if not shelf or shelf.owner_id != user.id:
            raise HTTPException(404, "Полка не найдена")
        shelf_id = shelf.id
    scanner.start(library_id=lib.id)
    if shelf_id and data.paths:
        paths = {_safe_rel(p).as_posix() for p in data.paths}
        lib_id = lib.id
        scanner.when_idle(lambda: _shelve(lib_id, shelf_id, paths))
    return {"ok": True}


@router.get("/status")
def status(_: User = Depends(get_current_user)) -> dict:
    """Идёт ли сканирование (чтобы показать «Добавляю в библиотеку…»)."""
    s = scanner.status()
    return {"running": s["running"], "done": s["done"], "total": s["total"]}
