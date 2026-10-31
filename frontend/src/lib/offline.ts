/**
 * Книги на устройстве: скачать электронную книгу или аудиокнигу, чтобы читать и слушать без связи.
 *
 * Файлы лежат в Cache Storage браузера (кэш OFFLINE) под теми же адресами, по которым их
 * запрашивают читалка и плеер, — service worker (public/sw.js) отдаёт их оттуда, в том числе
 * кусками (Range) для перемотки аудио. Список скачанного — в localStorage.
 */
import { useSyncExternalStore } from "react";
import { audioUrl, fileUrl, getAccessToken, viewUrl, type BookDetail } from "./api";
import { CONVERT, djvuPageWidth, pickFormat } from "./bookSources";

export const OFFLINE_CACHE = "offline-books-v1";
const KEY = "sr-downloads";

export type Download = {
  id: number;
  title: string;
  authors: string[];
  kind: BookDetail["kind"];
  format: string;
  cover: string | null;
  bytes: number;
  savedAt: string;
  urls: string[];
};

type Progress = { done: number; total: number; error?: string };

let downloads: Record<number, Download> = load();
const progress = new Map<number, Progress>();
const controllers = new Map<number, AbortController>();
const listeners = new Set<() => void>();
let snapshot = { downloads, progress: new Map(progress) };

function load(): Record<number, Download> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<number, Download>;
  } catch {
    return {};
  }
}

function emit() {
  snapshot = { downloads, progress: new Map(progress) };
  listeners.forEach((l) => l());
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(downloads));
  } catch {
    /* нет места в localStorage — список останется в памяти */
  }
  emit();
}

export function useDownloads() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => snapshot,
  );
}

export const isDownloaded = (id: number) => Boolean(downloads[id]);
export const offlineSupported = () => typeof window !== "undefined" && "caches" in window && "serviceWorker" in navigator;

// движок читалки — чтобы открыть книгу без связи, даже если читалку на этом устройстве ещё не открывали
const READER_FILES = [
  "view.js",
  "epub.js",
  "epubcfi.js",
  "fb2.js",
  "mobi.js",
  "comic-book.js",
  "fixed-layout.js",
  "paginator.js",
  "overlayer.js",
  "progress.js",
  "search.js",
  "text-walker.js",
  "footnotes.js",
  "tts.js",
  "vendor/zip.js",
  "vendor/fflate.js",
].map((f) => `/foliate/${f}`);
const PDF_FILES = ["vendor/pdfjs/pdf.mjs", "vendor/pdfjs/pdf.worker.mjs", "vendor/pdfjs/text_layer_builder.css", "vendor/pdfjs/annotation_layer_builder.css"].map(
  (f) => `/foliate/${f}`,
);

/** Что скачать для книги: файлы + карточка книги и закладки (для страниц без связи). */
function plan(book: BookDetail): { urls: string[]; reader: string[] } {
  const urls = [`/api/books/${book.id}`, `/api/books/${book.id}/annotations`];
  if (book.cover) urls.push(book.cover);
  const reader: string[] = [];
  if (book.kind === "audio") {
    book.files.forEach((_, i) => urls.push(audioUrl(book.id, i)));
  } else {
    const fmt = pickFormat(book);
    if (!fmt) throw new Error("Этот формат читалка не открывает");
    if (fmt === "djvu") {
      const w = djvuPageWidth();
      for (let p = 1; p <= Math.max(1, book.pages ?? 1); p++) urls.push(`/api/books/${book.id}/page/${p}?w=${w}`);
    } else if (CONVERT[fmt]) urls.push(viewUrl(book.id, fmt));
    else urls.push(fileUrl(book.id, fmt));
    reader.push(...READER_FILES, ...(fmt === "pdf" ? PDF_FILES : []));
  }
  return { urls, reader };
}

async function fetchToCache(cache: Cache, url: string, signal: AbortSignal, onBytes: (n: number) => void): Promise<number> {
  const headers = new Headers();
  const token = getAccessToken();
  if (token && url.startsWith("/api/") && !/\/(file|view|audio|page|cover)/.test(url)) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { credentials: "include", headers, signal, cache: "no-store" });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.clone().json()).detail;
    } catch {
      /* не JSON */
    }
    throw new Error(detail || `Ошибка ${res.status}`);
  }
  // поток идёт прямо в кэш (без копии в памяти — аудиокниги бывают по гигабайту), по пути считаем байты
  let size = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      size += chunk.length;
      onBytes(chunk.length);
      ctl.enqueue(chunk);
    },
  });
  const keep = new Headers({ "Content-Type": res.headers.get("content-type") || "application/octet-stream" });
  const fmt = res.headers.get("x-book-format");
  if (fmt) keep.set("X-Book-Format", fmt);
  const body = res.body ? res.body.pipeThrough(counter) : await res.blob();
  await cache.put(url, new Response(body, { status: 200, headers: keep }));
  return size;
}

/** Скачать книгу на устройство. */
export async function downloadBook(book: BookDetail) {
  if (!offlineSupported()) throw new Error("Этот браузер не умеет хранить книги офлайн");
  if (controllers.has(book.id)) return;
  const { urls, reader } = plan(book);
  const ctrl = new AbortController();
  controllers.set(book.id, ctrl);
  // размер заранее известен для файлов книги; страницы DjVu и сконвертированные — примерно
  const total = Math.max(1, book.size || 1);
  let done = 0;
  progress.set(book.id, { done: 0, total });
  emit();
  try {
    // попросить браузер не удалять скачанное при нехватке места
    void navigator.storage?.persist?.().catch(() => false);
    const cache = await caches.open(OFFLINE_CACHE);
    let bytes = 0;
    for (const url of urls) {
      bytes += await fetchToCache(cache, url, ctrl.signal, (n) => {
        done += n;
        progress.set(book.id, { done, total: Math.max(total, done) });
        emit();
      });
    }
    // движок читалки — в его обычный кэш (тот же, что использует service worker)
    if (reader.length) {
      const rc = await caches.open("reader-v1");
      await Promise.all(
        reader.map(async (u) => {
          if (await rc.match(u)) return;
          const res = await fetch(u, { signal: ctrl.signal });
          if (res.ok) await rc.put(u, res);
        }),
      );
    }
    downloads = {
      ...downloads,
      [book.id]: {
        id: book.id,
        title: book.title,
        authors: book.authors,
        kind: book.kind,
        format: book.format,
        cover: book.cover,
        bytes,
        savedAt: new Date().toISOString(),
        urls,
      },
    };
    progress.delete(book.id);
    save();
  } catch (err) {
    const aborted = ctrl.signal.aborted;
    // недокачанное убираем
    try {
      const cache = await caches.open(OFFLINE_CACHE);
      await Promise.all(urls.map((u) => cache.delete(u)));
    } catch {
      /* ничего */
    }
    if (aborted) progress.delete(book.id);
    else progress.set(book.id, { done, total, error: (err as Error).message });
    emit();
    if (!aborted) throw err;
  } finally {
    controllers.delete(book.id);
  }
}

export function cancelDownload(id: number) {
  controllers.get(id)?.abort();
}

export async function removeDownload(id: number) {
  const d = downloads[id];
  if (!d) return;
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    await Promise.all(d.urls.map((u) => cache.delete(u)));
  } catch {
    /* кэш уже очищен браузером */
  }
  const next = { ...downloads };
  delete next[id];
  downloads = next;
  save();
}

/** Сколько занято и сколько можно (оценка браузера) */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}

/** Проверить, что скачанное на месте (браузер мог очистить кэш) — пропавшее убрать из списка. */
export async function verifyDownloads() {
  if (!offlineSupported()) return;
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    let changed = false;
    const next = { ...downloads };
    for (const d of Object.values(downloads)) {
      const main = d.urls.find((u) => /\/(file|view|audio|page)/.test(u));
      if (main && !(await cache.match(main))) {
        delete next[d.id];
        changed = true;
      }
    }
    if (changed) {
      downloads = next;
      save();
    }
  } catch {
    /* ничего */
  }
}
