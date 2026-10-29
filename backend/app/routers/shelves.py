"""Полки: личные подборки книг. Общая полка видна всем пользователям, менять её может только владелец."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..access import allowed_library_ids
from ..db import get_db
from ..models import Book, Shelf, ShelfBook, User
from ..schemas import ShelfBooks, ShelfCreate, ShelfUpdate
from ..security import get_current_user
from .books import _cover

router = APIRouter(prefix="/api/shelves", tags=["shelves"])


def _shelf_out(db: Session, shelf: Shelf, user: User, lib_ids: list[int]) -> dict:
    visible = select(ShelfBook.book_id).join(Book, Book.id == ShelfBook.book_id).where(
        ShelfBook.shelf_id == shelf.id, Book.library_id.in_(lib_ids or [-1])
    )
    count = db.scalar(select(func.count()).select_from(visible.subquery())) or 0
    # несколько обложек для «корешков» на карточке полки
    books = list(
        db.scalars(
            select(Book)
            .join(ShelfBook, ShelfBook.book_id == Book.id)
            .where(ShelfBook.shelf_id == shelf.id, Book.library_id.in_(lib_ids or [-1]))
            .order_by(ShelfBook.added_at.desc())
            .limit(4)
        )
    )
    owner = db.get(User, shelf.owner_id)
    return {
        "id": shelf.id,
        "name": shelf.name,
        "description": shelf.description,
        "is_shared": shelf.is_shared,
        "mine": shelf.owner_id == user.id,
        "owner": {"id": owner.id, "name": owner.display_name or owner.username} if owner else None,
        "book_count": count,
        "preview": [{"id": b.id, "title": b.title, "cover": _cover(b)} for b in books],
        "updated_at": shelf.updated_at,
    }


def shelves_for(db: Session, user: User) -> list[dict]:
    lib_ids = allowed_library_ids(db, user, scoped=False)
    shelves = db.scalars(
        select(Shelf)
        .where(or_(Shelf.owner_id == user.id, Shelf.is_shared.is_(True)))
        .order_by((Shelf.owner_id != user.id), Shelf.position, Shelf.name)
    )
    return [_shelf_out(db, s, user, lib_ids) for s in shelves]


def _own(db: Session, user: User, shelf_id: int) -> Shelf:
    shelf = db.get(Shelf, shelf_id)
    if not shelf or shelf.owner_id != user.id:
        raise HTTPException(404, "Полка не найдена")
    return shelf


def _add(db: Session, user: User, shelf: Shelf, book_ids: list[int]) -> int:
    lib_ids = allowed_library_ids(db, user, scoped=False)
    ok = set(db.scalars(select(Book.id).where(Book.id.in_(book_ids or [-1]), Book.library_id.in_(lib_ids or [-1]))))
    have = set(db.scalars(select(ShelfBook.book_id).where(ShelfBook.shelf_id == shelf.id)))
    added = 0
    for bid in book_ids:
        if bid in ok and bid not in have:
            db.add(ShelfBook(shelf_id=shelf.id, book_id=bid))
            have.add(bid)
            added += 1
    shelf.updated_at = datetime.now(timezone.utc)
    return added


@router.get("")
def list_shelves(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    return shelves_for(db, user)


@router.post("")
def create_shelf(data: ShelfCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    position = (db.scalar(select(func.max(Shelf.position)).where(Shelf.owner_id == user.id)) or 0) + 1
    shelf = Shelf(owner_id=user.id, name=data.name.strip(), description=data.description, is_shared=data.is_shared, position=position)
    db.add(shelf)
    db.flush()
    if data.book_ids:
        _add(db, user, shelf, data.book_ids)
    db.commit()
    return _shelf_out(db, shelf, user, allowed_library_ids(db, user, scoped=False))


@router.get("/{shelf_id}")
def get_shelf(shelf_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    shelf = db.get(Shelf, shelf_id)
    if not shelf or (shelf.owner_id != user.id and not shelf.is_shared):
        raise HTTPException(404, "Полка не найдена")
    return _shelf_out(db, shelf, user, allowed_library_ids(db, user, scoped=False))


@router.patch("/{shelf_id}")
def update_shelf(shelf_id: int, data: ShelfUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    shelf = _own(db, user, shelf_id)
    if data.name is not None:
        shelf.name = data.name.strip()
    if data.description is not None:
        shelf.description = data.description
    if data.is_shared is not None:
        shelf.is_shared = data.is_shared
    shelf.updated_at = datetime.now(timezone.utc)
    db.commit()
    return _shelf_out(db, shelf, user, allowed_library_ids(db, user, scoped=False))


@router.delete("/{shelf_id}")
def delete_shelf(shelf_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    shelf = _own(db, user, shelf_id)
    db.delete(shelf)
    db.commit()
    return {"ok": True}


@router.post("/{shelf_id}/books")
def add_books(shelf_id: int, data: ShelfBooks, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    shelf = _own(db, user, shelf_id)
    added = _add(db, user, shelf, data.book_ids)
    db.commit()
    return {"added": added}


@router.delete("/{shelf_id}/books/{book_id}")
def remove_book(shelf_id: int, book_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    shelf = _own(db, user, shelf_id)
    row = db.get(ShelfBook, (shelf.id, book_id))
    if row:
        db.delete(row)
        shelf.updated_at = datetime.now(timezone.utc)
        db.commit()
    return {"ok": True}
