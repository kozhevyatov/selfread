"""Поиск метаданных и обложек книг в интернете: Google Books и Open Library.

Обложку по ссылке скачивает сервер, поэтому адрес проверяется: только http(s) и только публичные
адреса (не локальная сеть NAS) — в том числе после каждого редиректа.
"""
from __future__ import annotations

import http.client
import ipaddress
import json
import logging
import re
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger("uvicorn.error")

UA = "SelfRead/1.0 (self-hosted e-book library)"
TIMEOUT = 8
MAX_JSON = 4 * 1024 * 1024
MAX_IMAGE = 15 * 1024 * 1024


class LookupError_(Exception):
    pass


# ---------------- безопасная загрузка ----------------


def _public_ip(host: str, port: int) -> str:
    """IP сайта, если все его адреса публичные (не локальная сеть NAS)."""
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise LookupError_("Сайт не найден")
    if not infos:
        raise LookupError_("Сайт не найден")
    for info in infos:
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise LookupError_("Ссылки на адреса локальной сети не поддерживаются")
    return infos[0][4][0]


def _check_url(url: str) -> None:
    try:
        parts = urllib.parse.urlsplit(url)
        port = parts.port
    except ValueError:
        raise LookupError_("Неправильная ссылка")
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise LookupError_("Нужна ссылка http(s)")
    _public_ip(parts.hostname, port or (443 if parts.scheme == "https" else 80))


# Соединение идёт ровно на тот IP, который проверили (иначе DNS мог бы второй раз ответить
# адресом из локальной сети — «DNS rebinding»)
class _PinnedHTTP(http.client.HTTPConnection):
    def connect(self) -> None:
        self.sock = socket.create_connection((_public_ip(self.host, self.port), self.port), self.timeout)


class _PinnedHTTPS(http.client.HTTPSConnection):
    def connect(self) -> None:
        sock = socket.create_connection((_public_ip(self.host, self.port), self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class _HTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):  # noqa: ANN001
        return self.do_open(_PinnedHTTP, req)


class _HTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):  # noqa: ANN001
        return self.do_open(_PinnedHTTPS, req, context=ssl.create_default_context())


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, PLR0913
        _check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


# без прокси из окружения: соединяемся напрямую с проверенным адресом
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _HTTPHandler(), _HTTPSHandler(), _SafeRedirect())


def fetch(url: str, limit: int, accept: str = "*/*") -> tuple[bytes, str]:
    """Скачать не больше limit байт. Возвращает (данные, content-type)."""
    _check_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    try:
        with _opener.open(req, timeout=TIMEOUT) as res:
            ctype = res.headers.get("Content-Type", "")
            data = res.read(limit + 1)
    except urllib.error.HTTPError as exc:
        raise LookupError_(f"Сайт ответил ошибкой {exc.code}")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise LookupError_(f"Нет связи с сайтом: {getattr(exc, 'reason', exc)}")
    if len(data) > limit:
        raise LookupError_("Файл слишком большой")
    return data, ctype


def fetch_image(url: str) -> bytes:
    data, ctype = fetch(url, MAX_IMAGE, "image/*")
    if ctype and not ctype.startswith("image/") and "octet-stream" not in ctype:
        raise LookupError_("По ссылке не картинка")
    if len(data) < 200:
        raise LookupError_("Картинка пустая")
    return data


def _get_json(url: str) -> dict:
    data, _ = fetch(url, MAX_JSON, "application/json")
    return json.loads(data.decode("utf-8", "replace"))


# ---------------- источники ----------------

_TAGS = re.compile(r"<[^>]+>")


def _clean(text: str) -> str:
    text = re.sub(r"<\s*br\s*/?>|</p>", "\n", text or "", flags=re.I)
    return re.sub(r"\n{3,}", "\n\n", _TAGS.sub("", text)).strip()


def _year(value: str | int | None) -> int | None:
    m = re.search(r"\d{4}", str(value or ""))
    return int(m.group(0)) if m else None


def google_books(query: str, isbn: str = "") -> list[dict]:
    q = f"isbn:{isbn}" if isbn else query
    url = "https://www.googleapis.com/books/v1/volumes?" + urllib.parse.urlencode({"q": q, "maxResults": 12, "printType": "books"})
    out = []
    for item in _get_json(url).get("items", []) or []:
        v = item.get("volumeInfo") or {}
        ids = {i.get("type"): i.get("identifier") for i in v.get("industryIdentifiers") or []}
        links = v.get("imageLinks") or {}
        cover = links.get("extraLarge") or links.get("large") or links.get("medium") or links.get("thumbnail") or links.get("smallThumbnail") or ""
        if cover:
            cover = cover.replace("http://", "https://").replace("&edge=curl", "")
        title = v.get("title") or ""
        if v.get("subtitle"):
            title = f"{title}. {v['subtitle']}"
        if not title:
            continue
        out.append(
            {
                "source": "Google Books",
                "title": title,
                "authors": v.get("authors") or [],
                "year": _year(v.get("publishedDate")),
                "publisher": v.get("publisher") or "",
                "isbn": ids.get("ISBN_13") or ids.get("ISBN_10") or "",
                "language": (v.get("language") or "")[:16],
                "pages": v.get("pageCount") or None,
                "subjects": v.get("categories") or [],
                "description": _clean(v.get("description") or ""),
                "cover": cover,
                "series": "",
                "series_index": None,
            }
        )
    return out


_OL_LANG = {"rus": "ru", "eng": "en", "ukr": "uk", "bel": "be", "ger": "de", "fre": "fr", "spa": "es", "ita": "it"}


def open_library(query: str, isbn: str = "") -> list[dict]:
    params = {"limit": 12, "fields": "key,title,subtitle,author_name,first_publish_year,publisher,isbn,language,number_of_pages_median,cover_i,subject"}
    params["isbn" if isbn else "q"] = isbn or query
    url = "https://openlibrary.org/search.json?" + urllib.parse.urlencode(params)
    out = []
    for d in _get_json(url).get("docs", []) or []:
        title = d.get("title") or ""
        if d.get("subtitle"):
            title = f"{title}. {d['subtitle']}"
        if not title:
            continue
        langs = d.get("language") or []
        isbns = d.get("isbn") or []
        out.append(
            {
                "source": "Open Library",
                "title": title,
                "authors": d.get("author_name") or [],
                "year": d.get("first_publish_year"),
                "publisher": (d.get("publisher") or [""])[0],
                "isbn": next((i for i in isbns if len(i) == 13), isbns[0] if isbns else ""),
                "language": _OL_LANG.get(langs[0], langs[0][:2]) if langs else "",
                "pages": d.get("number_of_pages_median"),
                "subjects": (d.get("subject") or [])[:8],
                "description": "",
                "cover": f"https://covers.openlibrary.org/b/id/{d['cover_i']}-L.jpg" if d.get("cover_i") else "",
                "series": "",
                "series_index": None,
            }
        )
    return out


def search(query: str, isbn: str = "") -> dict:
    """Искать сразу в обоих источниках. Ошибка одного не мешает другому."""
    isbn = re.sub(r"[^0-9Xx]", "", isbn or "")
    if len(isbn) not in (10, 13):
        isbn = ""
    query = " ".join((query or "").split())[:300]
    if not query and not isbn:
        raise LookupError_("Введите название или ISBN")
    results: list[dict] = []
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {name: pool.submit(fn, query, isbn) for name, fn in (("Google Books", google_books), ("Open Library", open_library))}
        for name, fut in futures.items():
            try:
                results.extend(fut.result(timeout=TIMEOUT * 2))
            except Exception as exc:  # noqa: BLE001
                log.info("Поиск метаданных (%s): %s", name, exc)
                errors.append(f"{name}: {exc}")
    # сначала с обложкой и описанием
    results.sort(key=lambda r: (not r["cover"], not r["description"]))
    return {"items": results[:24], "errors": errors}
