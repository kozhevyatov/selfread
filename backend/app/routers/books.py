"""Библиотека: медиатеки пользователя, книги, обложки, файлы, статусы и прогресс, главная."""
from __future__ import annotations

import json
import mimetypes
import shutil
import subprocess
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..access import allowed_library_ids
from ..config import DATA_DIR
from ..db import get_db
from ..models import Book, Library, ReadState, Shelf, ShelfBook, User
from ..scanner import cover_path
from ..schemas import StateUpdate
from ..security import get_current_user, get_media_user

router = APIRouter(prefix="/api", tags=["books"])

MIME = {
    "epub": "application/epub+zip",
    "fb2": "application/x-fictionbook+xml",
    "fbz": "application/zip",
    "mobi": "application/x-mobipocket-ebook",
    "azw": "application/vnd.amazon.ebook",
    "azw3": "application/vnd.amazon.ebook",
    "pdf": "application/pdf",
    "djvu": "image/vnd.djvu",
    "cbz": "application/vnd.comicbook+zip",
    "cbr": "application/vnd.comicbook-rar",
    "cb7": "application/x-cb7",
    "txt": "text/plain; charset=utf-8",
    "rtf": "application/rtf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "odt": "application/vnd.oasis.opendocument.text",
    "html": "text/html; charset=utf-8",
    "htm": "text/html; charset=utf-8",
    "chm": "application/vnd.ms-htmlhelp",
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
    "m4b": "audio/mp4",
    "aac": "audio/aac",
    "ogg": "audio/ogg",
    "oga": "audio/ogg",
    "opus": "audio/ogg",
    "flac": "audio/flac",
    "wav": "audio/wav",
}

STATUS_LABELS = {"want": "Хочу прочитать", "reading": "Читаю", "finished": "Прочитано", "abandoned": "Брошено"}


def _split(value: str) -> list[str]:
    return [v for v in (value or "").split("; ") if v]


def _cover(book: Book) -> str | None:
    return f"/api/books/{book.id}/cover?v={book.cover_version}" if book.cover_version else None


def _state_out(state: ReadState | None) -> dict:
    if state is None:
        return {"status": "none", "progress": 0, "position": "", "chapter": "", "rating": 0, "started_at": None, "finished_at": None, "updated_at": None}
    return {
        "status": state.status,
        "progress": state.progress,
        "position": state.position,
        "chapter": state.chapter,
        "rating": state.rating,
        "started_at": state.started_at,
        "finished_at": state.finished_at,
        "updated_at": state.updated_at,
    }


def book_brief(book: Book, state: ReadState | None = None) -> dict:
    return {
        "id": book.id,
        "kind": book.kind,
        "format": book.format,
        "formats": [f["format"] for f in json.loads(book.files or "[]")] if book.kind == "ebook" else [book.format],
        "title": book.title,
        "authors": _split(book.authors),
        "series": book.series,
        "series_index": book.series_index,
        "year": book.year,
        "pages": book.pages,
        "duration": book.duration,
        "cover": _cover(book),
        "library_id": book.library_id,
        "created_at": book.created_at,
        "state": _state_out(state),
    }


def _states(db: Session, user: User, book_ids: list[int]) -> dict[int, ReadState]:
    if not book_ids:
        return {}
    return {s.book_id: s for s in db.scalars(select(ReadState).where(ReadState.user_id == user.id, ReadState.book_id.in_(book_ids)))}


def briefs(db: Session, user: User, books: list[Book]) -> list[dict]:
    states = _states(db, user, [b.id for b in books])
    return [book_brief(b, states.get(b.id)) for b in books]


def _get_book(db: Session, user: User, book_id: int) -> Book:
    book = db.get(Book, book_id)
    if not book or book.library_id not in allowed_library_ids(db, user, scoped=False):
        raise HTTPException(404, "Книга не найдена")
    return book


def _like(value: str) -> str:
    esc = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{esc.lower()}%"


# ---------------- медиатеки ----------------


@router.get("/libraries")
def my_libraries(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    ids = allowed_library_ids(db, user, scoped=False)
    if not ids:
        return []
    libs = db.scalars(select(Library).where(Library.id.in_(ids)).order_by(Library.owner_id.is_(None), Library.name))
    return [
        {
            "id": lib.id,
            "name": lib.name,
            "scope": "personal" if lib.owner_id else "shared",
            "mine": lib.owner_id == user.id,
            "book_count": lib.book_count,
            "audio_count": lib.audio_count,
        }
        for lib in libs
    ]


# ---------------- книги ----------------

SORTS = {
    "added": (Book.created_at.desc(), Book.id.desc()),
    "title": (Book.sort_title.asc(), Book.id.asc()),
    "author": (Book.author_sort.asc(), Book.series.asc(), Book.series_index.asc(), Book.sort_title.asc()),
    "series": (Book.series.asc(), Book.series_index.asc(), Book.sort_title.asc()),
    "year": (Book.year.desc(), Book.sort_title.asc()),
}


@router.get("/books")
def list_books(
    q: str = "",
    kind: str = "",
    format: str = "",  # noqa: A002
    status: str = "",
    library: int | None = None,
    shelf: int | None = None,
    author: str = "",
    series: str = "",
    sort: str = "added",
    offset: int = Query(0, ge=0),
    limit: int = Query(60, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    ids = allowed_library_ids(db, user, scoped=library is None and shelf is None)
    if library is not None:
        ids = [i for i in ids if i == library]
    query = select(Book).where(Book.library_id.in_(ids or [-1]))
    if q.strip():
        for word in q.split()[:6]:
            pat = _like(word)
            query = query.where(
                or_(
                    func.lower(Book.title).like(pat, escape="\\"),
                    func.lower(Book.authors).like(pat, escape="\\"),
                    func.lower(Book.series).like(pat, escape="\\"),
                    func.lower(Book.narrator).like(pat, escape="\\"),
                )
            )
    if kind in ("ebook", "audio"):
        query = query.where(Book.kind == kind)
    if format:
        query = query.where(or_(Book.format == format, Book.files.like(f'%"format": "{format}"%')))
    if author:
        query = query.where(func.lower(Book.authors).like(_like(author), escape="\\"))
    if series:
        query = query.where(Book.series == series)
    if shelf is not None:
        sh = db.get(Shelf, shelf)
        if not sh or (sh.owner_id != user.id and not sh.is_shared):
            raise HTTPException(404, "Полка не найдена")
        query = query.where(Book.id.in_(select(ShelfBook.book_id).where(ShelfBook.shelf_id == shelf)))
    if status:
        if status == "none":
            started = select(ReadState.book_id).where(ReadState.user_id == user.id, ReadState.status != "none")
            query = query.where(Book.id.not_in(started))
        else:
            query = query.join(ReadState, and_(ReadState.book_id == Book.id, ReadState.user_id == user.id)).where(ReadState.status == status)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    order = SORTS.get(sort, SORTS["added"])
    books = list(db.scalars(query.order_by(*order).offset(offset).limit(limit)))
    return {"total": total, "items": briefs(db, user, books)}


@router.get("/books/facets")
def facets(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Что есть в библиотеке: форматы и количество книг по видам — для фильтров."""
    ids = allowed_library_ids(db, user) or [-1]
    formats = dict(db.execute(select(Book.format, func.count()).where(Book.library_id.in_(ids)).group_by(Book.format)).all())
    kinds = dict(db.execute(select(Book.kind, func.count()).where(Book.library_id.in_(ids)).group_by(Book.kind)).all())
    return {"formats": formats, "kinds": kinds}


@router.get("/books/{book_id}")
def get_book(book_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    book = _get_book(db, user, book_id)
    state = db.get(ReadState, (user.id, book.id))
    lib = db.get(Library, book.library_id)
    data = book_brief(book, state)
    files = json.loads(book.files or "[]")
    data.update(
        {
            "narrator": book.narrator,
            "language": book.language,
            "publisher": book.publisher,
            "isbn": book.isbn,
            "subjects": _split(book.subjects),
            "description": book.description,
            "size": book.size,
            "files": [{k: v for k, v in f.items() if k != "path"} | {"name": Path(f["path"]).name} for f in files],
            "chapters": json.loads(book.chapters or "[]"),
            "library": {"id": lib.id, "name": lib.name, "scope": "personal" if lib.owner_id else "shared"} if lib else None,
            "scan_error": book.scan_error,
            "shelves": [
                {"id": s.id, "name": s.name}
                for s in db.scalars(
                    select(Shelf)
                    .join(ShelfBook, ShelfBook.shelf_id == Shelf.id)
                    .where(ShelfBook.book_id == book.id, Shelf.owner_id == user.id)
                    .order_by(Shelf.position, Shelf.name)
                )
            ],
        }
    )
    # другие книги серии
    if book.series:
        ids = allowed_library_ids(db, user, scoped=False)
        same = list(
            db.scalars(
                select(Book)
                .where(Book.series == book.series, Book.library_id.in_(ids), Book.id != book.id)
                .order_by(Book.series_index.asc(), Book.sort_title)
                .limit(30)
            )
        )
        data["series_books"] = briefs(db, user, same)
    else:
        data["series_books"] = []
    return data


@router.get("/books/{book_id}/cover")
def book_cover(book_id: int, db: Session = Depends(get_db), user: User = Depends(get_media_user)) -> FileResponse:
    book = _get_book(db, user, book_id)
    path = cover_path(book.id)
    if not book.cover_version or not path.is_file():
        raise HTTPException(404, "Обложки нет")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "private, max-age=31536000, immutable"})


def _file_headers(fmt: str) -> dict[str, str]:
    headers = {"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"}
    if fmt in ("html", "htm", "chm"):
        # HTML-книга не должна выполнять скрипты от имени сайта (иначе могла бы украсть сессию)
        headers["Content-Security-Policy"] = "sandbox"
    return headers


def _file_response(db: Session, book: Book, rel: str, fmt: str, download: bool) -> FileResponse:
    lib = db.get(Library, book.library_id)
    if lib is None:
        raise HTTPException(404, "Медиатека не найдена")
    lib_root = Path(lib.path)
    path = (lib_root / rel).resolve()
    if lib_root.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "Файл не найден — возможно, его переместили. Запустите сканирование.")
    media_type = MIME.get(fmt) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(
        path,
        media_type=media_type,
        filename=path.name if download else None,
        content_disposition_type="attachment" if download else "inline",
        headers=_file_headers(fmt),
    )


@router.get("/books/{book_id}/file")
def book_file(
    book_id: int,
    fmt: str = "",
    download: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_media_user),
) -> FileResponse:
    """Файл электронной книги (основной формат или указанный ?fmt=pdf). Поддерживает Range."""
    book = _get_book(db, user, book_id)
    files = json.loads(book.files or "[]")
    if book.kind == "audio":
        raise HTTPException(400, "Это аудиокнига — используйте /audio/{номер}")
    entry = next((f for f in files if f["format"] == fmt), None) if fmt else (files[0] if files else None)
    if not entry:
        raise HTTPException(404, "Такого формата у книги нет")
    return _file_response(db, book, entry["path"], entry["format"], download)


@router.get("/books/{book_id}/audio/{index}")
def book_audio(
    book_id: int,
    index: int,
    download: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_media_user),
) -> FileResponse:
    """Аудиофайл аудиокниги по номеру (Range поддерживается — перемотка работает)."""
    book = _get_book(db, user, book_id)
    files = json.loads(book.files or "[]")
    if book.kind != "audio" or not 0 <= index < len(files):
        raise HTTPException(404, "Файл не найден")
    entry = files[index]
    return _file_response(db, book, entry["path"], entry.get("format", book.format), download)


# ---------------- страницы DjVu картинками (для читалки) ----------------

_render_lock = threading.BoundedSemaphore(2)  # слабому NAS — не больше двух ddjvu одновременно


@router.get("/books/{book_id}/page/{page}")
def book_page_image(
    book_id: int,
    page: int,
    w: int = Query(1400, ge=200, le=3000),
    db: Session = Depends(get_db),
    user: User = Depends(get_media_user),
) -> FileResponse:
    """Страница DjVu как WebP. Рендерим через ddjvu и кэшируем в data/pages."""
    book = _get_book(db, user, book_id)
    files = json.loads(book.files or "[]")
    entry = next((f for f in files if f["format"] == "djvu"), None)
    if not entry:
        raise HTTPException(404, "У книги нет DjVu")
    if page < 1 or (book.pages and page > book.pages):
        raise HTTPException(404, "Нет такой страницы")
    lib = db.get(Library, book.library_id)
    src = (Path(lib.path) / entry["path"]).resolve() if lib else None
    if not src or not src.is_file():
        raise HTTPException(404, "Файл не найден")
    cache_dir = DATA_DIR / "pages" / str(book.id)
    target = cache_dir / f"{page}-{w}-{book.fingerprint[:8]}.webp"
    if not target.is_file():
        if not shutil.which("ddjvu"):
            raise HTTPException(501, "На сервере нет ddjvu (djvulibre)")
        with _render_lock:
            if not target.is_file():
                cache_dir.mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory(prefix="sr-djvu-") as tmp:
                    out = Path(tmp) / "p.pnm"
                    try:
                        subprocess.run(
                            ["ddjvu", "-format=pnm", f"-page={page}", f"-size={w}x{w * 2}", str(src), str(out)],
                            capture_output=True,
                            timeout=120,
                        )
                    except (OSError, subprocess.SubprocessError):
                        raise HTTPException(500, "Не удалось отрисовать страницу")
                    if not out.is_file():
                        raise HTTPException(500, "Не удалось отрисовать страницу")
                    from PIL import Image  # noqa: PLC0415

                    with Image.open(out) as img:
                        tmp_target = target.with_suffix(".tmp")
                        img.convert("RGB").save(tmp_target, "WEBP", quality=82, method=4)
                        tmp_target.replace(target)
    return FileResponse(target, media_type="image/webp", headers={"Cache-Control": "private, max-age=31536000, immutable"})


# ---------------- статус и прогресс ----------------


@router.put("/books/{book_id}/state")
def update_state(book_id: int, data: StateUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    book = _get_book(db, user, book_id)
    state = db.get(ReadState, (user.id, book.id))
    now = datetime.now(timezone.utc)
    if state is None:
        state = ReadState(user_id=user.id, book_id=book.id, status="none", progress=0, position="", chapter="", rating=0)
        db.add(state)
    if data.status is not None and data.status != state.status:
        state.status = data.status
        if data.status == "reading" and state.started_at is None:
            state.started_at = now
        if data.status == "finished":
            state.finished_at = now
            if data.progress is None:
                state.progress = 1.0
        elif state.finished_at is not None and data.status in ("reading", "want", "none"):
            state.finished_at = None
    if data.progress is not None:
        state.progress = data.progress
        # открыл и читает — значит «Читаю» (если не отмечено иначе)
        if data.status is None and state.status in ("none", "want") and data.progress > 0:
            state.status = "reading"
            state.started_at = state.started_at or now
    if data.position is not None:
        state.position = data.position
    if data.chapter is not None:
        state.chapter = data.chapter
    if data.rating is not None:
        state.rating = data.rating
    state.updated_at = now
    db.commit()
    return _state_out(state)


# ---------------- главная ----------------


@router.get("/home")
def home(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    ids = allowed_library_ids(db, user) or [-1]
    reading_rows = list(
        db.execute(
            select(Book, ReadState)
            .join(ReadState, and_(ReadState.book_id == Book.id, ReadState.user_id == user.id))
            .where(ReadState.status == "reading", Book.library_id.in_(allowed_library_ids(db, user, scoped=False) or [-1]))
            .order_by(ReadState.updated_at.desc())
            .limit(12)
        )
    )
    recent = list(db.scalars(select(Book).where(Book.library_id.in_(ids)).order_by(Book.created_at.desc(), Book.id.desc()).limit(18)))
    want = list(
        db.scalars(
            select(Book)
            .join(ReadState, and_(ReadState.book_id == Book.id, ReadState.user_id == user.id))
            .where(ReadState.status == "want", Book.library_id.in_(ids))
            .order_by(ReadState.updated_at.desc())
            .limit(12)
        )
    )
    counts = dict(
        db.execute(
            select(ReadState.status, func.count())
            .join(Book, Book.id == ReadState.book_id)
            .where(ReadState.user_id == user.id, Book.library_id.in_(ids))
            .group_by(ReadState.status)
        ).all()
    )
    total = db.scalar(select(func.count()).select_from(Book).where(Book.library_id.in_(ids))) or 0
    from .shelves import shelves_for  # noqa: PLC0415

    return {
        "reading": [book_brief(b, s) for b, s in reading_rows],
        "recent": briefs(db, user, recent),
        "want": briefs(db, user, want),
        "shelves": shelves_for(db, user)[:8],
        "counts": {"total": total, **{k: int(v) for k, v in counts.items()}},
        "status_labels": STATUS_LABELS,
    }
