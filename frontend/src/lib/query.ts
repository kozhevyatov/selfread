/**
 * Минимальный кэш запросов: useQuery с ключом, повторным использованием данных,
 * инвалидацией по префиксу и оптимистичным обновлением (setQueryData).
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

type Entry<T = unknown> = {
  data: T | undefined;
  error: Error | null;
  promise: Promise<T> | null;
  updatedAt: number;
  stale: boolean;
  fetcher: (() => Promise<T>) | null;
  listeners: Set<() => void>;
  snapshot: QueryState<T>;
};

export type QueryState<T> = {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
};

const cache = new Map<string, Entry>();

export function keyOf(key: readonly unknown[]) {
  return JSON.stringify(key);
}

function entry<T>(k: string): Entry<T> {
  let e = cache.get(k) as Entry<T> | undefined;
  if (!e) {
    e = {
      data: undefined,
      error: null,
      promise: null,
      updatedAt: 0,
      stale: true,
      fetcher: null,
      listeners: new Set(),
      snapshot: { data: undefined, error: null, isLoading: true, isFetching: false },
    };
    cache.set(k, e as Entry);
  }
  return e;
}

function publish(e: Entry) {
  e.snapshot = {
    data: e.data,
    error: e.error,
    isLoading: e.data === undefined && !e.error,
    isFetching: e.promise !== null,
  };
  e.listeners.forEach((l) => l());
}

function run<T>(e: Entry<T>): Promise<T> {
  if (e.promise) return e.promise;
  if (!e.fetcher) return Promise.reject(new Error("no fetcher"));
  const p = e
    .fetcher()
    .then((data) => {
      e.data = data;
      e.error = null;
      e.updatedAt = Date.now();
      e.stale = false;
      return data;
    })
    .catch((err: Error) => {
      e.error = err;
      throw err;
    })
    .finally(() => {
      e.promise = null;
      publish(e as Entry);
    });
  e.promise = p;
  publish(e as Entry);
  return p;
}

export function useQuery<T>(
  key: readonly unknown[],
  fetcher: () => Promise<T>,
  opts: { enabled?: boolean; staleTime?: number; refetchInterval?: number } = {},
) {
  const k = keyOf(key);
  const enabled = opts.enabled ?? true;
  const staleTime = opts.staleTime ?? 30_000;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const e = entry<T>(k);
  e.fetcher = () => fetcherRef.current();

  const subscribe = useCallback(
    (cb: () => void) => {
      const en = entry<T>(k);
      en.listeners.add(cb);
      return () => {
        en.listeners.delete(cb);
      };
    },
    [k],
  );
  const state = useSyncExternalStore(subscribe, () => entry<T>(k).snapshot as QueryState<T>);

  useEffect(() => {
    if (!enabled) return;
    const en = entry<T>(k);
    if (en.stale || Date.now() - en.updatedAt > staleTime) run(en).catch(() => {});
  }, [k, enabled, staleTime]);

  useEffect(() => {
    if (!enabled || !opts.refetchInterval) return;
    const id = window.setInterval(() => run(entry<T>(k)).catch(() => {}), opts.refetchInterval);
    return () => window.clearInterval(id);
  }, [k, enabled, opts.refetchInterval]);

  const refetch = useCallback(() => run(entry<T>(k)), [k]);
  return { ...state, isLoading: enabled ? state.isLoading : false, refetch };
}

/** Пометить устаревшими все запросы, ключ которых начинается с prefix; активные — перезапросить. */
export function invalidate(...prefixes: readonly unknown[][]) {
  for (const [k, e] of cache) {
    const key = JSON.parse(k) as unknown[];
    const hit = prefixes.some((p) => p.every((part, i) => JSON.stringify(key[i]) === JSON.stringify(part)));
    if (!hit) continue;
    e.stale = true;
    if (e.listeners.size && e.fetcher) run(e).catch(() => {});
  }
}

export function setQueryData<T>(key: readonly unknown[], updater: (old: T | undefined) => T | undefined) {
  const e = entry<T>(keyOf(key));
  e.data = updater(e.data);
  publish(e as Entry);
}

/** Обновить элемент во всех закэшированных ответах (например, отметку «в избранном»). */
export function patchEverywhere(fn: (data: unknown) => unknown) {
  for (const e of cache.values()) {
    if (e.data === undefined) continue;
    const next = fn(e.data);
    if (next !== e.data) {
      e.data = next;
      publish(e);
    }
  }
}

export function clearCache() {
  for (const e of cache.values()) {
    e.data = undefined;
    e.stale = true;
    publish(e);
  }
}
