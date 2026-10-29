"""Ограничение размера тела запроса.

FastAPI разбирает multipart-форму (и складывает файл во временную папку) ещё до проверки
авторизации. Без этого кто угодно мог бы залить гигабайты в контейнер, не входя в систему.
Здесь проверяем токен и размер до того, как приложение начнёт читать тело.
"""
from __future__ import annotations

import json
import re

from fastapi import HTTPException

from .security import decode_token

MB = 1024 * 1024
DEFAULT_LIMIT = 2 * MB
# (шаблон пути, лимит, нужен ли access-токен в заголовке)
RULES: list[tuple[re.Pattern[str], int, bool]] = [
    (re.compile(r"^/api/uploads/?$"), 2048 * MB + 16 * MB, True),
    (re.compile(r"^/api/me/avatar/?$"), 16 * MB, True),
    (re.compile(r"^/api/admin/users/\d+/avatar/?$"), 16 * MB, True),
]


async def _reply(send, status: int, detail: str) -> None:  # noqa: ANN001
    body = json.dumps({"detail": detail}, ensure_ascii=False).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json; charset=utf-8"), (b"content-length", str(len(body)).encode()), (b"connection", b"close")],
        }
    )
    await send({"type": "http.response.body", "body": body})


class BodyLimitMiddleware:
    def __init__(self, app) -> None:  # noqa: ANN001
        self.app = app

    async def __call__(self, scope, receive, send):  # noqa: ANN001
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS", "DELETE"):
            return await self.app(scope, receive, send)

        path = scope.get("path", "")
        limit, need_auth = DEFAULT_LIMIT, False
        for pattern, rule_limit, rule_auth in RULES:
            if pattern.match(path):
                limit, need_auth = rule_limit, rule_auth
                break

        headers = dict(scope.get("headers") or [])
        if need_auth:
            auth = headers.get(b"authorization", b"").decode("latin-1")
            token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
            try:
                if not token:
                    raise HTTPException(401, "Требуется авторизация")
                decode_token(token, "access")
            except HTTPException as exc:
                return await _reply(send, exc.status_code, str(exc.detail))

        declared = headers.get(b"content-length")
        if declared is not None:
            try:
                if int(declared) > limit:
                    return await _reply(send, 413, "Слишком большой запрос")
            except ValueError:
                return await _reply(send, 400, "Неверный Content-Length")

        received = 0
        too_big = False

        async def limited_receive():  # noqa: ANN202
            nonlocal received, too_big
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    too_big = True
                    raise HTTPException(413, "Слишком большой запрос")
            return message

        try:
            await self.app(scope, limited_receive, send)
        except HTTPException:
            if not too_big:
                raise
            # ответ, возможно, ещё не начат — попробуем ответить, иначе просто закрываем соединение
            try:
                await _reply(send, 413, "Слишком большой запрос")
            except Exception:  # noqa: BLE001
                pass
