"""Закладки и цитаты (с заметками). Личные: видит только автор."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..access import allowed_library_ids
from ..db import get_db
from ..models import Annotation, Book, User
from ..schemas import AnnotationCreate, AnnotationUpdate
from ..security import get_current_user
from .books import _get_book, _like, briefs

router = APIRouter(prefix="/api", tags=["annotations"])


def annotation_out(a: Annotation) -> dict:
    return {
        "id": a.id,
        "book_id": a.book_id,
        "kind": a.kind,
        "position": a.position,
        "text": a.text,
        "note": a.note,
        "color": a.color,
        "chapter": a.chapter,
        "progress": a.progress,
        "created_at": a.created_at,
        "updated_at": a.updated_at,
    }


@router.get("/books/{book_id}/annotations")
def book_annotations(book_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    book = _get_book(db, user, book_id)
    rows = db.scalars(
        select(Annotation).where(Annotation.user_id == user.id, Annotation.book_id == book.id).order_by(Annotation.progress, Annotation.id)
    )
    return [annotation_out(a) for a in rows]


@router.post("/books/{book_id}/annotations")
def create_annotation(book_id: int, data: AnnotationCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    book = _get_book(db, user, book_id)
    if data.kind == "quote" and not data.text.strip():
        raise HTTPException(422, "Пустая цитата")
    if db.scalar(select(func.count()).select_from(Annotation).where(Annotation.user_id == user.id, Annotation.book_id == book.id)) >= 5000:
        raise HTTPException(409, "Слишком много закладок в одной книге")
    now = datetime.now(timezone.utc)
    a = Annotation(
        user_id=user.id,
        book_id=book.id,
        kind=data.kind,
        position=data.position,
        text=data.text.strip(),
        note=data.note.strip(),
        color=data.color,
        chapter=data.chapter.strip(),
        progress=data.progress,
        created_at=now,
        updated_at=now,
    )
    db.add(a)
    db.commit()
    return annotation_out(a)


def _own(db: Session, user: User, annotation_id: int) -> Annotation:
    a = db.get(Annotation, annotation_id)
    if not a or a.user_id != user.id:
        raise HTTPException(404, "Закладка не найдена")
    return a


@router.patch("/annotations/{annotation_id}")
def update_annotation(annotation_id: int, data: AnnotationUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    a = _own(db, user, annotation_id)
    if data.note is not None:
        a.note = data.note.strip()
    if data.color is not None:
        a.color = data.color
    a.updated_at = datetime.now(timezone.utc)
    db.commit()
    return annotation_out(a)


@router.delete("/annotations/{annotation_id}")
def delete_annotation(annotation_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    a = _own(db, user, annotation_id)
    db.delete(a)
    db.commit()
    return {"ok": True}


@router.get("/annotations")
def all_annotations(
    q: str = "",
    kind: str = "quote",
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Все цитаты (или закладки) пользователя — новые сверху, с книгами."""
    ids = allowed_library_ids(db, user, scoped=False) or [-1]
    query = select(Annotation).join(Book, Book.id == Annotation.book_id).where(Annotation.user_id == user.id, Book.library_id.in_(ids))
    if kind in ("quote", "bookmark"):
        query = query.where(Annotation.kind == kind)
    if q.strip():
        for word in q.split()[:6]:
            pat = _like(word)
            query = query.where(
                or_(
                    func.lower(Annotation.text).like(pat, escape="\\"),
                    func.lower(Annotation.note).like(pat, escape="\\"),
                    func.lower(Book.title).like(pat, escape="\\"),
                    func.lower(Book.authors).like(pat, escape="\\"),
                )
            )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = list(db.scalars(query.order_by(Annotation.created_at.desc(), Annotation.id.desc()).offset(offset).limit(limit)))
    books = {b.id: b for b in db.scalars(select(Book).where(Book.id.in_({a.book_id for a in rows} or {-1})))}
    book_out = {b["id"]: b for b in briefs(db, user, list(books.values()))}
    return {"total": total, "items": [annotation_out(a) | {"book": book_out.get(a.book_id)} for a in rows]}
