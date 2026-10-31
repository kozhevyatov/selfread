/* Service worker SelfRead.
 * Нужен для установки на телефон (PWA) и быстрого запуска:
 * - оболочка (HTML) — сначала сеть, без сети — кэш;
 * - собранные файлы /assets/* и обложки книг — сначала кэш;
 * - движок читалки /foliate/* — сначала кэш (большой, меняется редко);
 * - книги, скачанные на устройство (кэш OFFLINE, кладёт их страница — src/lib/offline.ts):
 *   файлы, аудио (с поддержкой Range — перемотка), страницы DjVu отдаются из кэша;
 *   карточка книги и закладки — сначала сеть, без сети — сохранённая копия.
 * - остальное API не кэшируется.
 */
const VERSION = "v2";
const SHELL = `shell-${VERSION}`;
const STATIC = `static-${VERSION}`;
const COVERS = "covers-v1";
// движок читалки (foliate-js, pdf.js): при обновлении файлов в public/foliate поменять номер
const READER = "reader-v1";
// скачанные книги (не удаляются при обновлении приложения)
const OFFLINE = "offline-books-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.json", "/favicon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const keep = [SHELL, STATIC, COVERS, READER, OFFLINE];
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    if (max) trim(cache, max);
  }
  return response;
}

async function shell(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put("/", response.clone());
    return response;
  } catch {
    return (await cache.match("/")) || Response.error();
  }
}

/** Ответ на запрос части файла (Range) из сохранённого целиком — для перемотки аудио без сети */
async function sliced(cached, range) {
  const blob = await cached.blob();
  const size = blob.size;
  const m = /bytes=(\d*)-(\d*)/.exec(range || "");
  if (!m || (!m[1] && !m[2])) return cached;
  let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  let end = m[1] && m[2] ? Number(m[2]) : size - 1;
  end = Math.min(end, size - 1);
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

/** Файл скачанной книги — из кэша; не скачана — из сети */
async function offlineFirst(request) {
  const cache = await caches.open(OFFLINE);
  const hit = await cache.match(request.url, { ignoreVary: true });
  if (!hit) return fetch(request);
  const range = request.headers.get("range");
  return range ? sliced(hit, range) : hit;
}

/** Карточка и закладки скачанной книги: сначала сеть (и обновить копию), без сети — копия */
async function networkThenOffline(request) {
  const cache = await caches.open(OFFLINE);
  try {
    const response = await fetch(request);
    const hit = await cache.match(request.url);
    if (hit && response.status >= 502) return hit; // сервер недоступен — отдать копию
    if (hit && response.ok) cache.put(request.url, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(request.url);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(shell(request));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request, STATIC, 200));
    return;
  }
  if (url.pathname.startsWith("/foliate/")) {
    event.respondWith(cacheFirst(request, READER, 400));
    return;
  }
  if (/^\/api\/books\/\d+\/(file|view|audio\/\d+|page\/\d+)$/.test(url.pathname)) {
    event.respondWith(offlineFirst(request));
    return;
  }
  if (/^\/api\/books\/\d+(\/annotations)?$/.test(url.pathname)) {
    event.respondWith(networkThenOffline(request));
    return;
  }
  if (/^\/api\/books\/\d+\/cover$/.test(url.pathname)) {
    event.respondWith(
      caches
        .open(OFFLINE)
        .then((c) => c.match(request.url))
        .then((hit) => hit || cacheFirst(request, COVERS, 1500)),
    );
  }
});
