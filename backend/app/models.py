from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

# MariaDB: FLOAT без точности — 4 байта (mtime ≈1.7e9 теряет ~2 минуты), TEXT — до 64 КБ.
# asdecimal=False: иначе MariaDB вернёт Decimal, и арифметика с float упадёт
Double = Float(precision=53).with_variant(mysql.DOUBLE(asdecimal=False), "mysql", "mariadb")
LongText = Text().with_variant(mysql.MEDIUMTEXT(), "mysql", "mariadb")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------- пользователи и настройки ----------------


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(128), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Увеличивается при смене пароля/выходе со всех устройств — инвалидирует refresh-токены.
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    # Оформление: палитра интерфейса (paper | ink | library) и автопереключение день/ночь
    palette: Mapped[str] = mapped_column(String(16), default="paper")
    palette_auto: Mapped[bool] = mapped_column(Boolean, default=False)
    palette_day: Mapped[str] = mapped_column(String(16), default="paper")
    palette_night: Mapped[str] = mapped_column(String(16), default="library")
    # что показывать в библиотеке: all — всё, shared — только общие медиатеки, mine — только личные
    library_scope: Mapped[str] = mapped_column(String(16), default="all")
    # Настройки читалки (шрифт, размер, поля, тема страницы) — JSON, заполняет фронтенд
    reader_prefs: Mapped[str] = mapped_column(Text, default="{}")
    # 0 — нет аватарки; иначе номер версии (для сброса кэша в браузере)
    avatar_version: Mapped[int] = mapped_column(Integer, default=0)
    # Цель на год: сколько книг прочитать (0 — без цели)
    reading_goal: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def avatar(self) -> str | None:
        return f"/api/avatar/{self.id}?v={self.avatar_version}" if self.avatar_version else None


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


# ---------------- медиатеки ----------------


class Library(Base):
    """Медиатека — папка с книгами и аудиокнигами.

    Общая (owner_id = NULL): доступ выдаётся пользователям по отдельности.
    Личная (owner_id = пользователь): видит только владелец.
    """

    __tablename__ = "libraries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    path: Mapped[str] = mapped_column(String(1024))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Общая медиатека: открывать ли её новым пользователям автоматически
    default_access: Mapped[bool] = mapped_column(Boolean, default=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    book_count: Mapped[int] = mapped_column(Integer, default=0)
    audio_count: Mapped[int] = mapped_column(Integer, default=0)
    total_size: Mapped[int] = mapped_column(BigInteger, default=0)
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_scan_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LibraryAccess(Base):
    __tablename__ = "library_access"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), primary_key=True)
    # Право записи (загрузка книг в эту медиатеку). Чтение — само наличие строки.
    can_write: Mapped[bool] = mapped_column(Boolean, default=False)


# ---------------- книги ----------------


class Book(Base):
    """Книга: электронная (один или несколько файлов-форматов с одним именем в одной папке)
    или аудиокнига (папка с аудиофайлами либо один .m4b)."""

    __tablename__ = "books"
    __table_args__ = (
        UniqueConstraint("library_id", "key_hash", name="uq_book_key"),
        Index("ix_books_library_added", "library_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), index=True)
    # ebook | audio
    kind: Mapped[str] = mapped_column(String(8), default="ebook", index=True)
    # Ключ книги: «папка/имя-без-расширения» (ebook) или «папка» (аудиокнига) — от корня медиатеки
    key: Mapped[str] = mapped_column(Text)
    key_hash: Mapped[str] = mapped_column(String(40))
    # Основной формат (epub, fb2, pdf, …, m4b, mp3) и путь к основному файлу от корня медиатеки
    format: Mapped[str] = mapped_column(String(8), default="", index=True)
    path: Mapped[str] = mapped_column(Text)
    # ebook: [{"format", "path", "size"}]; audio: [{"path", "title", "duration", "size"}]
    files: Mapped[str] = mapped_column(LongText, default="[]")
    title: Mapped[str] = mapped_column(String(512))
    sort_title: Mapped[str] = mapped_column(String(512), default="", index=True)
    # Авторы через «; »
    authors: Mapped[str] = mapped_column(String(1024), default="")
    author_sort: Mapped[str] = mapped_column(String(512), default="", index=True)
    narrator: Mapped[str] = mapped_column(String(512), default="")
    series: Mapped[str] = mapped_column(String(512), default="", index=True)
    series_index: Mapped[float | None] = mapped_column(Float, nullable=True)
    language: Mapped[str] = mapped_column(String(16), default="")
    publisher: Mapped[str] = mapped_column(String(255), default="")
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    isbn: Mapped[str] = mapped_column(String(32), default="")
    # Жанры/теги через «; »
    subjects: Mapped[str] = mapped_column(String(1024), default="")
    description: Mapped[str] = mapped_column(LongText, default="")
    pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration: Mapped[float] = mapped_column(Double, default=0)  # секунд (аудио)
    # Главы аудиокниги в одном файле (m4b): [{"title", "start"}]
    chapters: Mapped[str] = mapped_column(LongText, default="[]")
    size: Mapped[int] = mapped_column(BigInteger, default=0)
    # Отпечаток файлов (размеры + mtime) — пересканировать, только если изменился
    fingerprint: Mapped[str] = mapped_column(String(40), default="")
    # 0 — обложки нет; иначе версия (сброс кэша браузера)
    cover_version: Mapped[int] = mapped_column(Integer, default=0)
    scan_error: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Поля, исправленные вручную, через запятую (title,authors,…,cover) — сканер их не перезаписывает
    locked: Mapped[str] = mapped_column(String(512), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------- пользовательские данные ----------------


class ReadState(Base):
    """Статус и прогресс книги у пользователя."""

    __tablename__ = "read_states"
    __table_args__ = (Index("ix_read_states_user_updated", "user_id", "updated_at"),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), primary_key=True, index=True)
    # none | want | reading | finished | abandoned
    status: Mapped[str] = mapped_column(String(16), default="none")
    progress: Mapped[float] = mapped_column(Float, default=0)  # доля 0..1
    # Где остановился: CFI для EPUB, номер страницы для PDF, секунды для аудио — решает читалка
    position: Mapped[str] = mapped_column(Text, default="")
    # Название текущей главы — показываем на карточке «Читаю сейчас»
    chapter: Mapped[str] = mapped_column(String(512), default="")
    rating: Mapped[int] = mapped_column(Integer, default=0)  # 0 — без оценки, 1..5
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Shelf(Base):
    """Полка — подборка книг пользователя. Общая полка видна всем (менять может только владелец)."""

    __tablename__ = "shelves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    is_shared: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ShelfBook(Base):
    __tablename__ = "shelf_books"

    shelf_id: Mapped[int] = mapped_column(ForeignKey("shelves.id", ondelete="CASCADE"), primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), primary_key=True, index=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Annotation(Base):
    """Закладка или цитата (с заметкой) пользователя в книге."""

    __tablename__ = "annotations"
    __table_args__ = (Index("ix_annotations_user_book", "user_id", "book_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    # bookmark — закладка, quote — цитата (выделенный текст, может быть с заметкой)
    kind: Mapped[str] = mapped_column(String(16), default="quote")
    # Где: CFI для электронной книги, «номер_файла:секунды» для аудиокниги
    position: Mapped[str] = mapped_column(Text, default="")
    text: Mapped[str] = mapped_column(LongText, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(16), default="yellow")
    chapter: Mapped[str] = mapped_column(String(512), default="")
    progress: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ReadingDay(Base):
    """Сколько секунд пользователь читал/слушал книгу в этот день (для статистики)."""

    __tablename__ = "reading_days"
    __table_args__ = (
        UniqueConstraint("user_id", "book_id", "day", name="uq_reading_day"),
        Index("ix_reading_days_user_day", "user_id", "day"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # книгу удалили — минуты в статистике остаются
    book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), nullable=True, index=True)
    day: Mapped[str] = mapped_column(String(10))  # YYYY-MM-DD по часам пользователя
    kind: Mapped[str] = mapped_column(String(8), default="ebook")
    seconds: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
