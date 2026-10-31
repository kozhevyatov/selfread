from __future__ import annotations

import logging
import mimetypes
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db
from . import scanner as _scanner  # noqa: F401 — регистрирует запуск сканера после подключения БД
from .config import VERSION, settings
from .limits import BodyLimitMiddleware
from .routers import admin, annotations, auth, book_edit, books, profile, setup, shelves, stats, uploads

logging.getLogger("uvicorn.error").setLevel(logging.INFO)

# модули читалки (foliate-js, pdf.js) — .mjs должен отдаваться как JavaScript
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/octet-stream", ".bcmap")

# Политика безопасности страницы: книги (EPUB и др.) рендерятся в iframe с blob:-адресов,
# и скрипты внутри книги не должны выполняться — разрешены только наши собственные файлы.
CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "worker-src 'self' blob:",
        "style-src 'self' 'unsafe-inline' blob: https://fonts.googleapis.com",
        "font-src 'self' data: blob: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob:",
        "frame-src 'self' blob:",
        "connect-src 'self' blob: data:",
        "object-src 'none'",
        "base-uri 'self'",
    ]
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.startup()
    yield


class ImmutableStatic(StaticFiles):
    """Файлы сборки Vite с хешем в имени — кэшируем «навсегда»."""

    async def get_response(self, path, scope):  # noqa: ANN001
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


app = FastAPI(title="SelfRead API", version=VERSION, lifespan=lifespan)
app.add_middleware(BodyLimitMiddleware)

app.include_router(setup.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(profile.router)
app.include_router(profile.avatar_router)
app.include_router(books.router)
app.include_router(shelves.router)
app.include_router(uploads.router)
app.include_router(annotations.router)
app.include_router(stats.router)
app.include_router(book_edit.router)


@app.get("/api/health", tags=["system"])
def health() -> dict:
    return {"status": "ok", "version": VERSION, "database": db.is_configured()}


# ---------- фронтенд (SPA) ----------
static_dir = settings.static_dir
if (static_dir / "assets").exists():
    app.mount("/assets", ImmutableStatic(directory=static_dir / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "Not found")
    candidate = (static_dir / path).resolve()
    if path and candidate.is_file() and static_dir.resolve() in candidate.parents:
        headers = {}
        if candidate.suffix == ".html":
            headers["Content-Security-Policy"] = CSP
        if candidate.name in ("sw.js", "manifest.json"):
            # Браузер должен быстро замечать новую версию service worker
            headers["Cache-Control"] = "no-cache"
            if candidate.name == "sw.js":
                headers["Service-Worker-Allowed"] = "/"
        return FileResponse(candidate, headers=headers)
    index = static_dir / "index.html"
    if index.exists():
        # index.html не кэшируем — иначе после деплоя открывалась бы старая версия
        return FileResponse(index, headers={"Cache-Control": "no-cache", "Content-Security-Policy": CSP})
    raise HTTPException(404, "Фронтенд не собран")
