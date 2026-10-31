/**
 * Отправка на сервер с очередью на случай, когда связи нет:
 * прогресс чтения, время чтения (статистика), новые закладки и цитаты.
 * Очередь живёт в localStorage и уходит, как только сервер снова доступен.
 */
import { useSyncExternalStore } from "react";
import { api, ApiError, localDay, type Annotation, type AnnotationInput, type BookKind, type ReadState } from "./api";
import { whenBackOnline } from "./network";

type StateData = Partial<Pick<ReadState, "status" | "progress" | "position" | "chapter" | "rating">>;

type Item =
  | { type: "state"; bookId: number; data: StateData }
  | { type: "track"; bookId: number; day: string; kind: BookKind; seconds: number }
  | { type: "annotation"; bookId: number; tempId: number; data: AnnotationInput; createdAt: string };

const KEY = "sr-outbox";
const listeners = new Set<() => void>();
let items: Item[] = load();
let flushing = false;

function load(): Item[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Item[]) : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    if (items.length) localStorage.setItem(KEY, JSON.stringify(items));
    else localStorage.removeItem(KEY);
  } catch {
    /* хранилище недоступно — останется в памяти */
  }
  listeners.forEach((l) => l());
}

/** Нет связи (или сервер недоступен) — тогда копим, а не теряем */
const isNetworkError = (err: unknown) => err instanceof ApiError && (err.status === 0 || err.status >= 502);

function queueState(bookId: number, data: StateData) {
  const old = items.find((i) => i.type === "state" && i.bookId === bookId) as Extract<Item, { type: "state" }> | undefined;
  if (old) old.data = { ...old.data, ...data };
  else items.push({ type: "state", bookId, data });
  save();
}

function queueTrack(bookId: number, day: string, kind: BookKind, seconds: number) {
  const old = items.find((i) => i.type === "track" && i.bookId === bookId && i.day === day) as Extract<Item, { type: "track" }> | undefined;
  if (old) old.seconds += seconds;
  else items.push({ type: "track", bookId, day, kind, seconds });
  save();
}

/** Прогресс/статус книги. Без связи — в очередь (вернёт null). */
export async function sendState(bookId: number, data: StateData): Promise<ReadState | null> {
  try {
    return await api.books.setState(bookId, data);
  } catch (err) {
    if (isNetworkError(err)) {
      queueState(bookId, data);
      return null;
    }
    throw err;
  }
}

/** Время чтения/прослушивания для статистики. */
export async function sendTrack(bookId: number, kind: BookKind, seconds: number, day = localDay()) {
  seconds = Math.round(seconds);
  if (seconds < 1) return;
  try {
    await api.stats.track({ book_id: bookId, day, seconds: Math.min(seconds, 3600), kind });
  } catch (err) {
    if (isNetworkError(err)) queueTrack(bookId, day, kind, seconds);
  }
}

let tempIds = -Date.now() % 1_000_000;

/** Новая закладка/цитата. Без связи — сохраняем локально и отправим позже. */
export async function createAnnotation(bookId: number, data: AnnotationInput): Promise<Annotation> {
  try {
    return await api.annotations.create(bookId, data);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const tempId = --tempIds;
    const createdAt = new Date().toISOString();
    items.push({ type: "annotation", bookId, tempId, data, createdAt });
    save();
    return { ...data, id: tempId, book_id: bookId, created_at: createdAt, updated_at: createdAt, pending: true };
  }
}

/** Закладки и цитаты книги, ещё не отправленные на сервер */
export function pendingAnnotations(bookId: number): Annotation[] {
  return items
    .filter((i): i is Extract<Item, { type: "annotation" }> => i.type === "annotation" && i.bookId === bookId)
    .map((i) => ({ ...i.data, id: i.tempId, book_id: bookId, created_at: i.createdAt, updated_at: i.createdAt, pending: true }));
}

export function dropPendingAnnotation(tempId: number) {
  items = items.filter((i) => !(i.type === "annotation" && i.tempId === tempId));
  save();
}

export function useOutboxSize() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => items.length,
  );
}

/** Отправить накопленное. Ошибка сети — остановиться и попробовать позже; другая ошибка — выбросить пункт. */
export async function flushOutbox() {
  if (flushing || !items.length) return;
  flushing = true;
  try {
    while (items.length) {
      const item = items[0];
      try {
        if (item.type === "state") await api.books.setState(item.bookId, item.data);
        else if (item.type === "track") {
          let left = item.seconds;
          while (left > 0) {
            const part = Math.min(left, 3600);
            await api.stats.track({ book_id: item.bookId, day: item.day, seconds: part, kind: item.kind });
            left -= part;
            item.seconds = left;
          }
        } else await api.annotations.create(item.bookId, item.data);
      } catch (err) {
        if (isNetworkError(err) || (err instanceof ApiError && err.status === 401)) break;
      }
      items = items.filter((i) => i !== item);
      save();
    }
  } finally {
    flushing = false;
  }
}

if (typeof window !== "undefined") {
  whenBackOnline(() => void flushOutbox());
  window.setInterval(() => void flushOutbox(), 60_000);
}
