"""Права доступа к медиатекам.

Чтение: администратор видит все общие включённые медиатеки; пользователь — общие, которые ему
открыли, плюс свои личные. Всё, что отдаёт API, фильтруется через allowed_library_ids.
"""
from __future__ import annotations

import os

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .models import Book, Library, LibraryAccess, User


def allowed_library_ids(db: Session, user: User, scoped: bool = True) -> list[int]:
    """Доступные пользователю медиатеки. scoped — учитывать выбор «Все / Общие / Мои» (user.library_scope)."""
    access = select(LibraryAccess.library_id).where(LibraryAccess.user_id == user.id)
    cond = or_(Library.owner_id == user.id, Library.id.in_(access))
    if user.is_admin:
        cond = or_(cond, Library.owner_id.is_(None))
    rows = list(db.execute(select(Library.id, Library.owner_id).where(Library.enabled.is_(True), cond)))
    ids = [r[0] for r in rows]
    scope = user.library_scope or "all"
    if scoped and scope != "all":
        mine = [i for i, owner in rows if owner == user.id]
        shared = [i for i, owner in rows if owner != user.id]
        # фильтруем, только когда есть из чего выбирать — иначе библиотека просто опустела бы
        if mine and shared:
            return mine if scope == "mine" else shared
    return ids


def can_read_book(db: Session, user: User, book: Book) -> bool:
    return book.library_id in allowed_library_ids(db, user, scoped=False)


def fs_writable(path: str) -> bool:
    return os.path.isdir(path) and os.access(path, os.W_OK | os.X_OK)


def grant_default_access(db: Session, user: User) -> None:
    """Новому пользователю — общие медиатеки, отмеченные «открыта для новых пользователей»."""
    for lib in db.scalars(select(Library).where(Library.default_access.is_(True), Library.owner_id.is_(None))):
        db.add(LibraryAccess(user_id=user.id, library_id=lib.id))


def set_user_access(db: Session, user_id: int, access: list[tuple[int, bool]]) -> None:
    """Полный список доступа пользователя к общим медиатекам: [(library_id, can_write), ...]."""
    current = {row.library_id: row for row in db.scalars(select(LibraryAccess).where(LibraryAccess.user_id == user_id))}
    wanted = dict(access)
    for lid, row in current.items():
        if lid not in wanted:
            db.delete(row)
        else:
            row.can_write = bool(wanted[lid])
    new_ids = [lid for lid in wanted if lid not in current]
    if new_ids:
        for lid in db.scalars(select(Library.id).where(Library.id.in_(new_ids), Library.owner_id.is_(None))):
            db.add(LibraryAccess(user_id=user_id, library_id=lid, can_write=bool(wanted[lid])))


def can_write(db: Session, user: User, lib: Library) -> bool:
    """Можно ли менять файлы медиатеки: своя личная, общая с правом записи, администратор — любая общая."""
    if not lib.enabled:
        return False
    if lib.owner_id is not None:
        return lib.owner_id == user.id
    if user.is_admin:
        return True
    row = db.get(LibraryAccess, (user.id, lib.id))
    return bool(row and row.can_write)

