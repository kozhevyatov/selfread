from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

USERNAME_PATTERN = r"^[a-zA-Z0-9_.-]{3,64}$"
# Простая проверка: домашние адреса вида admin@home.local тоже допустимы.
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+$"

Palette = Literal["paper", "ink", "library"]
LibraryScope = Literal["all", "shared", "mine"]
ReadStatus = Literal["none", "want", "reading", "finished", "abandoned"]


# ---------- setup ----------
class SetupStatus(BaseModel):
    database_configured: bool
    database_from_env: bool
    setup_complete: bool
    setup_token_required: bool


class DatabaseConfig(BaseModel):
    type: Literal["sqlite", "mysql"]
    host: str | None = None
    port: int | None = 3306
    user: str | None = None
    password: str | None = None
    database: str | None = None


class AdminCreate(BaseModel):
    username: str = Field(pattern=USERNAME_PATTERN)
    email: str = Field(pattern=EMAIL_PATTERN, max_length=255)
    display_name: str = Field(default="", max_length=128)
    password: str = Field(min_length=8, max_length=128)
    site_name: str = Field(default="SelfRead", max_length=100)
    registration_mode: Literal["open", "closed"] = "closed"


# ---------- auth ----------
class LoginIn(BaseModel):
    login: str  # username или email
    password: str
    remember: bool = True


class RegisterIn(BaseModel):
    username: str = Field(pattern=USERNAME_PATTERN)
    email: str = Field(pattern=EMAIL_PATTERN, max_length=255)
    display_name: str = Field(default="", max_length=128)
    password: str = Field(min_length=8, max_length=128)


class RefreshIn(BaseModel):
    refresh_token: str | None = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str
    display_name: str
    is_admin: bool
    is_active: bool
    palette: str = "paper"
    palette_auto: bool = False
    palette_day: str = "paper"
    palette_night: str = "library"
    library_scope: str = "all"
    reader_prefs: str = "{}"
    avatar: str | None = None
    created_at: datetime
    last_seen_at: datetime | None = None


class ProfileUpdate(BaseModel):
    username: str | None = Field(default=None, pattern=USERNAME_PATTERN)
    display_name: str | None = Field(default=None, max_length=128)
    email: str | None = Field(default=None, pattern=EMAIL_PATTERN, max_length=255)
    palette: Palette | None = None
    palette_auto: bool | None = None
    palette_day: Palette | None = None
    palette_night: Palette | None = None
    library_scope: LibraryScope | None = None
    reader_prefs: str | None = Field(default=None, max_length=10000)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class TokenOut(BaseModel):
    access_token: str
    # Для мобильного приложения; в вебе refresh живёт в httpOnly-cookie.
    refresh_token: str
    # Для читалок и плееров приложения: долгий токен только для файлов и обложек (?mt=…)
    media_token: str | None = None
    token_type: str = "bearer"
    user: UserOut


# ---------- settings ----------
class PublicSettings(BaseModel):
    site_name: str
    registration_mode: Literal["open", "closed"]


class AdminSettings(PublicSettings):
    scan_interval: int
    public_url: str


class SettingsUpdate(BaseModel):
    site_name: str | None = Field(default=None, max_length=100)
    registration_mode: Literal["open", "closed"] | None = None
    scan_interval: int | None = Field(default=None, ge=0, le=7 * 24 * 60)
    public_url: str | None = Field(default=None, max_length=255)


# ---------- admin: пользователи ----------
class UserAdminCreate(BaseModel):
    username: str = Field(pattern=USERNAME_PATTERN)
    email: str = Field(pattern=EMAIL_PATTERN, max_length=255)
    display_name: str = Field(default="", max_length=128)
    password: str = Field(min_length=8, max_length=128)
    is_admin: bool = False


class UserAdminUpdate(BaseModel):
    is_admin: bool | None = None
    is_active: bool | None = None
    username: str | None = Field(default=None, pattern=USERNAME_PATTERN)
    display_name: str | None = Field(default=None, max_length=128)
    email: str | None = Field(default=None, pattern=EMAIL_PATTERN, max_length=255)


class PasswordReset(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class AccessItem(BaseModel):
    library_id: int
    can_write: bool = False


class AccessList(BaseModel):
    access: list[AccessItem]


# ---------- admin: медиатеки ----------
class LibraryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    # Пусто у личной медиатеки — папка создаётся сама: media/<логин>/books
    path: str = Field(default="", max_length=1024)
    # shared — общая (доступ по пользователям), personal — личная (видит только владелец)
    scope: Literal["shared", "personal"] = "shared"
    owner_id: int | None = None
    default_access: bool = True


class LibraryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    path: str | None = Field(default=None, min_length=1, max_length=1024)
    enabled: bool | None = None
    default_access: bool | None = None


class ScanRequest(BaseModel):
    library_id: int | None = None
    full: bool = False


# ---------- книги ----------
class StateUpdate(BaseModel):
    status: ReadStatus | None = None
    progress: float | None = Field(default=None, ge=0, le=1)
    position: str | None = Field(default=None, max_length=4000)
    chapter: str | None = Field(default=None, max_length=512)
    rating: int | None = Field(default=None, ge=0, le=5)


# ---------- полки ----------
class ShelfCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2000)
    is_shared: bool = False
    book_ids: list[int] = []


class ShelfUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2000)
    is_shared: bool | None = None


class ShelfBooks(BaseModel):
    book_ids: list[int]
