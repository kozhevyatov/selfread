"""Ручная правка карточки книги: название, авторы, серия, описание…, обложка; поиск данных в интернете.

Исправленные поля запоминаются в Book.locked — сканер их больше не перезаписывает
(пока не нажать «Вернуть данные из файла»).
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import bookmeta
from ..access import can_write
from ..db import get_db
from ..lookup import LookupError_, fetch_image, search
from ..models import Book, Library, User
from ..scanner import COVER_DIR, author_sort, cover_path, scanner, sort_title
from ..schemas import CoverUrl, MetaUpdate
from ..security import get_current_user
from .books import _get_book, _split, get_book

router = APIRouter(prefix="/api/books", tags=["book-edit"])

MAX_COVER = 15 * 1024 * 1024


def locked_fields(book: Book) -> set[str]:
    return {f for f in (book.locked or "").split(",") if f}


def _editable(db: Session, user: User, book_id: int) -> Book:
    book = _get_book(db, user, book_id)
    lib = db.get(Library, book.library_id)
    if not lib or not can_write(db, user, lib):
        raise HTTPException(403, "Менять карточку книги может владелец медиатеки или администратор")
    return book


def _lock(book: Book, *fields: str) -> None:
    book.locked = ",".join(sorted(locked_fields(book) | set(fields)))[:512]


def _clean_list(values: list[str]) -> list[str]:
    return [v for v in dict.fromkeys(" ".join(v.split()) for v in values) if v]


@router.patch("/{book_id}/meta")
def update_meta(book_id: int, data: MetaUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    book = _editable(db, user, book_id)
    changed: list[str] = []

    def set_field(name: str, value: object) -> None:
        if getattr(book, name) != value:
            setattr(book, name, value)
            changed.append(name)

    if data.title is not None:
        title = " ".join(data.title.split())
        if title:
            set_field("title", title[:512])
            book.sort_title = sort_title(book.title)
    if data.authors is not None:
        authors = _clean_list(data.authors)
        if "; ".join(authors) != book.authors:
            book.authors = "; ".join(authors)[:1024]
            book.author_sort = author_sort(authors[0]) if authors else ""
            changed.append("authors")
    for name, limit in (("narrator", 512), ("series", 512), ("publisher", 255), ("language", 16), ("isbn", 32)):
        value = getattr(data, name)
        if value is not None:
            set_field(name, " ".join(value.split())[:limit])
    if data.description is not None:
        set_field("description", data.description.strip())
    if data.subjects is not None:
        subjects = "; ".join(_clean_list(data.subjects))[:1024]
        set_field("subjects", subjects)
    if data.clear_series_index:
        set_field("series_index", None)
    elif data.series_index is not None:
        set_field("series_index", data.series_index)
    if data.clear_year:
        set_field("year", None)
    elif data.year is not None:
        set_field("year", data.year)
    if changed:
        _lock(book, *changed)
        book.updated_at = datetime.now(timezone.utc)
        db.commit()
    return get_book(book.id, db, user)


def _save_cover(db: Session, book: Book, data: bytes) -> None:
    webp = bookmeta.make_cover(data)
    if not webp:
        raise HTTPException(422, "Не удалось прочитать картинку")
    COVER_DIR.mkdir(parents=True, exist_ok=True)
    path = cover_path(book.id)
    tmp = path.with_suffix(f".{time.time_ns()}.tmp")
    tmp.write_bytes(webp)
    tmp.replace(path)
    book.cover_version = int(time.time())
    _lock(book, "cover")
    db.commit()


@router.post("/{book_id}/cover")
def upload_cover(book_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    book = _editable(db, user, book_id)
    data = file.file.read(MAX_COVER + 1)
    if len(data) > MAX_COVER:
        raise HTTPException(413, "Картинка больше 15 МБ")
    _save_cover(db, book, data)
    return get_book(book.id, db, user)


@router.post("/{book_id}/cover/url")
def cover_from_url(book_id: int, data: CoverUrl, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    book = _editable(db, user, book_id)
    try:
        image = fetch_image(data.url.strip())
    except LookupError_ as exc:
        raise HTTPException(422, str(exc))
    _save_cover(db, book, image)
    return get_book(book.id, db, user)


@router.post("/{book_id}/meta/reset")
def reset_meta(book_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Забыть ручные правки: при следующем сканировании данные возьмутся из файла."""
    book = _editable(db, user, book_id)
    book.locked = ""
    book.fingerprint = ""  # сканер перечитает книгу
    db.commit()
    scanner.start(library_id=book.library_id)
    return {"ok": True}


@router.get("/{book_id}/lookup")
def lookup(book_id: int, q: str = "", isbn: str = "", db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Варианты данных книги из Google Books и Open Library."""
    book = _editable(db, user, book_id)
    if not q and not isbn:
        authors = _split(book.authors)
        q = f"{book.title} {authors[0] if authors else ''}".strip()
        isbn = book.isbn
    try:
        return search(q, isbn)
    except LookupError_ as exc:
        raise HTTPException(422, str(exc))
