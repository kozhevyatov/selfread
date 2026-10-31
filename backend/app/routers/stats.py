"""Статистика чтения: время по дням (читалка и плеер присылают его раз в минуту), прочитанные книги, цель на год."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..access import allowed_library_ids
from ..db import get_db
from ..models import Book, ReadingDay, ReadState, User
from ..schemas import TrackIn
from ..security import get_current_user
from .books import _get_book, book_brief, briefs

router = APIRouter(prefix="/api/stats", tags=["stats"])

MIN_DAY = 60  # день засчитывается в серию, если читал хотя бы минуту


def _parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, "Дата в формате ГГГГ-ММ-ДД")


@router.post("/track")
def track(data: TrackIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Добавить время чтения/прослушивания книги за день (по часам пользователя)."""
    day = _parse_day(data.day)
    if day > datetime.now(timezone.utc).date() + timedelta(days=1):
        raise HTTPException(422, "Дата из будущего")
    book = _get_book(db, user, data.book_id)
    now = datetime.now(timezone.utc)
    where = (ReadingDay.user_id == user.id, ReadingDay.book_id == book.id, ReadingDay.day == data.day)
    # прибавляем на стороне базы: два одновременных запроса не потеряют секунды (за сутки — не больше 24 часов)
    total = ReadingDay.seconds + data.seconds
    add = update(ReadingDay).where(*where).values(seconds=case((total > 86400, 86400), else_=total), kind=data.kind, updated_at=now)
    for _ in range(2):
        if db.execute(add).rowcount:
            db.commit()
            return {"ok": True}
        db.add(ReadingDay(user_id=user.id, book_id=book.id, day=data.day, kind=data.kind, seconds=min(86400, data.seconds), updated_at=now))
        try:
            db.commit()
            return {"ok": True}
        except IntegrityError:
            db.rollback()  # строку только что вставил параллельный запрос — прибавим к ней
    raise HTTPException(409, "Повторите позже")


def _streaks(active: set[date], today: date) -> tuple[int, int]:
    """Текущая серия (до сегодня или вчера) и лучшая серия."""
    current = 0
    d = today if today in active else today - timedelta(days=1)
    while d in active:
        current += 1
        d -= timedelta(days=1)
    best = run = 0
    prev: date | None = None
    for d in sorted(active):
        run = run + 1 if prev and (d - prev).days == 1 else 1
        best = max(best, run)
        prev = d
    return current, best


@router.get("")
def stats(
    year: int | None = Query(None, ge=1970, le=3000),
    today: str = "",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    now_day = _parse_day(today) if today else datetime.now(timezone.utc).date()
    year = year or now_day.year
    rows = list(db.execute(select(ReadingDay.day, ReadingDay.book_id, ReadingDay.kind, ReadingDay.seconds).where(ReadingDay.user_id == user.id)).all())

    per_day: dict[str, int] = defaultdict(int)
    for day, _book, _kind, secs in rows:
        per_day[day] += secs
    years = sorted({int(d[:4]) for d in per_day} | {now_day.year}, reverse=True)
    active = {date.fromisoformat(d) for d, s in per_day.items() if s >= MIN_DAY}
    streak, best_streak = _streaks(active, now_day)

    prefix = f"{year:04d}-"
    year_rows = [r for r in rows if r[0].startswith(prefix)]
    months = [{"month": m, "ebook": 0, "audio": 0, "finished": 0} for m in range(1, 13)]
    kinds = {"ebook": 0, "audio": 0}
    by_book: dict[int, int] = defaultdict(int)
    for day, book_id, kind, secs in year_rows:
        k = "audio" if kind == "audio" else "ebook"
        months[int(day[5:7]) - 1][k] += secs
        kinds[k] += secs
        if book_id:
            by_book[book_id] += secs

    def total_since(days: int) -> int:
        start = (now_day - timedelta(days=days - 1)).isoformat()
        return sum(s for d, s in per_day.items() if start <= d <= now_day.isoformat())

    # прочитанные в этом году книги
    ids = allowed_library_ids(db, user, scoped=False) or [-1]
    start = datetime(year, 1, 1, tzinfo=timezone.utc)
    end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    finished_rows = list(
        db.execute(
            select(Book, ReadState)
            .join(ReadState, and_(ReadState.book_id == Book.id, ReadState.user_id == user.id))
            .where(ReadState.status == "finished", ReadState.finished_at >= start, ReadState.finished_at < end, Book.library_id.in_(ids))
            .order_by(ReadState.finished_at.desc())
        )
    )
    finished = []
    for b, s in finished_rows:
        months[s.finished_at.month - 1]["finished"] += 1
        finished.append(book_brief(b, s) | {"finished_at": s.finished_at, "seconds": by_book.get(b.id, 0)})

    top_ids = [bid for bid, _ in sorted(by_book.items(), key=lambda x: -x[1])[:8]]
    top_books = {b.id: b for b in db.scalars(select(Book).where(Book.id.in_(top_ids or [-1]), Book.library_id.in_(ids)))}
    top_out = {b["id"]: b for b in briefs(db, user, list(top_books.values()))}
    top = [{"book": top_out[bid], "seconds": by_book[bid]} for bid in top_ids if bid in top_out]

    year_total = kinds["ebook"] + kinds["audio"]
    active_days = sum(1 for d, s in per_day.items() if d.startswith(prefix) and s >= MIN_DAY)
    return {
        "year": year,
        "years": years,
        "today": now_day.isoformat(),
        "goal": user.reading_goal,
        "seconds": {
            "today": per_day.get(now_day.isoformat(), 0),
            "week": total_since(7),
            "month": total_since(30),
            "year": year_total,
            "ebook": kinds["ebook"],
            "audio": kinds["audio"],
        },
        "active_days": active_days,
        "avg_per_active_day": round(year_total / active_days) if active_days else 0,
        "streak": streak,
        "best_streak": best_streak,
        "days": {d: s for d, s in sorted(per_day.items()) if d.startswith(prefix)},
        "months": months,
        "finished": finished,
        "top": top,
    }
