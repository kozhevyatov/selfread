"""Защита входа от перебора паролей (в памяти процесса — для одного контейнера достаточно).

Считаем только неудачные попытки. Три счётчика:
- логин + IP (10 за 15 мин) — обычная защита от подбора;
- IP (30) — перебор разных логинов с одного адреса;
- логин со всех адресов (100) — подбор одного пароля через много адресов.
Так злоумышленник не может «запереть» администратора 10 неверными попытками со своего IP.
"""
from __future__ import annotations

import threading
import time

from fastapi import HTTPException

WINDOW = 15 * 60  # сек
MAX_PER_LOGIN_IP = 10
MAX_PER_IP = 30
MAX_PER_LOGIN = 100

_lock = threading.Lock()
_fails: dict[str, list[float]] = {}


class TooManyAttempts(HTTPException):
    pass


def _recent(key: str, now: float) -> list[float]:
    hits = [t for t in _fails.get(key, []) if now - t < WINDOW]
    if hits:
        _fails[key] = hits
    else:
        _fails.pop(key, None)
    return hits


def _login_cap(login: str) -> int:
    # Пароль общей ссылки часто короткий (PIN) — для него общий лимит строже
    return 30 if login.startswith("share:") else MAX_PER_LOGIN


def check(login: str, ip: str) -> None:
    now = time.monotonic()
    with _lock:
        pair = _recent(f"p:{login.lower()}|{ip}", now)
        by_ip = _recent(f"i:{ip}", now)
        by_login = _recent(f"l:{login.lower()}", now)
        hit = next(
            (h for h, cap in ((pair, MAX_PER_LOGIN_IP), (by_ip, MAX_PER_IP), (by_login, _login_cap(login))) if len(h) >= cap),
            None,
        )
        if hit is not None:
            oldest = hit[0]
            wait = max(1, int(WINDOW - (now - oldest)) // 60 + 1)
            raise TooManyAttempts(429, f"Слишком много неудачных попыток. Попробуйте через {wait} мин.")


def fail(login: str, ip: str) -> None:
    now = time.monotonic()
    with _lock:
        for key in (f"p:{login.lower()}|{ip}", f"l:{login.lower()}", f"i:{ip}"):
            _fails.setdefault(key, []).append(now)
        # не даём словарю расти бесконечно
        if len(_fails) > 10_000:
            for k in list(_fails)[:5_000]:
                _fails.pop(k, None)


def success(login: str, ip: str | None = None) -> None:
    with _lock:
        if ip is not None:
            _fails.pop(f"p:{login.lower()}|{ip}", None)
