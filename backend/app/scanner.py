"""Сканер медиатек: находит книги и аудиокниги, читает метаданные и обложки.

Правила раскладки:
- Электронная книга = файлы с одним именем в одной папке («Книга.epub» + «Книга.fb2» — одна
  книга в двух форматах). Основной формат выбирается по FORMAT_PRIORITY.
- Аудиокнига = папка с аудиофайлами (подпапки CD1/Disc 2/Диск 3 склеиваются с родителем)
  или отдельный файл .m4b.
- Библиотека Calibre: metadata.opf и cover.jpg рядом с книгой подхватываются автоматически.
- Обложка: картинка с тем же именем, что и книга; cover/folder/front.jpg, если книга в папке
  одна; иначе — из самого файла.

Повторное сканирование быстрое: книга перечитывается, только если изменился «отпечаток»
(размеры и даты файлов). Полное сканирование (full) перечитывает всё.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import bookmeta
from .bookmeta import AUDIO_FORMATS, FORMAT_PRIORITY, IMAGE_EXT, Meta, file_format
from .config import COVER_DIR
from .db import on_ready, session_scope
from .models import Book, Library

log = logging.getLogger("uvicorn.error")

SKIP_DIR = re.compile(r"^(\.|@|#recycle$|#snapshot$|lost\+found$)", re.I)
DISC_DIR = re.compile(r"^(cd|disc|disk|диск|часть|part)[\s._-]*\d+\b.*$", re.I)
COVER_NAMES = ("cover", "folder", "front", "обложка")


def key_hash(key: str) -> str:
    return hashlib.sha1(key.encode("utf-8", "surrogatepass")).hexdigest()


def folder_of(key: str) -> str:
    """Папка книги от корня медиатеки: «Толстой/Война и мир» (для аудиокниги — папка, где лежит её папка)."""
    parent = PurePosixPath(key or ".").parent.as_posix()
    return "" if parent == "." else parent


def natural_key(s: str) -> list:
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def sort_title(title: str) -> str:
    t = title.lower().strip()
    t = re.sub(r"^[\s\"'«»„“”(\[.…-]+", "", t)
    return t[:500]


def author_sort(author: str) -> str:
    """«Лев Николаевич Толстой» → «толстой лев николаевич» (сортировка по фамилии)."""
    parts = author.split()
    if len(parts) >= 2 and "," not in author:
        parts = [parts[-1], *parts[:-1]]
    return " ".join(parts).lower()[:500]


# ---------------- обход папки ----------------


@dataclass
class FileInfo:
    rel: str
    size: int
    mtime: float


@dataclass
class Found:
    kind: str  # ebook | audio
    key: str
    files: list[tuple[str, FileInfo]] = field(default_factory=list)  # (формат, файл)
    cover_file: FileInfo | None = None
    opf_file: FileInfo | None = None

    def fingerprint(self) -> str:
        parts = [f"{f.rel}|{f.size}|{int(f.mtime)}" for _, f in self.files]
        for extra in (self.cover_file, self.opf_file):
            if extra:
                parts.append(f"{extra.rel}|{extra.size}|{int(extra.mtime)}")
        return hashlib.sha1("\n".join(sorted(parts)).encode("utf-8", "surrogatepass")).hexdigest()


def _utf8_ok(name: str) -> bool:
    """Имена не в UTF-8 (cp1251 из старых архивов) база сохранить не сможет — пропускаем с предупреждением."""
    try:
        name.encode("utf-8")
        return True
    except UnicodeEncodeError:
        log.warning("Пропущен файл с именем не в UTF-8: %r", name)
        return False


def _rel(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def subtree_root(sub: str) -> str:
    """Папка для частичного сканирования: CD1/Disc 2 — часть книги из родительской папки, сканируем родителя."""
    sub = sub.strip("/")
    while sub and DISC_DIR.match(sub.rsplit("/", 1)[-1]):
        sub = sub.rsplit("/", 1)[0] if "/" in sub else ""
    return sub


def in_subtree(key: str, sub: str) -> bool:
    return not sub or key == sub or key.startswith(f"{sub}/")


def discover(root: Path, stop: threading.Event | None = None, sub: str = "") -> list[Found]:
    """Найти все книги в папке медиатеки (sub — только в этой подпапке, ключи всё равно от корня)."""
    ebooks: dict[str, Found] = {}
    audio: dict[str, Found] = {}
    visited: set[tuple[int, int]] = set()
    start = root / sub if sub else root
    for dirpath, dirnames, filenames in os.walk(start, followlinks=True):
        if stop is not None and stop.is_set():
            break
        dirnames[:] = sorted((d for d in dirnames if not SKIP_DIR.match(d) and _utf8_ok(d)), key=natural_key)
        # защита от зацикленных символических ссылок
        try:
            st = os.stat(dirpath)
            ident = (st.st_dev, st.st_ino)
        except OSError:
            continue
        if ident in visited:
            dirnames[:] = []
            continue
        visited.add(ident)
        here = Path(dirpath)
        rel_dir = _rel(root, here) if here != root else ""
        stems: dict[str, list[tuple[str, FileInfo]]] = {}
        audio_files: list[tuple[str, FileInfo]] = []
        images: dict[str, FileInfo] = {}
        opf: FileInfo | None = None
        m4b_files: list[tuple[str, FileInfo]] = []
        for name in filenames:
            if name.startswith((".", "._")) or not _utf8_ok(name):
                continue
            full = here / name
            try:
                st = full.stat()
            except OSError:
                continue
            info = FileInfo(_rel(root, full), st.st_size, st.st_mtime)
            low = name.lower()
            suffix = PurePosixPath(low).suffix
            if suffix in IMAGE_EXT:
                images[PurePosixPath(low).stem] = info
                continue
            if low == "metadata.opf":
                opf = info
                continue
            fmt = file_format(name)
            if fmt is None:
                continue
            if fmt in AUDIO_FORMATS:
                if fmt == "m4b":
                    m4b_files.append((fmt, info))
                else:
                    audio_files.append((fmt, info))
                continue
            stem = bookmeta.book_stem(name)
            stems.setdefault(stem.lower(), []).append((fmt, info))

        generic_cover = next((images[n] for n in COVER_NAMES if n in images), None)
        single = len(stems) == 1 and not audio_files and not m4b_files

        # каждый .m4b — отдельная аудиокнига
        for fmt, info in m4b_files:
            stem = bookmeta.book_stem(PurePosixPath(info.rel).name)
            key = f"{rel_dir}/{stem}" if rel_dir else stem
            found = Found("audio", key, [(fmt, info)])
            found.cover_file = images.get(stem.lower()) or (generic_cover if len(m4b_files) == 1 and not stems else None)
            audio[key] = found

        for stem_low, files in stems.items():
            files.sort(key=lambda f: FORMAT_PRIORITY.index(f[0]) if f[0] in FORMAT_PRIORITY else 99)
            stem = bookmeta.book_stem(PurePosixPath(files[0][1].rel).name)
            key = f"{rel_dir}/{stem}" if rel_dir else stem
            found = Found("ebook", key, files)
            found.cover_file = images.get(stem_low) or (generic_cover if single else None)
            if single:
                found.opf_file = opf
            ebooks[key] = found

        if audio_files:
            # CD1, Disc 2… — части одной книги из родительской папки
            if rel_dir and DISC_DIR.match(here.name):
                key = rel_dir.rsplit("/", 1)[0] if "/" in rel_dir else ""
            else:
                key = rel_dir
            key = key or "."
            found = audio.get(key)
            if found is None:
                found = audio[key] = Found("audio", key)
            found.files.extend(audio_files)
            if found.cover_file is None:
                found.cover_file = generic_cover or (next(iter(images.values())) if len(images) == 1 else None)
            # обложка в родительской папке для CD1/CD2
            if found.cover_file is None and key != rel_dir and key != ".":
                parent = root / key
                for n in COVER_NAMES:
                    for ext in (".jpg", ".jpeg", ".png", ".webp"):
                        p = parent / f"{n}{ext}"
                        if p.is_file():
                            st = p.stat()
                            found.cover_file = FileInfo(_rel(root, p), st.st_size, st.st_mtime)
                            break
                    if found.cover_file:
                        break

    for found in audio.values():
        found.files.sort(key=lambda f: natural_key(f[1].rel))
    return [*ebooks.values(), *audio.values()]


# ---------------- чтение книги ----------------


def _apply_meta(book: Book, meta: Meta, fallback_title: str, fallback_authors: list[str]) -> None:
    """Записать метаданные из файла. Поля, исправленные вручную (book.locked), не трогаем."""
    locked = {f for f in (book.locked or "").split(",") if f}
    title = (meta.title or fallback_title).strip() or fallback_title
    authors = [a for a in dict.fromkeys(" ".join(a.split()) for a in (meta.authors or fallback_authors)) if a]
    if "title" not in locked:
        book.title = title[:512]
        book.sort_title = sort_title(title)
    if "authors" not in locked:
        book.authors = "; ".join(authors)[:1024]
        book.author_sort = author_sort(authors[0]) if authors else ""
    values = {
        "narrator": meta.narrator[:512],
        "series": meta.series[:512],
        "series_index": meta.series_index,
        "language": meta.language[:16],
        "publisher": meta.publisher[:255],
        "year": meta.year,
        "isbn": meta.isbn[:32],
        "subjects": "; ".join(dict.fromkeys(s.strip() for s in meta.subjects if s.strip()))[:1024],
        "description": meta.description,
    }
    for name, value in values.items():
        if name not in locked:
            setattr(book, name, value)
    book.pages = meta.pages


def _merge(primary: Meta, other: Meta) -> Meta:
    """Дополнить пустые поля primary значениями из other."""
    for name in ("title", "narrator", "series", "language", "publisher", "isbn", "description"):
        if not getattr(primary, name) and getattr(other, name):
            setattr(primary, name, getattr(other, name))
    for name in ("series_index", "year", "pages"):
        if getattr(primary, name) is None and getattr(other, name) is not None:
            setattr(primary, name, getattr(other, name))
    if not primary.authors:
        primary.authors = other.authors
    if not primary.subjects:
        primary.subjects = other.subjects
    if primary.cover is None:
        primary.cover = other.cover
    return primary


def read_found(root: Path, found: Found) -> tuple[Meta, list[dict], str]:
    """Метаданные найденной книги, список файлов (JSON) и ошибка (если была)."""
    error = ""
    if found.kind == "ebook":
        meta = Meta()
        # основной формат; если в нём пусто — дополняем из остальных (не больше трёх файлов)
        for fmt, info in found.files[:3]:
            m = bookmeta.read_ebook(root / info.rel, fmt)
            meta = _merge(meta, m)
            if meta.title and meta.authors and meta.cover is not None:
                break
        if found.opf_file:
            try:
                opf = bookmeta.read_opf_file(root / found.opf_file.rel)
                opf.cover = None
                meta = _merge(opf, meta)  # данные Calibre важнее того, что внутри файла
            except Exception as exc:  # noqa: BLE001
                error = f"metadata.opf: {exc}"[:500]
        files = [{"format": fmt, "path": info.rel, "size": info.size} for fmt, info in found.files]
    else:
        first = root / found.files[0][1].rel
        meta = bookmeta.read_audio(first)
        files = []
        total = 0.0
        single = len(found.files) == 1
        for i, (fmt, info) in enumerate(found.files):
            if single:
                title, duration = "", meta.duration
            else:
                title, duration = bookmeta.read_audio_track(root / info.rel)
            total += duration
            files.append(
                {
                    "path": info.rel,
                    "format": fmt,
                    "title": title or PurePosixPath(info.rel).stem,
                    "duration": round(duration, 3),
                    "size": info.size,
                    "index": i,
                }
            )
        meta.duration = total
        # название из тегов дорожки (без альбома) у многофайловой книги ненадёжно — берём имя папки
        if not single and meta.title and meta.title == files[0]["title"]:
            meta.title = ""
    if found.cover_file:
        try:
            meta.cover = (root / found.cover_file.rel).read_bytes()
        except OSError:
            pass
    return meta, files, error


def _fallback_names(found: Found) -> tuple[str, list[str]]:
    if found.kind == "audio":
        name = PurePosixPath(found.key).name if found.key != "." else "Аудиокнига"
        if len(found.files) == 1:
            name = bookmeta.book_stem(PurePosixPath(found.files[0][1].rel).name)
        return bookmeta.title_from_filename(name + ".x")
    return bookmeta.title_from_filename(PurePosixPath(found.files[0][1].rel).name)


def cover_path(book_id: int) -> Path:
    return COVER_DIR / f"{book_id}.webp"


def _save_cover(book: Book, data: bytes | None) -> None:
    path = cover_path(book.id)
    webp = bookmeta.make_cover(data) if data else None
    if webp:
        COVER_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{time.time_ns()}.tmp")
        tmp.write_bytes(webp)
        tmp.replace(path)
        book.cover_version = int(time.time())
    else:
        path.unlink(missing_ok=True)
        book.cover_version = 0


# ---------------- сканирование медиатеки ----------------


class Scanner:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._queue: list[tuple[int | None, bool, str]] = []
        self._after: list = []  # что сделать, когда очередь сканирования опустеет
        self._status: dict = {"running": False, "library": None, "library_id": None, "folder": "", "done": 0, "total": 0, "current": "", "started_at": None, "finished_at": None, "added": 0, "updated": 0, "removed": 0}

    def status(self) -> dict:
        with self._lock:
            return dict(self._status)

    def start(self, library_id: int | None = None, full: bool = False, sub: str = "") -> bool:
        """Поставить сканирование в очередь (library_id=None — все медиатеки; sub — только эта папка медиатеки).
        Возвращает True, если запущено сейчас."""
        sub = subtree_root(sub) if library_id is not None else ""
        with self._lock:
            # если вся медиатека уже в очереди — отдельная папка не нужна
            if (library_id, full, sub) not in self._queue and (library_id, full, "") not in self._queue:
                self._queue.append((library_id, full, sub))
            if self._thread is not None and self._thread.is_alive():
                return False
            self._thread = threading.Thread(target=self._run, name="scanner", daemon=True)
            self._thread.start()
            return True

    def when_idle(self, fn) -> None:  # noqa: ANN001
        """Вызвать fn() после окончания текущих сканирований (например, разложить загруженное по полкам)."""
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                self._after.append(fn)
                return
        self._call(fn)

    @staticmethod
    def _call(fn) -> None:  # noqa: ANN001
        try:
            fn()
        except Exception:  # noqa: BLE001
            log.exception("Ошибка задачи после сканирования")

    def _set(self, **kw) -> None:  # noqa: ANN003
        with self._lock:
            self._status.update(kw)

    def _run(self) -> None:
        while True:
            with self._lock:
                after: list = []
                if not self._queue:
                    after, self._after = self._after, []
                    if not after:
                        self._status.update(running=False, current="", finished_at=datetime.now(timezone.utc).isoformat())
                        self._thread = None
                        return
            if after:
                for fn in after:
                    self._call(fn)
                continue
            with self._lock:
                if not self._queue:
                    continue
                library_id, full, sub = self._queue.pop(0)
                self._status.update(running=True, started_at=datetime.now(timezone.utc).isoformat(), added=0, updated=0, removed=0)
            try:
                with session_scope() as db:
                    q = select(Library.id).where(Library.enabled.is_(True))
                    if library_id is not None:
                        q = select(Library.id).where(Library.id == library_id)
                    ids = list(db.scalars(q))
            except Exception:  # noqa: BLE001
                log.exception("Ошибка сканирования")
                continue
            for lid in ids:
                # ошибка в одной медиатеке не останавливает остальные
                try:
                    with session_scope() as db:
                        lib = db.get(Library, lid)
                        if lib is not None:
                            self.scan_library(db, lib, full, sub)
                except Exception as exc:  # noqa: BLE001
                    log.exception("Ошибка сканирования медиатеки %s", lid)
                    try:
                        with session_scope() as db:
                            lib = db.get(Library, lid)
                            if lib is not None:
                                lib.last_scan_error = f"Ошибка сканирования: {exc}"[:500]
                                lib.last_scan_at = datetime.now(timezone.utc)
                                db.commit()
                    except Exception:  # noqa: BLE001
                        pass

    def scan_library(self, db: Session, lib: Library, full: bool = False, sub: str = "") -> None:
        root = Path(lib.path)
        self._set(library=lib.name, library_id=lib.id, folder=sub, done=0, total=0, current="")
        now = datetime.now(timezone.utc)
        if not root.is_dir():
            lib.last_scan_error = f"Папка не найдена: {lib.path}"
            lib.last_scan_at = now
            db.commit()
            return
        if sub and not (root / sub).is_dir():
            sub = ""  # папку удалили или переименовали — сканируем всю медиатеку
        try:
            found_list = discover(root, self._stop, sub)
        except OSError as exc:
            lib.last_scan_error = f"Нет доступа к папке: {exc}"
            lib.last_scan_at = now
            db.commit()
            return
        existing = {b.key_hash: b for b in db.scalars(select(Book).where(Book.library_id == lib.id)) if in_subtree(b.key, sub)}
        seen: set[str] = set()
        self._set(total=len(found_list))
        added = updated = 0
        for i, found in enumerate(found_list):
            kh = key_hash(f"{found.kind}:{found.key}")
            seen.add(kh)
            book = existing.get(kh)
            fp = found.fingerprint()
            if book is not None and book.fingerprint == fp and not full:
                if book.folder != folder_of(found.key):
                    book.folder = folder_of(found.key)
                    db.commit()
                continue
            self._set(done=i, current=found.key)
            try:
                meta, files, error = read_found(root, found)
            except Exception as exc:  # noqa: BLE001
                log.warning("Не удалось прочитать %s: %s", found.key, exc)
                meta, files, error = Meta(), [], str(exc)[:500]
                if found.kind == "ebook":
                    files = [{"format": f, "path": info.rel, "size": info.size} for f, info in found.files]
                else:
                    files = [{"path": info.rel, "format": f, "title": PurePosixPath(info.rel).stem, "duration": 0, "size": info.size, "index": n} for n, (f, info) in enumerate(found.files)]
            title, authors = _fallback_names(found)
            if book is None:
                book = Book(library_id=lib.id, key=found.key, folder=folder_of(found.key), key_hash=kh, title=title, path="")
                db.add(book)
                existing[kh] = book
                added += 1
            else:
                updated += 1
            book.kind = found.kind
            book.folder = folder_of(found.key)
            book.format = found.files[0][0]
            book.path = found.files[0][1].rel
            book.files = json.dumps(files, ensure_ascii=False)
            book.size = sum(info.size for _, info in found.files)
            _apply_meta(book, meta, title, authors)
            book.duration = meta.duration
            book.chapters = json.dumps(meta.chapters, ensure_ascii=False)
            book.fingerprint = fp
            book.scan_error = error or None
            book.updated_at = now
            db.flush()
            if "cover" not in (book.locked or "").split(","):
                _save_cover(book, meta.cover)
            # коммит после каждой книги: SQLite не держит блокировку записи долго (вход, прогресс не ждут)
            db.commit()
        removed = 0
        if not self._stop.is_set():
            for kh, book in existing.items():
                if kh not in seen:
                    cover_path(book.id).unlink(missing_ok=True)
                    from .convert import remove_cached  # noqa: PLC0415

                    remove_cached(book.id)
                    db.delete(book)
                    removed += 1
        db.flush()
        self._update_counts(db, lib)
        lib.last_scan_at = now
        lib.last_scan_error = None
        db.commit()
        with self._lock:
            self._status["added"] += added
            self._status["updated"] += updated
            self._status["removed"] += removed
            self._status["done"] = len(found_list)
        log.info("Медиатека «%s»%s: новых %s, обновлено %s, удалено %s", lib.name, f" ({sub})" if sub else "", added, updated, removed)

    @staticmethod
    def _update_counts(db: Session, lib: Library) -> None:
        rows = dict(
            db.execute(select(Book.kind, func.count()).where(Book.library_id == lib.id).group_by(Book.kind)).all()
        )
        lib.book_count = int(rows.get("ebook", 0))
        lib.audio_count = int(rows.get("audio", 0))
        lib.total_size = int(db.scalar(select(func.coalesce(func.sum(Book.size), 0)).where(Book.library_id == lib.id)) or 0)


scanner = Scanner()


# ---------------- периодическое сканирование ----------------


def _scheduler() -> None:
    from .app_settings import get_setting

    last_run = time.monotonic()
    while True:
        time.sleep(60)
        try:
            with session_scope() as db:
                raw = get_setting(db, "scan_interval")
            interval = int(raw) if raw.isdigit() else 60
        except Exception:  # noqa: BLE001
            continue
        if interval <= 0:
            continue
        if time.monotonic() - last_run >= interval * 60:
            last_run = time.monotonic()
            scanner.start()


_scheduler_started = False


def _on_db_ready() -> None:
    global _scheduler_started
    if not _scheduler_started:
        _scheduler_started = True
        threading.Thread(target=_scheduler, name="scan-scheduler", daemon=True).start()
    scanner.start()  # при запуске — быстрый скан изменений


on_ready(_on_db_ready)
