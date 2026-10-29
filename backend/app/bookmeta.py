"""Чтение метаданных и обложек из файлов книг.

Каждая функция read_* получает путь к файлу и возвращает Meta. Ошибки разбора не должны
ронять сканер: при любой проблеме возвращаем то, что успели прочитать (как минимум — имя файла).

Поддержка:
- EPUB (OPF: название, авторы, серия Calibre/EPUB3, язык, издатель, год, ISBN, жанры, аннотация, обложка)
- FB2, FB2.ZIP, FBZ (title-info, sequence, publish-info, обложка из binary; любые кодировки)
- MOBI, AZW, AZW3 (заголовок MOBI + записи EXTH, обложка из записей картинок)
- PDF (метаданные и число страниц — pypdf, обложка — pdftoppm)
- DjVu (число страниц и обложка — djvulibre)
- CBZ (первая картинка — обложка, картинки — страницы)
- Аудио: MP3, M4A/M4B, OGG, OPUS, FLAC, AAC, WAV (теги mutagen, главы m4b, встроенная обложка)
- Остальное (TXT, RTF, DOC/DOCX, ODT, HTML, CBR, CB7…) — по имени файла
"""
from __future__ import annotations

import html
import io
import logging
import re
import shutil
import struct
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET

log = logging.getLogger("uvicorn.error")

EBOOK_FORMATS = {
    "epub", "fb2", "fbz", "mobi", "azw", "azw3", "pdf", "djvu", "cbz", "cbr", "cb7",
    "txt", "rtf", "doc", "docx", "odt", "html", "htm", "chm",
}
AUDIO_FORMATS = {"mp3", "m4a", "m4b", "aac", "ogg", "oga", "opus", "flac", "wav"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}

# Какой формат открывать по умолчанию, если у книги их несколько
FORMAT_PRIORITY = ["epub", "fb2", "fbz", "azw3", "mobi", "azw", "pdf", "djvu", "cbz", "cbr", "cb7",
                   "docx", "odt", "rtf", "doc", "html", "htm", "txt", "chm"]

MAX_COVER_BYTES = 30 * 1024 * 1024


@dataclass
class Meta:
    title: str = ""
    authors: list[str] = field(default_factory=list)
    narrator: str = ""
    series: str = ""
    series_index: float | None = None
    language: str = ""
    publisher: str = ""
    year: int | None = None
    isbn: str = ""
    subjects: list[str] = field(default_factory=list)
    description: str = ""
    pages: int | None = None
    duration: float = 0.0
    chapters: list[dict] = field(default_factory=list)
    cover: bytes | None = None  # картинка как есть (jpeg/png/...)


def file_format(name: str) -> str | None:
    """Формат по имени файла: book.fb2.zip → fbz, book.epub → epub."""
    low = name.lower()
    if low.endswith(".fb2.zip"):
        return "fbz"
    ext = low.rsplit(".", 1)[-1] if "." in low else ""
    if ext == "djv":
        return "djvu"
    if ext == "kf8":
        return "azw3"
    if ext in EBOOK_FORMATS or ext in AUDIO_FORMATS:
        return ext
    return None


def book_stem(name: str) -> str:
    """Имя без расширения (с учётом .fb2.zip) — по нему склеиваются форматы одной книги."""
    low = name.lower()
    if low.endswith(".fb2.zip"):
        return name[: -len(".fb2.zip")]
    return name.rsplit(".", 1)[0] if "." in name else name


def title_from_filename(name: str) -> tuple[str, list[str]]:
    """«Автор - Название» → (Название, [Автор]); иначе (имя файла, [])."""
    stem = book_stem(PurePosixPath(name).name)
    stem = re.sub(r"[_]+", " ", stem).strip()
    m = re.match(r"^(.{2,80}?)\s+[-–—]\s+(.+)$", stem)
    if m:
        return m.group(2).strip(), [m.group(1).strip()]
    return stem, []


def _year(value: str | None) -> int | None:
    if not value:
        return None
    m = re.search(r"(1[5-9]\d\d|20\d\d)", value)
    return int(m.group(1)) if m else None


def _float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        v = float(str(value).replace(",", ".").strip())
    except ValueError:
        return None
    return v if 0 <= v < 100000 else None


def _clean_html(text: str) -> str:
    """Аннотацию из HTML/XML — в простой текст с абзацами."""
    text = re.sub(r"(?i)<\s*(br|/p|/div|/li|/h\d)\s*/?>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    lines = [" ".join(line.split()) for line in text.splitlines()]
    out = "\n".join(line for line in lines if line)
    return out[:20000]


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _attr(el: ET.Element, name: str) -> str | None:
    for k, v in el.attrib.items():
        if _local(k) == name:
            return v
    return None


def _decode_xml(data: bytes) -> str:
    """XML в строку с учётом объявленной кодировки (windows-1251 и т.п. expat сам не умеет)."""
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        text = data.decode("utf-16", errors="replace")
    else:
        head = data[:300].decode("ascii", errors="ignore")
        m = re.search(r'encoding\s*=\s*["\']([\w.-]+)["\']', head)
        enc = (m.group(1) if m else "utf-8").lower()
        try:
            text = data.decode(enc, errors="replace")
        except LookupError:
            text = data.decode("utf-8", errors="replace")
    # объявление кодировки больше не нужно — строка уже раскодирована
    return re.sub(r"^\s*<\?xml[^>]*\?>", "", text, count=1)


def _parse_xml(data: bytes) -> ET.Element:
    text = _decode_xml(data)
    try:
        return ET.fromstring(text)
    except ET.ParseError:
        # именованные HTML-сущности (&nbsp; и т.п.) не определены в XML — заменим и попробуем ещё раз
        text = re.sub(r"&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)(\w+);", lambda m: html.unescape(m.group(0)), text)
        return ET.fromstring(text)


# ---------------- EPUB ----------------


def read_epub(path: Path) -> Meta:
    meta = Meta()
    with zipfile.ZipFile(path) as zf:
        names = set(zf.namelist())
        opf_path = None
        if "META-INF/container.xml" in names:
            root = _parse_xml(zf.read("META-INF/container.xml"))
            for el in root.iter():
                if _local(el.tag) == "rootfile" and _attr(el, "full-path"):
                    opf_path = _attr(el, "full-path")
                    break
        if not opf_path:
            opf_path = next((n for n in names if n.lower().endswith(".opf")), None)
        if not opf_path or opf_path not in names:
            return meta
        opf = _parse_xml(zf.read(opf_path))
        base = PurePosixPath(opf_path).parent
        _fill_opf(meta, opf)

        # обложка
        manifest: dict[str, tuple[str, str, str]] = {}
        cover_id = None
        for el in opf.iter():
            tag = _local(el.tag)
            if tag == "item":
                manifest[_attr(el, "id") or ""] = (_attr(el, "href") or "", _attr(el, "media-type") or "", _attr(el, "properties") or "")
            elif tag == "meta" and (_attr(el, "name") or "").lower() == "cover":
                cover_id = _attr(el, "content")
        href = None
        for _id, (h, mt, props) in manifest.items():
            if "cover-image" in props.split():
                href = h
        if not href and cover_id and cover_id in manifest and manifest[cover_id][1].startswith("image/"):
            href = manifest[cover_id][0]
        if not href:
            # запасной вариант: картинка с «cover» в имени
            for h, mt, _ in manifest.values():
                if mt.startswith("image/") and "cover" in h.lower():
                    href = h
                    break
        if href:
            from urllib.parse import unquote

            full = (base / unquote(href)).as_posix() if str(base) not in ("", ".") else unquote(href)
            full = _norm_zip_path(full)
            if full in names:
                info = zf.getinfo(full)
                if info.file_size <= MAX_COVER_BYTES:
                    meta.cover = zf.read(full)
    return meta


def _norm_zip_path(p: str) -> str:
    parts: list[str] = []
    for part in p.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if parts:
                parts.pop()
        else:
            parts.append(part)
    return "/".join(parts)


def _fill_opf(meta: Meta, opf: ET.Element) -> None:
    """Метаданные из OPF (EPUB или metadata.opf рядом с книгой в библиотеке Calibre)."""
    authors: list[str] = []
    others: list[str] = []
    refines: dict[str, dict[str, str]] = {}
    collections: dict[str, str] = {}
    for el in opf.iter():
        tag = _local(el.tag)
        text = (el.text or "").strip()
        if tag == "title" and text and not meta.title:
            meta.title = text
        elif tag == "creator" and text:
            role = (_attr(el, "role") or "").lower()
            if role in ("", "aut"):
                authors.append(text)
            elif role == "nrt":
                meta.narrator = meta.narrator or text
            else:
                others.append(text)
        elif tag == "language" and text and not meta.language:
            meta.language = text[:16]
        elif tag == "publisher" and text and not meta.publisher:
            meta.publisher = text[:255]
        elif tag == "date" and text and meta.year is None:
            meta.year = _year(text)
        elif tag == "description" and text and not meta.description:
            meta.description = _clean_html(text)
        elif tag == "subject" and text:
            meta.subjects.append(text)
        elif tag == "identifier" and text:
            scheme = (_attr(el, "scheme") or "").lower()
            digits = re.sub(r"[^0-9Xx]", "", text)
            if (scheme == "isbn" or "isbn" in text.lower() or len(digits) in (10, 13)) and len(digits) in (10, 13):
                meta.isbn = meta.isbn or digits.upper()
        elif tag == "meta":
            name = (_attr(el, "name") or "").lower()
            prop = (_attr(el, "property") or "").lower()
            if name == "calibre:series":
                meta.series = (_attr(el, "content") or "").strip()
            elif name == "calibre:series_index":
                meta.series_index = _float(_attr(el, "content"))
            elif prop == "belongs-to-collection" and text:
                collections[_attr(el, "id") or text] = text
            elif _attr(el, "refines") and prop:
                refines.setdefault((_attr(el, "refines") or "").lstrip("#"), {})[prop] = text
    if not meta.series:
        for cid, name in collections.items():
            ref = refines.get(cid, {})
            if ref.get("collection-type", "series") == "series":
                meta.series = name
                meta.series_index = _float(ref.get("group-position"))
                break
    meta.authors = authors or others


def read_opf_file(path: Path) -> Meta:
    meta = Meta()
    _fill_opf(meta, _parse_xml(path.read_bytes()))
    return meta


# ---------------- FB2 ----------------


def _fb2_person(el: ET.Element) -> str:
    parts: dict[str, str] = {}
    for child in el:
        parts[_local(child.tag)] = " ".join((child.text or "").split())
    name = " ".join(p for p in (parts.get("first-name"), parts.get("middle-name"), parts.get("last-name")) if p)
    return name or parts.get("nickname", "")


def _read_fb2_bytes(data: bytes) -> Meta:
    meta = Meta()
    root = _parse_xml(data)
    desc = next((el for el in root if _local(el.tag) == "description"), None)
    if desc is None:
        return meta
    title_info = next((el for el in desc if _local(el.tag) == "title-info"), None)
    publish_info = next((el for el in desc if _local(el.tag) == "publish-info"), None)
    cover_href = None
    if title_info is not None:
        for el in title_info:
            tag = _local(el.tag)
            if tag == "book-title":
                meta.title = " ".join("".join(el.itertext()).split())
            elif tag == "author":
                name = _fb2_person(el)
                if name:
                    meta.authors.append(name)
            elif tag == "genre" and el.text:
                meta.subjects.append(el.text.strip())
            elif tag == "lang" and el.text:
                meta.language = el.text.strip()[:16]
            elif tag == "date" and meta.year is None:
                meta.year = _year(_attr(el, "value") or el.text)
            elif tag == "sequence" and not meta.series:
                meta.series = (_attr(el, "name") or "").strip()
                meta.series_index = _float(_attr(el, "number"))
            elif tag == "annotation":
                meta.description = _clean_html(ET.tostring(el, encoding="unicode"))
            elif tag == "coverpage":
                img = next((i for i in el.iter() if _local(i.tag) == "image"), None)
                if img is not None:
                    cover_href = (_attr(img, "href") or "").lstrip("#")
    if publish_info is not None:
        for el in publish_info:
            tag = _local(el.tag)
            text = (el.text or "").strip()
            if tag == "publisher" and text:
                meta.publisher = text[:255]
            elif tag == "year" and text:
                meta.year = _year(text) or meta.year
            elif tag == "isbn" and text:
                meta.isbn = re.sub(r"[^0-9Xx]", "", text).upper()[:32]
            elif tag == "sequence" and not meta.series:
                meta.series = (_attr(el, "name") or "").strip()
                meta.series_index = _float(_attr(el, "number"))
    if cover_href:
        import base64

        for el in root:
            if _local(el.tag) == "binary" and _attr(el, "id") == cover_href and el.text:
                try:
                    meta.cover = base64.b64decode("".join(el.text.split()))
                except ValueError:
                    pass
                break
    return meta


def read_fb2(path: Path) -> Meta:
    return _read_fb2_bytes(path.read_bytes())


def read_fbz(path: Path) -> Meta:
    with zipfile.ZipFile(path) as zf:
        inner = next((n for n in zf.namelist() if n.lower().endswith(".fb2")), None)
        if not inner:
            return Meta()
        return _read_fb2_bytes(zf.read(inner))


# ---------------- MOBI / AZW / AZW3 ----------------


def read_mobi(path: Path) -> Meta:
    meta = Meta()
    with open(path, "rb") as f:
        data = f.read(78)
        if len(data) < 78:
            return meta
        count = struct.unpack(">H", data[76:78])[0]
        offsets = []
        table = f.read(count * 8)
        for i in range(count):
            offsets.append(struct.unpack(">I", table[i * 8 : i * 8 + 4])[0])
        if not offsets:
            return meta
        f.seek(offsets[0])
        rec0 = f.read((offsets[1] if len(offsets) > 1 else offsets[0] + 65536) - offsets[0])
        if rec0[16:20] != b"MOBI":
            return meta
        mobi_len = struct.unpack(">I", rec0[20:24])[0]
        encoding = struct.unpack(">I", rec0[28:32])[0]
        enc = "utf-8" if encoding == 65001 else "cp1252"
        name_off, name_len = struct.unpack(">II", rec0[84:92])
        first_image = struct.unpack(">I", rec0[108:112])[0] if len(rec0) >= 112 else 0xFFFFFFFF
        exth_flag = struct.unpack(">I", rec0[128:132])[0] if len(rec0) >= 132 else 0
        meta.title = rec0[name_off : name_off + name_len].decode(enc, errors="replace").strip()
        cover_off = None
        if exth_flag & 0x40:
            pos = 16 + mobi_len
            if rec0[pos : pos + 4] == b"EXTH":
                n = struct.unpack(">I", rec0[pos + 8 : pos + 12])[0]
                p = pos + 12
                for _ in range(n):
                    if p + 8 > len(rec0):
                        break
                    rtype, rlen = struct.unpack(">II", rec0[p : p + 8])
                    value = rec0[p + 8 : p + rlen]
                    p += max(rlen, 8)

                    def text() -> str:
                        return value.decode(enc, errors="replace").strip()

                    if rtype == 100 and text():
                        meta.authors.append(text())
                    elif rtype == 101:
                        meta.publisher = text()[:255]
                    elif rtype == 103:
                        meta.description = _clean_html(text())
                    elif rtype == 104:
                        meta.isbn = re.sub(r"[^0-9Xx]", "", text()).upper()[:32]
                    elif rtype == 105 and text():
                        meta.subjects.append(text())
                    elif rtype == 106:
                        meta.year = _year(text())
                    elif rtype == 201 and len(value) >= 4:
                        cover_off = struct.unpack(">I", value[:4])[0]
                    elif rtype == 503 and text():
                        meta.title = text()
                    elif rtype == 524 and text():
                        meta.language = text()[:16]
        if cover_off is not None and first_image != 0xFFFFFFFF:
            idx = first_image + cover_off
            if idx < len(offsets):
                start = offsets[idx]
                end = offsets[idx + 1] if idx + 1 < len(offsets) else path.stat().st_size
                if 0 < end - start <= MAX_COVER_BYTES:
                    f.seek(start)
                    meta.cover = f.read(end - start)
    return meta


# ---------------- PDF ----------------


def read_pdf(path: Path) -> Meta:
    meta = Meta()
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(path), strict=False)
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:  # noqa: BLE001
                pass
        info = reader.metadata
        if info:
            meta.title = (info.title or "").strip()
            if info.author:
                meta.authors = [a.strip() for a in re.split(r"[;&]|\s+и\s+|\s+and\s+", info.author) if a.strip()]
            meta.year = _year(str(info.get("/CreationDate", "")))
            if info.subject:
                meta.description = str(info.subject)[:2000]
        meta.pages = len(reader.pages)
    except Exception as exc:  # noqa: BLE001
        log.debug("PDF %s: %s", path, exc)
    meta.cover = _render_first_page(["pdftoppm", "-f", "1", "-l", "1", "-scale-to", "900", "-jpeg", "-singlefile"], path, ".jpg")
    # Заголовки вроде «Microsoft Word - doc1.docx» бесполезны
    if meta.title and re.search(r"(?i)(microsoft word|untitled|\.docx?$|\.pdf$)", meta.title):
        meta.title = ""
    return meta


# ---------------- DjVu ----------------


def read_djvu(path: Path) -> Meta:
    meta = Meta()
    if shutil.which("djvused"):
        try:
            out = subprocess.run(["djvused", "-e", "n", str(path)], capture_output=True, timeout=30, text=True)
            if out.returncode == 0 and out.stdout.strip().isdigit():
                meta.pages = int(out.stdout.strip())
            out = subprocess.run(["djvused", "-e", "print-meta", str(path)], capture_output=True, timeout=30, text=True)
            for line in out.stdout.splitlines():
                m = re.match(r'^\s*(\w+)\s+"(.*)"\s*$', line)
                if not m:
                    continue
                key, value = m.group(1).lower(), m.group(2).strip()
                if key == "title":
                    meta.title = value
                elif key == "author" and value:
                    meta.authors = [value]
                elif key == "year":
                    meta.year = _year(value)
                elif key == "publisher":
                    meta.publisher = value[:255]
        except (OSError, subprocess.SubprocessError):
            pass
    meta.cover = _render_first_page(["ddjvu", "-format=pnm", "-page=1", "-size=900x1300"], path, ".pnm", outfile=True)
    return meta


def _render_first_page(cmd: list[str], path: Path, suffix: str, outfile: bool = False) -> bytes | None:
    """Первая страница PDF/DjVu картинкой через внешнюю утилиту (если она установлена)."""
    if not shutil.which(cmd[0]):
        return None
    with tempfile.TemporaryDirectory(prefix="sr-cover-") as tmp:
        out = Path(tmp) / f"page{suffix}"
        args = [*cmd, str(path), str(out) if outfile else str(out.with_suffix(""))]
        try:
            subprocess.run(args, capture_output=True, timeout=60)
        except (OSError, subprocess.SubprocessError):
            return None
        candidates = [out] + sorted(Path(tmp).glob("page*"))
        for c in candidates:
            if c.is_file() and c.stat().st_size > 0:
                return c.read_bytes()
    return None


# ---------------- комиксы ----------------


def _natural(s: str) -> list:
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def read_cbz(path: Path) -> Meta:
    meta = Meta()
    with zipfile.ZipFile(path) as zf:
        images = sorted(
            (n for n in zf.namelist() if PurePosixPath(n).suffix.lower() in IMAGE_EXT and not n.startswith("__MACOSX")),
            key=_natural,
        )
        meta.pages = len(images) or None
        if images:
            info = zf.getinfo(images[0])
            if info.file_size <= MAX_COVER_BYTES:
                meta.cover = zf.read(images[0])
        if "ComicInfo.xml" in zf.namelist():
            try:
                ci = _parse_xml(zf.read("ComicInfo.xml"))
                vals = {_local(el.tag): (el.text or "").strip() for el in ci}
                meta.title = vals.get("Title", "")
                meta.series = vals.get("Series", "")
                meta.series_index = _float(vals.get("Number"))
                if vals.get("Writer"):
                    meta.authors = [a.strip() for a in vals["Writer"].split(",") if a.strip()]
                meta.year = _year(vals.get("Year"))
                meta.description = _clean_html(vals.get("Summary", ""))
                meta.publisher = vals.get("Publisher", "")[:255]
            except ET.ParseError:
                pass
    return meta


# ---------------- аудио ----------------


def _first(tags, *keys) -> str:  # noqa: ANN001
    if not tags:
        return ""
    for k in keys:
        try:
            v = tags.get(k)
        except (KeyError, ValueError, TypeError):
            v = None
        if v is None:
            continue
        if isinstance(v, list):
            v = v[0] if v else ""
        text = getattr(v, "text", None)
        if isinstance(text, list):
            v = text[0] if text else ""
        if isinstance(v, (bytes, bytearray)):
            v = bytes(v).decode("utf-8", "replace")
        v = str(v).strip()
        if v:
            return v
    return ""


def read_audio(path: Path, want_cover: bool = True) -> Meta:
    """Теги одного аудиофайла: album → название книги, artist → автор, composer/narrator → чтец."""
    meta = Meta()
    try:
        import mutagen
    except ImportError:
        return meta
    try:
        audio = mutagen.File(str(path))
    except Exception:  # noqa: BLE001
        return meta
    if audio is None:
        return meta
    meta.duration = float(getattr(audio.info, "length", 0) or 0)
    tags = audio.tags
    meta.title = _first(tags, "TALB", "\xa9alb", "album", "ALBUM") or _first(tags, "TIT2", "\xa9nam", "title", "TITLE")
    author = _first(tags, "TPE2", "aART", "albumartist", "ALBUMARTIST", "TPE1", "\xa9ART", "artist", "ARTIST")
    if author:
        meta.authors = [a.strip() for a in re.split(r"[;/]", author) if a.strip()]
    meta.narrator = _first(tags, "TCOM", "\xa9wrt", "composer", "COMPOSER", "narrator", "NARRATOR")
    meta.year = _year(_first(tags, "TDRC", "TYER", "\xa9day", "date", "DATE", "year"))
    meta.description = _clean_html(_first(tags, "COMM::rus", "COMM::eng", "COMM", "\xa9cmt", "desc", "comment", "COMMENT", "DESCRIPTION"))[:20000]
    genre = _first(tags, "TCON", "\xa9gen", "genre", "GENRE")
    if genre:
        meta.subjects = [genre]
    meta.series = _first(tags, "TXXX:SERIES", "TXXX:series", "----:com.apple.iTunes:SERIES", "series", "SERIES", "MVNM", "\xa9mvn")
    meta.series_index = _float(_first(tags, "TXXX:SERIES-PART", "TXXX:series-part", "series-part", "SERIES-PART", "MVIN", "\xa9mvi").split("/")[0] or None)
    # главы внутри файла (m4b)
    chapters = getattr(audio, "chapters", None)
    if chapters:
        try:
            meta.chapters = [{"title": ch.title or f"Глава {i + 1}", "start": round(float(ch.start), 3)} for i, ch in enumerate(chapters)]
        except Exception:  # noqa: BLE001
            meta.chapters = []
    if want_cover and tags:
        meta.cover = _audio_cover(audio)
    return meta


def read_audio_track(path: Path) -> tuple[str, float]:
    """Название дорожки и длительность — для списка файлов аудиокниги."""
    try:
        import mutagen

        audio = mutagen.File(str(path))
    except Exception:  # noqa: BLE001
        audio = None
    if audio is None:
        return "", 0.0
    title = _first(audio.tags, "TIT2", "\xa9nam", "title", "TITLE")
    return title, float(getattr(audio.info, "length", 0) or 0)


def _audio_cover(audio) -> bytes | None:  # noqa: ANN001
    tags = audio.tags
    try:
        # ID3 (mp3)
        for key in list(tags.keys()):
            if key.startswith("APIC"):
                return tags[key].data
        # MP4 (m4a/m4b)
        if "covr" in tags and tags["covr"]:
            return bytes(tags["covr"][0])
    except Exception:  # noqa: BLE001
        pass
    # FLAC / Ogg
    pictures = getattr(audio, "pictures", None)
    if pictures:
        return pictures[0].data
    try:
        import base64

        from mutagen.flac import Picture

        for b64 in tags.get("metadata_block_picture", []) or []:
            return Picture(base64.b64decode(b64)).data
    except Exception:  # noqa: BLE001
        pass
    return None


# ---------------- общее ----------------

READERS = {
    "epub": read_epub,
    "fb2": read_fb2,
    "fbz": read_fbz,
    "mobi": read_mobi,
    "azw": read_mobi,
    "azw3": read_mobi,
    "pdf": read_pdf,
    "djvu": read_djvu,
    "cbz": read_cbz,
}


def read_ebook(path: Path, fmt: str) -> Meta:
    reader = READERS.get(fmt)
    if reader is None:
        return Meta()
    try:
        return reader(path)
    except Exception as exc:  # noqa: BLE001
        log.warning("Не удалось прочитать метаданные %s: %s", path, exc)
        return Meta()


def make_cover(data: bytes, max_side: int = 900) -> bytes | None:
    """Картинку обложки → WebP не больше max_side по длинной стороне."""
    from PIL import Image, ImageOps

    try:
        img = Image.open(io.BytesIO(data))
        if img.width * img.height > 80_000_000:
            return None
        img.draft("RGB", (max_side, max_side))
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "transparency" in img.info or img.mode in ("LA", "P") else "RGB")
        if img.mode == "RGBA":
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1])
            img = bg
        img.thumbnail((max_side, max_side), Image.LANCZOS)
        if img.width < 40 or img.height < 40:
            return None
        out = io.BytesIO()
        img.save(out, "WEBP", quality=84, method=4)
        return out.getvalue()
    except Exception:  # noqa: BLE001
        return None
