from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db
from . import scanner as _scanner  # noqa: F401 — регистрирует запуск сканера после подключения БД
from .config import VERSION, settings
from .limits import BodyLimitMiddleware
from .routers import admin, auth, books, profile, setup, shelves

logging.getLogger("uvicorn.error").setLevel(logging.INFO)


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
        if candidate.name in ("sw.js", "manifest.json"):
            # Браузер должен быстро замечать новую версию service worker
            headers["Cache-Control"] = "no-cache"
            if candidate.name == "sw.js":
                headers["Service-Worker-Allowed"] = "/"
        return FileResponse(candidate, headers=headers)
    index = static_dir / "index.html"
    if index.exists():
        # index.html не кэшируем — иначе после деплоя открывалась бы старая версия
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    raise HTTPException(404, "Фронтенд не собран")
