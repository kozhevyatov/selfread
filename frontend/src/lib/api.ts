/**
 * Клиент API SelfRead.
 * access-токен живёт в памяти, refresh — в httpOnly-cookie; для файлов книг и обложек
 * сервер ставит отдельную media-cookie, поэтому <img>, <audio> и читалка работают без заголовков.
 * При 401 клиент один раз обновляет токен и повторяет запрос.
 */
import { setOffline, whenBackOnline } from "./network";

export type Palette = "paper" | "ink" | "library";
export type LibraryScope = "all" | "shared" | "mine";
export type ReadStatus = "none" | "want" | "reading" | "finished" | "abandoned";

export type User = {
  id: number;
  username: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  is_active: boolean;
  palette: Palette;
  palette_auto: boolean;
  palette_day: Palette;
  palette_night: Palette;
  library_scope: LibraryScope;
  reader_prefs: string;
  /** адрес аватарки или null — тогда показываем букву */
  avatar: string | null;
  created_at: string;
  last_seen_at: string | null;
};

export type TokenResponse = { access_token: string; refresh_token: string; media_token?: string | null; token_type: string; user: User };

export type SetupStatus = {
  database_configured: boolean;
  database_from_env: boolean;
  setup_complete: boolean;
  setup_token_required: boolean;
};

export type RegistrationMode = "open" | "closed";
export type PublicSettings = { site_name: string; registration_mode: RegistrationMode };
export type AdminSettings = PublicSettings & { scan_interval: number; public_url: string };

export type DatabaseConfig = {
  type: "sqlite" | "mysql";
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
};

export type ReadState = {
  status: ReadStatus;
  progress: number;
  position: string;
  chapter: string;
  rating: number;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
};

export type BookKind = "ebook" | "audio";

export type Book = {
  id: number;
  kind: BookKind;
  format: string;
  formats: string[];
  title: string;
  authors: string[];
  series: string;
  series_index: number | null;
  year: number | null;
  pages: number | null;
  duration: number;
  cover: string | null;
  library_id: number;
  created_at: string;
  state: ReadState;
};

export type BookFile = {
  name: string;
  format: string;
  size: number;
  title?: string;
  duration?: number;
  index?: number;
};

export type BookDetail = Book & {
  narrator: string;
  language: string;
  publisher: string;
  isbn: string;
  subjects: string[];
  description: string;
  size: number;
  files: BookFile[];
  chapters: { title: string; start: number }[];
  library: { id: number; name: string; scope: "personal" | "shared" } | null;
  scan_error: string | null;
  can_delete?: boolean;
  shelves: { id: number; name: string }[];
  series_books: Book[];
};

export type BookList = { total: number; items: Book[] };

export type Shelf = {
  id: number;
  name: string;
  description: string;
  is_shared: boolean;
  mine: boolean;
  owner: { id: number; name: string } | null;
  book_count: number;
  preview: { id: number; title: string; cover: string | null }[];
  updated_at: string;
};

export type MyLibrary = {
  id: number;
  name: string;
  scope: "personal" | "shared";
  mine: boolean;
  book_count: number;
  audio_count: number;
};

export type Home = {
  reading: Book[];
  recent: Book[];
  want: Book[];
  shelves: Shelf[];
  counts: { total: number } & Partial<Record<ReadStatus, number>>;
};

export type Facets = { formats: Record<string, number>; kinds: Partial<Record<BookKind, number>> };

export type AdminUser = User & {
  access: { library_id: number; can_write: boolean }[];
  personal_libraries: number[];
};

export type AdminLibrary = {
  id: number;
  name: string;
  path: string;
  scope: "personal" | "shared";
  owner: { id: number; name: string } | null;
  writable: boolean;
  enabled: boolean;
  default_access: boolean;
  book_count: number;
  audio_count: number;
  total_size: number;
  last_scan_at: string | null;
  last_scan_error: string | null;
  exists: boolean;
  user_count: number;
};

export type ScanStatus = {
  running: boolean;
  library: string | null;
  done: number;
  total: number;
  current: string;
  started_at: string | null;
  finished_at: string | null;
  added: number;
  updated: number;
  removed: number;
  started?: boolean;
};

export type FsListing = {
  root: string;
  root_exists: boolean;
  path: string;
  abs_path?: string;
  parent: string | null;
  dirs: string[];
  book_files: number;
};

export type UploadTarget = { id: number; name: string; scope: "personal" | "shared"; new?: boolean };

export type BookQuery = {
  q?: string;
  kind?: BookKind | "";
  format?: string;
  status?: ReadStatus | "";
  library?: number;
  shelf?: number;
  author?: string;
  series?: string;
  sort?: string;
  offset?: number;
  limit?: number;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let accessToken: string | null = null;
let refreshPromise: Promise<TokenResponse | null> | null = null;
const listeners = new Set<(user: User | null) => void>();

export function onAuthChange(fn: (user: User | null) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const USER_KEY = "sr-user";

/** Последний вошедший пользователь — чтобы без связи открыть приложение со скачанными книгами */
function rememberUser(user: User | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* приватный режим */
  }
}

export function cachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function setSession(data: TokenResponse | null) {
  accessToken = data?.access_token ?? null;
  rememberUser(data?.user ?? null);
  listeners.forEach((fn) => fn(data?.user ?? null));
}

export function updateCurrentUser(user: User) {
  rememberUser(user);
  listeners.forEach((fn) => fn(user));
}

export function getAccessToken() {
  return accessToken;
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0] as { msg?: string; loc?: unknown[] };
      const field = first.loc?.[first.loc.length - 1];
      return field ? `${String(field)}: ${first.msg}` : (first.msg ?? fallback);
    }
  }
  return fallback;
}

async function raw<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: "include" });
  } catch {
    setOffline(true);
    throw new ApiError(0, "Нет связи с сервером");
  }
  // 502–504 отдаёт обратный прокси, когда сам сервер недоступен
  if (res.status >= 502 && res.status <= 504) {
    setOffline(true);
    throw new ApiError(res.status, "Сервер недоступен");
  }
  setOffline(false);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, `Ошибка ${res.status}`));
  return body as T;
}

whenBackOnline(() => {
  if (!accessToken && cachedUser()) void refreshSession();
});

export async function refreshSession(): Promise<TokenResponse | null> {
  if (!refreshPromise) {
    refreshPromise = raw<TokenResponse>("/api/auth/refresh", { method: "POST", body: "{}" })
      .then((data) => {
        setSession(data);
        return data;
      })
      .catch((err) => {
        // нет связи — не выходим из аккаунта
        if (err instanceof ApiError && (err.status === 0 || err.status >= 502)) {
          const user = cachedUser();
          if (user) {
            listeners.forEach((fn) => fn(user));
            return null;
          }
        }
        setSession(null);
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await raw<T>(path, init);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && !path.startsWith("/api/auth/")) {
      const refreshed = await refreshSession();
      if (refreshed) return raw<T>(path, init);
    }
    throw err;
  }
}

const json = (data: unknown) => JSON.stringify(data);

function qs(params: Record<string, unknown>) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  });
  const out = s.toString();
  return out ? `?${out}` : "";
}

function setupHeaders(token?: string): HeadersInit {
  return token ? { "X-Setup-Token": token } : {};
}


/** Загрузка файла с прогрессом (fetch не умеет прогресс отправки). */
export function uploadFile(
  libraryId: number,
  path: string,
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ path: string; size: number }> {
  const send = () =>
    new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const form = new FormData();
      form.append("library_id", String(libraryId));
      form.append("path", path);
      form.append("file", file, file.name);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/uploads");
      xhr.withCredentials = true;
      if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      xhr.upload.onprogress = (e) => onProgress(e.loaded, e.total);
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = null;
        }
        resolve({ status: xhr.status, body });
      };
      xhr.onerror = () => reject(new ApiError(0, "Нет связи с сервером"));
      xhr.onabort = () => reject(new ApiError(0, "Отменено"));
      signal?.addEventListener("abort", () => xhr.abort());
      xhr.send(form);
    });
  return send().then(async ({ status, body }) => {
    if (status === 401 && (await refreshSession())) {
      const retry = await send();
      status = retry.status;
      body = retry.body;
    }
    if (status === 413 && !body) throw new ApiError(413, "Файл слишком большой для прокси-сервера");
    if (status < 200 || status >= 300) throw new ApiError(status, errorMessage(body, `Ошибка ${status}`));
    return body as { path: string; size: number };
  });
}

/** Обложка нужного размера (сервер отдаёт одну, размер — подсказка для будущего кэша) */
export const coverUrl = (url: string | null | undefined) => url ?? null;
export const fileUrl = (id: number, fmt?: string, download = false) => `/api/books/${id}/file${qs({ fmt, download: download || undefined })}`;
export const audioUrl = (id: number, index: number, download = false) => `/api/books/${id}/audio/${index}${qs({ download: download || undefined })}`;

export const api = {
  health: () => request<{ status: string; version: string }>("/api/health"),

  setup: {
    status: () => request<SetupStatus>("/api/setup/status"),
    testDb: (cfg: DatabaseConfig, token?: string) =>
      request<{ ok: true }>("/api/setup/test-db", { method: "POST", body: json(cfg), headers: setupHeaders(token) }),
    database: (cfg: DatabaseConfig, token?: string) =>
      request<{ ok: true }>("/api/setup/database", { method: "POST", body: json(cfg), headers: setupHeaders(token) }),
    admin: (
      data: { username: string; email: string; display_name: string; password: string; site_name: string; registration_mode: RegistrationMode },
      token?: string,
    ) => request<TokenResponse>("/api/setup/admin", { method: "POST", body: json(data), headers: setupHeaders(token) }),
  },

  auth: {
    login: (login: string, password: string, remember = true) =>
      request<TokenResponse>("/api/auth/login", { method: "POST", body: json({ login, password, remember }) }),
    register: (data: { username: string; email: string; display_name: string; password: string }) =>
      request<TokenResponse>("/api/auth/register", { method: "POST", body: json(data) }),
    logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
    logoutAll: () => request<{ ok: true }>("/api/auth/logout-all", { method: "POST" }),
  },

  settings: {
    get: () => request<PublicSettings>("/api/settings"),
  },

  me: {
    update: (
      data: Partial<
        Pick<User, "display_name" | "email" | "username" | "palette" | "palette_auto" | "palette_day" | "palette_night" | "library_scope" | "reader_prefs">
      >,
    ) => request<User>("/api/me", { method: "PATCH", body: json(data) }),
    changePassword: (current_password: string, new_password: string) =>
      request<TokenResponse>("/api/me/password", { method: "POST", body: json({ current_password, new_password }) }),
    uploadAvatar: (image: Blob) => {
      const form = new FormData();
      form.append("file", image, "avatar.jpg");
      return request<User>("/api/me/avatar", { method: "POST", body: form });
    },
    deleteAvatar: () => request<User>("/api/me/avatar", { method: "DELETE" }),
  },

  home: () => request<Home>("/api/home"),
  libraries: () => request<MyLibrary[]>("/api/libraries"),

  books: {
    list: (p: BookQuery = {}) => request<BookList>(`/api/books${qs(p)}`),
    facets: () => request<Facets>("/api/books/facets"),
    get: (id: number) => request<BookDetail>(`/api/books/${id}`),
    remove: (id: number) => request<{ ok: true }>(`/api/books/${id}`, { method: "DELETE" }),
    setState: (id: number, data: Partial<Pick<ReadState, "status" | "progress" | "position" | "chapter" | "rating">>) =>
      request<ReadState>(`/api/books/${id}/state`, { method: "PUT", body: json(data) }),
  },

  uploads: {
    targets: () => request<UploadTarget[]>("/api/uploads/targets"),
    personal: () => request<UploadTarget>("/api/uploads/personal", { method: "POST" }),
    done: (library_id: number, shelf_id?: number | null, paths: string[] = []) =>
      request<{ ok: true }>("/api/uploads/done", { method: "POST", body: json({ library_id, shelf_id: shelf_id ?? null, paths }) }),
    status: () => request<{ running: boolean; done: number; total: number }>("/api/uploads/status"),
  },

  shelves: {
    list: () => request<Shelf[]>("/api/shelves"),
    get: (id: number) => request<Shelf>(`/api/shelves/${id}`),
    create: (data: { name: string; description?: string; is_shared?: boolean; book_ids?: number[] }) =>
      request<Shelf>("/api/shelves", { method: "POST", body: json(data) }),
    update: (id: number, data: Partial<Pick<Shelf, "name" | "description" | "is_shared">>) =>
      request<Shelf>(`/api/shelves/${id}`, { method: "PATCH", body: json(data) }),
    remove: (id: number) => request<{ ok: true }>(`/api/shelves/${id}`, { method: "DELETE" }),
    addBooks: (id: number, book_ids: number[]) =>
      request<{ added: number }>(`/api/shelves/${id}/books`, { method: "POST", body: json({ book_ids }) }),
    removeBook: (id: number, bookId: number) => request<{ ok: true }>(`/api/shelves/${id}/books/${bookId}`, { method: "DELETE" }),
  },

  admin: {
    settings: () => request<AdminSettings>("/api/admin/settings"),
    updateSettings: (data: Partial<AdminSettings>) =>
      request<AdminSettings>("/api/admin/settings", { method: "PATCH", body: json(data) }),
    users: () => request<AdminUser[]>("/api/admin/users"),
    createUser: (data: { username: string; email: string; display_name: string; password: string; is_admin: boolean }) =>
      request<AdminUser>("/api/admin/users", { method: "POST", body: json(data) }),
    uploadUserAvatar: (id: number, image: Blob) => {
      const form = new FormData();
      form.append("file", image, "avatar.jpg");
      return request<AdminUser>(`/api/admin/users/${id}/avatar`, { method: "POST", body: form });
    },
    deleteUserAvatar: (id: number) => request<AdminUser>(`/api/admin/users/${id}/avatar`, { method: "DELETE" }),
    updateUser: (id: number, data: Partial<Pick<User, "is_admin" | "is_active" | "username" | "display_name" | "email">>) =>
      request<AdminUser>(`/api/admin/users/${id}`, { method: "PATCH", body: json(data) }),
    setAccess: (id: number, access: { library_id: number; can_write: boolean }[]) =>
      request<AdminUser>(`/api/admin/users/${id}/access`, { method: "PUT", body: json({ access }) }),
    resetPassword: (id: number, password: string) =>
      request<{ ok: true }>(`/api/admin/users/${id}/password`, { method: "POST", body: json({ password }) }),
    deleteUser: (id: number) => request<{ ok: true }>(`/api/admin/users/${id}`, { method: "DELETE" }),
    libraries: () => request<AdminLibrary[]>("/api/admin/libraries"),
    createLibrary: (data: { name: string; path: string; scope: "shared" | "personal"; owner_id?: number | null; default_access: boolean }) =>
      request<AdminLibrary>("/api/admin/libraries", { method: "POST", body: json(data) }),
    updateLibrary: (id: number, data: Partial<Pick<AdminLibrary, "name" | "path" | "enabled" | "default_access">>) =>
      request<AdminLibrary>(`/api/admin/libraries/${id}`, { method: "PATCH", body: json(data) }),
    deleteLibrary: (id: number) => request<{ ok: true }>(`/api/admin/libraries/${id}`, { method: "DELETE" }),
    browse: (path = "") => request<FsListing>(`/api/admin/fs${qs({ path })}`),
    scanStatus: () => request<ScanStatus>("/api/admin/scan"),
    scan: (library_id?: number, full = false) =>
      request<ScanStatus>("/api/admin/scan", { method: "POST", body: json({ library_id: library_id ?? null, full }) }),
  },
};
