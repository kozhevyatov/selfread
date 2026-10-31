"""Конвертация форматов, которые читалка не открывает сама, в те, что открывает.

- DOCX, ODT, RTF → EPUB через pandoc (заголовки становятся главами и оглавлением, картинки сохраняются);
- CHM → распаковка (extract_chmLib), порядок страниц из оглавления .hhc → EPUB через pandoc;
- CBR, CB7 → CBZ (распаковка bsdtar, при неудаче — unar; картинки складываются в zip).

Результат кэшируется в DATA_DIR/converted/<id книги>-<отпечаток>.<epub|cbz>: конвертация — один раз,
пока файл книги не изменится.
"""
from __future__ import annotations

import html as htmlmod
import json
import logging
import re
import shutil
import subprocess
import tempfile
import threading
import zipfile
from pathlib import Path

from .config import DATA_DIR

log = logging.getLogger("uvicorn.error")

# исходный формат → во что конвертируем
TARGET = {"docx": "epub", "odt": "epub", "rtf": "epub", "chm": "epub", "cbr": "cbz", "cb7": "cbz"}
CONVERTED_DIR = DATA_DIR / "converted"
IMAGE_RE = re.compile(r"\.(jpe?g|png|gif|webp|bmp|avif)$", re.I)

_slots = threading.BoundedSemaphore(2)  # не больше двух конвертаций одновременно (слабый NAS)
_locks: dict[int, threading.Lock] = {}
_locks_guard = threading.Lock()


class ConvertError(Exception):
    pass


def _book_lock(book_id: int) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(book_id, threading.Lock())


def cached_path(book_id: int, fingerprint: str, fmt: str) -> Path:
    return CONVERTED_DIR / f"{book_id}-{(fingerprint or 'x')[:10]}-{fmt}.{TARGET[fmt]}"


def remove_cached(book_id: int) -> None:
    if CONVERTED_DIR.is_dir():
        for p in CONVERTED_DIR.glob(f"{book_id}-*"):
            p.unlink(missing_ok=True)


def convert(book_id: int, fingerprint: str, fmt: str, src: Path, title: str, authors: list[str]) -> Path:
    """Вернуть путь к сконвертированному файлу (сделать, если ещё нет)."""
    if fmt not in TARGET:
        raise ConvertError(f"Формат {fmt.upper()} не конвертируется")
    target = cached_path(book_id, fingerprint, fmt)
    if target.is_file():
        return target
    with _book_lock(book_id):
        if target.is_file():
            return target
        with _slots:
            CONVERTED_DIR.mkdir(parents=True, exist_ok=True)
            # старые версии этого формата этой книги (файл книги изменился)
            for old in CONVERTED_DIR.glob(f"{book_id}-*-{fmt}.*"):
                old.unlink(missing_ok=True)
            tmp_out = target.with_name(target.name + ".tmp")
            try:
                with tempfile.TemporaryDirectory(prefix="sr-conv-") as tmp:
                    work = Path(tmp)
                    if fmt == "rtf":
                        fixed = work / "book.rtf"
                        fixed.write_text(rtf_to_unicode(src.read_bytes()), encoding="ascii")
                        _pandoc([fixed], fmt, tmp_out, title, authors, work)
                    elif fmt in ("docx", "odt"):
                        _pandoc([src], fmt, tmp_out, title, authors, work)
                    elif fmt == "chm":
                        _chm(src, tmp_out, title, authors, work)
                    else:
                        _comic(src, tmp_out, work)
                tmp_out.replace(target)
            except BaseException:
                tmp_out.unlink(missing_ok=True)
                raise
            log.info("Сконвертирована книга %s: %s → %s", book_id, fmt, TARGET[fmt])
    return target


# ---------------- pandoc ----------------


def _pandoc_version() -> tuple[int, ...]:
    try:
        out = subprocess.run(["pandoc", "--version"], capture_output=True, text=True, timeout=20).stdout
        m = re.search(r"pandoc\S*\s+(\d+(?:\.\d+)*)", out)
        return tuple(int(x) for x in m.group(1).split(".")) if m else (0,)
    except (OSError, subprocess.SubprocessError):
        return (0,)


def _safe_tree(node: object, base: Path) -> object:
    """Вычистить из дерева pandoc всё, что при сборке EPUB прочиталось бы с диска сервера или из сети:
    картинки с абсолютным путём, http://, ../ за пределы папки книги, а также сырой HTML."""
    if isinstance(node, list):
        out = []
        for item in node:
            if isinstance(item, dict) and item.get("t") in ("RawBlock", "RawInline"):
                continue
            out.append(_safe_tree(item, base))
        return out
    if isinstance(node, dict):
        if node.get("t") == "Image":
            attr, alt, (url, title) = node["c"]
            ok = bool(url) and not re.match(r"^[a-z][a-z0-9+.-]*:", url, re.I) and not url.startswith("/")
            if ok:
                target = (base / url.split("#")[0].split("?")[0]).resolve()
                ok = base in target.parents and target.is_file() and not target.is_symlink()
            if not ok:
                return {"t": "Span", "c": [attr, _safe_tree(alt, base)]}
            return {"t": "Image", "c": [attr, _safe_tree(alt, base), [url, title]]}
        return {k: _safe_tree(v, base) for k, v in node.items()}
    return node


def _run_pandoc(cmd: list[str], work: Path, stdin: bytes | None = None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, input=stdin, capture_output=True, timeout=300, cwd=work)
    except subprocess.TimeoutExpired:
        raise ConvertError("Конвертация заняла слишком много времени")
    except OSError as exc:
        raise ConvertError(f"Не удалось запустить pandoc: {exc}")


def _fail(res: subprocess.CompletedProcess, fmt: str) -> ConvertError:
    err = res.stderr.decode("utf-8", "replace") if isinstance(res.stderr, bytes) else (res.stderr or "")
    if fmt == "rtf" and "Unknown input format" in err:
        return ConvertError("Версия pandoc на сервере не читает RTF — пересоберите образ SelfRead")
    lines = err.strip().splitlines()
    return ConvertError("Не удалось сконвертировать: " + (lines[-1] if lines else f"код {res.returncode}")[:300])


def _pandoc(inputs: list[Path], fmt: str, out: Path, title: str, authors: list[str], work: Path) -> None:
    """Документ → EPUB в два шага: чтение в дерево (с картинками в work/media), чистка дерева, сборка EPUB."""
    if not shutil.which("pandoc"):
        raise ConvertError("На сервере нет pandoc — пересоберите образ SelfRead")
    work = work.resolve()
    reader = "html-raw_html" if fmt == "html" else fmt
    res = _run_pandoc(["pandoc", "-f", reader, "-t", "json", "--extract-media=media", *[str(p) for p in inputs]], work)
    if res.returncode != 0:
        raise _fail(res, fmt)
    try:
        tree = json.loads(res.stdout)
    except ValueError:
        raise ConvertError("pandoc вернул что-то непонятное")
    tree["blocks"] = _safe_tree(tree.get("blocks", []), work)
    version = _pandoc_version()
    split = ["--split-level=2"] if version >= (3,) else ["--epub-chapter-level=2"]
    cmd = ["pandoc", "-f", "json", "-t", "epub3", "--toc", "--toc-depth=2", *split, "--metadata", f"title={title or 'Без названия'}", "--metadata", "lang=ru", "-o", str(out)]
    for a in authors[:5]:
        cmd += ["--metadata", f"author={a}"]
    res = _run_pandoc(cmd, work, json.dumps(tree).encode("utf-8"))
    if res.returncode != 0 or not out.is_file():
        raise _fail(res, fmt)


# ---------------- RTF: кодировка ----------------

_RTF_TOKEN = re.compile(rb"\\'([0-9a-fA-F]{2})|\\uc(\d+)|\\u(-?\d+) ?|\\ansicpg(\d+)|\\[\\{}]|[\x80-\xff]")


def rtf_to_unicode(raw: bytes) -> str:
    """pandoc не понимает \\ansicpg1251: байты \\'hh и 8-битный текст переводим в \\uN? (Юникод)."""
    m = re.search(rb"\\ansicpg(\d+)", raw[:4096])
    codepage = f"cp{int(m.group(1))}" if m else "cp1251"
    try:
        "".encode(codepage)
    except LookupError:
        codepage = "cp1251"
    out: list[str] = []
    pos = 0
    skip = 0  # сколько символов-заменителей пропустить после \\uN
    uc = 1
    pending = bytearray()

    def flush_pending() -> None:
        if pending:
            for ch in bytes(pending).decode(codepage, "replace"):
                code = ord(ch)
                out.append(f"\\u{code - 65536 if code > 32767 else code}?")
            pending.clear()

    for tok in _RTF_TOKEN.finditer(raw):
        if tok.start() > pos:
            flush_pending()
            chunk = raw[pos : tok.start()]
            # обычный ASCII оставляем как есть: если это заменитель после \\uN, pandoc сам его пропустит
            skip = 0
            out.append(chunk.decode("latin-1"))
        pos = tok.end()
        hexbyte, ucn, uni, cp = tok.group(1), tok.group(2), tok.group(3), tok.group(4)
        if hexbyte is not None:
            if skip:
                skip -= 1
                out.append("?")  # заменитель после \\uN оставляем, но уже в ASCII
                continue
            pending.append(int(hexbyte, 16))
        elif tok.group(0)[:1] >= b"\x80":
            if skip:
                skip -= 1
                out.append("?")
                continue
            pending.append(tok.group(0)[0])
        else:
            flush_pending()
            if ucn is not None:
                uc = int(ucn)
            elif uni is not None:
                skip = uc
            out.append(tok.group(0).decode("latin-1"))
    flush_pending()
    out.append(raw[pos:].decode("latin-1"))
    text = "".join(out)
    return text.encode("ascii", "replace").decode("ascii")


# ---------------- CHM ----------------

_CHARSET_RE = re.compile(rb"""<meta[^>]+charset\s*=\s*["']?([\w-]+)""", re.I)


def _decode_html(raw: bytes) -> str:
    m = _CHARSET_RE.search(raw[:4096])
    candidates = [m.group(1).decode("ascii", "ignore")] if m else []
    candidates += ["utf-8", "cp1251"]
    for enc in candidates:
        try:
            return raw.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("cp1251", "replace")


def _hhc_order(root: Path) -> list[str]:
    """Страницы в порядке оглавления CHM (файл .hhc)."""
    hhc = next(iter(sorted(root.rglob("*.hhc"))), None)
    if not hhc:
        return []
    text = _decode_html(hhc.read_bytes())
    seen: list[str] = []
    for m in re.finditer(r"""<param\s+name\s*=\s*["']?Local["']?\s+value\s*=\s*["']([^"']+)["']""", text, re.I):
        local = htmlmod.unescape(m.group(1)).split("#")[0].replace("\\", "/").lstrip("/")
        if local and local not in seen:
            seen.append(local)
    return seen


_DROP_TAGS = re.compile(r"<(script|style|iframe|object|embed|frame|frameset|applet|svg)\b.*?(</\1\s*>|/>)", re.I | re.S)
_DROP_SINGLE = re.compile(r"<(link|base|frame|embed|source|track)\b[^>]*>", re.I)
_SRC_ATTR = re.compile(r"""(\s(?:src|poster|data|background|srcset|xlink:href)\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)""", re.I)


def _sanitize_html(text: str, page_dir: Path, root: Path, work: Path) -> str:
    """Убрать скрипты, фреймы и внешние ссылки на ресурсы; пути к картинкам — относительно work (там запускается pandoc)."""
    text = _DROP_TAGS.sub("", text)
    text = _DROP_SINGLE.sub("", text)

    def fix(m: re.Match) -> str:
        value = htmlmod.unescape(m.group(2).strip("\"'")).split("#")[0].split("?")[0].replace("\\", "/")
        ok = bool(value) and not re.match(r"^[a-z][a-z0-9+.-]*:", value, re.I) and not value.startswith("/") and " " not in value.strip()
        if ok:
            target = (page_dir / value).resolve()
            ok = root in target.parents and target.is_file() and not target.is_symlink()
        if not ok:
            return f'{m.group(1)}""'
        rel = (page_dir / value).resolve().relative_to(work).as_posix()
        return f'{m.group(1)}"{htmlmod.escape(rel)}"'

    return _SRC_ATTR.sub(fix, text)


def _chm(src: Path, out: Path, title: str, authors: list[str], work: Path) -> None:
    tool = shutil.which("extract_chmLib")
    if not tool:
        raise ConvertError("На сервере нет extract_chmLib — пересоберите образ SelfRead")
    raw = work / "raw"
    raw.mkdir()
    try:
        subprocess.run([tool, str(src), str(raw)], capture_output=True, timeout=300)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ConvertError(f"Не удалось распаковать CHM: {exc}")
    pages = [p for p in raw.rglob("*") if p.is_file() and not p.is_symlink() and p.suffix.lower() in (".htm", ".html")]
    if not pages:
        raise ConvertError("В CHM не нашлось страниц")
    by_rel = {p.relative_to(raw).as_posix().lower(): p for p in pages}
    ordered: list[Path] = []
    for local in _hhc_order(raw):
        p = by_rel.get(local.lower())
        if p and p not in ordered:
            ordered.append(p)
    if not ordered:
        ordered = sorted(pages, key=lambda p: p.relative_to(raw).as_posix().lower())
    # pandoc читает только UTF-8: перекодируем страницы на месте и убираем всё, что он мог бы
    # подтянуть извне (абсолютные пути, http://, ../ за пределы распакованного CHM)
    root = raw.resolve()
    work_dir = work.resolve()
    for p in ordered:
        text = _decode_html(p.read_bytes())
        text = re.sub(r"""<meta[^>]+charset[^>]*>""", '<meta charset="utf-8">', text, flags=re.I)
        p.write_text(_sanitize_html(text, p.parent.resolve(), root, work_dir), encoding="utf-8")
    _pandoc(ordered[:2000], "html", out, title, authors, work)


# ---------------- комиксы ----------------


def _natural(s: str) -> list:
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def _comic(src: Path, out: Path, work: Path) -> None:
    dest = work / "pages"
    dest.mkdir()
    ok = False
    root = dest.resolve()

    def images() -> list[Path]:
        # только обычные файлы внутри папки распаковки: символическая ссылка «001.jpg → /data/secret.key»
        # иначе попала бы в CBZ и ушла пользователю
        found = []
        for p in dest.rglob("*"):
            if p.is_symlink() or not p.is_file() or not IMAGE_RE.search(p.name) or p.name.startswith("."):
                continue
            if root in p.resolve().parents:
                found.append(p)
        return sorted(found, key=lambda p: _natural(p.relative_to(dest).as_posix()))

    def run(cmd: list[str]) -> None:
        try:
            subprocess.run(cmd, capture_output=True, timeout=300)
        except subprocess.TimeoutExpired:
            raise ConvertError("Архив комикса распаковывается слишком долго")
        except OSError as exc:
            raise ConvertError(f"Не удалось распаковать архив: {exc}")

    pages: list[Path] = []
    if shutil.which("bsdtar"):
        run(["bsdtar", "-xf", str(src), "-C", str(dest)])
        pages = images()
    if not pages and shutil.which("unar"):
        shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir()
        run(["unar", "-q", "-f", "-D", "-o", str(dest), str(src)])
        pages = images()
    if not pages:
        raise ConvertError("Не удалось распаковать архив комикса")
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_STORED) as z:
        for n, p in enumerate(pages, 1):
            z.write(p, f"{n:05d}{p.suffix.lower()}")
