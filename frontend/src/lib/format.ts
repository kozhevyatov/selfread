import { countLabel } from "./utils";

export function formatTime(seconds: number | null | undefined) {
  if (!seconds || !isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** «42 мин», «1 ч 12 мин», «3 дн 4 ч» */
export function formatDuration(seconds: number) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} ч${m % 60 ? ` ${m % 60} мин` : ""}`;
  const d = Math.floor(h / 24);
  return `${d} дн ${h % 24} ч`;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ["КБ", "МБ", "ГБ", "ТБ"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(".0", "")} ${units[i]}`;
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function booksLabel(n: number) {
  return countLabel(n, "книга", "книги", "книг");
}

export function pagesLabel(n: number) {
  return countLabel(n, "страница", "страницы", "страниц");
}

export function authorsText(authors: string[]) {
  return authors.length ? authors.join(", ") : "Автор не указан";
}

/** «Война и мир, кн. 2» */
export function seriesText(series: string, index: number | null) {
  if (!series) return "";
  if (index === null || index === undefined) return series;
  const n = Number.isInteger(index) ? String(index) : String(index).replace(".", ",");
  return `${series} · ${n}`;
}

export function percent(progress: number) {
  return `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}

export function todayLabel() {
  const s = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}
