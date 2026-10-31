/** Есть ли связь с сервером. Без неё приложение работает со скачанными книгами. */
import { useSyncExternalStore } from "react";

let offline = false;
let retryTimer = 0;
const listeners = new Set<() => void>();
const onBackOnline = new Set<() => void>();
const backOnline = () => onBackOnline.forEach((fn) => fn());

export function isOffline() {
  return offline;
}

export function setOffline(value: boolean) {
  if (offline === value) return;
  offline = value;
  listeners.forEach((l) => l());
  // связь вернулась — отправить накопленное, обновить сессию
  if (!value) window.setTimeout(backOnline, 0);
  window.clearInterval(retryTimer);
  if (value) {
    // пока нет связи — раз в 15 секунд проверяем, не вернулась ли
    retryTimer = window.setInterval(async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (res.ok) {
          setOffline(false);
        }
      } catch {
        /* всё ещё нет */
      }
    }, 15000);
  }
}

/** Что сделать, когда связь вернулась (обновить сессию, отправить накопленное) */
export function whenBackOnline(fn: () => void) {
  onBackOnline.add(fn);
  return () => {
    onBackOnline.delete(fn);
  };
}

export function useOffline() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => offline,
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => setOffline(true));
  window.addEventListener("online", () => {
    // браузер говорит «сеть есть» — проверим, доступен ли именно наш сервер
    fetch("/api/health", { cache: "no-store" })
      .then((r) => {
        if (r.ok) {
          setOffline(false);
        }
      })
      .catch(() => {});
  });
}
