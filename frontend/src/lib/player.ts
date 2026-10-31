/**
 * Плеер аудиокниг: один <audio> на всё приложение (играет при переходах между страницами),
 * скорость, перемотка, таймер сна, главы (файлы папки или главы внутри .m4b),
 * управление с экрана блокировки (Media Session) и сохранение места на сервере.
 *
 * Позиция хранится как «номер_файла:секунды» — с ней книга продолжается на любом устройстве.
 */
import { useSyncExternalStore } from "react";
import { api, audioUrl, type BookDetail } from "./api";
import { invalidate, setQueryData } from "./query";

export type Chapter = { title: string; index: number; start: number; end: number };

type PlayerBook = Pick<BookDetail, "id" | "title" | "authors" | "cover" | "files" | "chapters" | "duration" | "narrator">;

export type PlayerState = {
  book: PlayerBook | null;
  index: number; // номер файла
  time: number; // секунд от начала файла
  fileDuration: number;
  playing: boolean;
  loading: boolean;
  rate: number;
  sleepAt: number | null; // время срабатывания таймера (ms) или null
  sleepEndOfChapter: boolean;
  error: string | null;
};

const RATE_KEY = "sr-rate";

let state: PlayerState = {
  book: null,
  index: 0,
  time: 0,
  fileDuration: 0,
  playing: false,
  loading: false,
  rate: Number(localStorage.getItem(RATE_KEY)) || 1,
  sleepAt: null,
  sleepEndOfChapter: false,
  error: null,
};

const listeners = new Set<() => void>();
function set(patch: Partial<PlayerState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const audio = typeof window !== "undefined" ? new Audio() : (null as unknown as HTMLAudioElement);
if (audio) {
  audio.preload = "metadata";
  audio.addEventListener("timeupdate", () => {
    set({ time: audio.currentTime });
    checkSleep();
  });
  audio.addEventListener("loadedmetadata", () => set({ fileDuration: audio.duration || 0, loading: false }));
  audio.addEventListener("play", () => set({ playing: true }));
  audio.addEventListener("pause", () => {
    set({ playing: false });
    save();
  });
  audio.addEventListener("waiting", () => set({ loading: true }));
  audio.addEventListener("playing", () => set({ loading: false, error: null }));
  audio.addEventListener("ended", () => {
    if (state.book && state.index + 1 < state.book.files.length) loadFile(state.index + 1, 0, true);
    else {
      set({ playing: false });
      save(true);
    }
  });
  audio.addEventListener("error", () => set({ loading: false, playing: false, error: "Не удалось воспроизвести файл" }));
  // сохраняем место раз в 15 секунд, пока играет
  window.setInterval(() => state.playing && save(), 15000);
  window.addEventListener("pagehide", () => save());
}

// ---------------- главы и общий прогресс ----------------

function fileStarts(book: PlayerBook) {
  const starts: number[] = [];
  let acc = 0;
  for (const f of book.files) {
    starts.push(acc);
    acc += f.duration ?? 0;
  }
  return starts;
}

export function chaptersOf(book: PlayerBook): Chapter[] {
  if (book.files.length === 1 && book.chapters.length > 1) {
    const total = book.files[0].duration || book.duration;
    return book.chapters.map((c, i) => ({ title: c.title, index: 0, start: c.start, end: book.chapters[i + 1]?.start ?? total }));
  }
  return book.files.map((f, i) => ({ title: f.title || f.name, index: i, start: 0, end: f.duration ?? 0 }));
}

export function currentChapter(s: PlayerState = state): Chapter | null {
  if (!s.book) return null;
  const list = chaptersOf(s.book);
  if (s.book.files.length === 1) return [...list].reverse().find((c) => s.time >= c.start - 0.5) ?? list[0] ?? null;
  return list[s.index] ?? null;
}

export function overall(s: PlayerState = state) {
  if (!s.book) return { position: 0, total: 0, fraction: 0 };
  const starts = fileStarts(s.book);
  const total = s.book.duration || starts[starts.length - 1] + (s.book.files[s.book.files.length - 1]?.duration ?? 0);
  const position = (starts[s.index] ?? 0) + s.time;
  return { position, total, fraction: total ? Math.min(1, position / total) : 0 };
}

// ---------------- сохранение ----------------

let lastSaved = "";
function save(finished = false) {
  const b = state.book;
  if (!b) return;
  const { fraction } = overall();
  const position = `${state.index}:${state.time.toFixed(1)}`;
  if (position === lastSaved && !finished) return;
  lastSaved = position;
  api.books
    .setState(b.id, {
      progress: finished ? 1 : Math.round(fraction * 1000) / 1000,
      position,
      chapter: currentChapter()?.title?.slice(0, 500) ?? "",
      ...(finished ? { status: "finished" as const } : {}),
    })
    .then((st) => {
      setQueryData(["book", b.id], (d: BookDetail | undefined) => (d ? { ...d, state: st } : d));
      invalidate(["home"]);
    })
    .catch(() => {});
}

// ---------------- управление ----------------

function loadFile(index: number, time: number, autoplay: boolean) {
  const b = state.book;
  if (!b) return;
  set({ index, time, fileDuration: b.files[index]?.duration ?? 0, loading: true, error: null });
  audio.src = audioUrl(b.id, index);
  audio.playbackRate = state.rate;
  const seek = () => {
    if (time > 0) audio.currentTime = time;
    audio.removeEventListener("loadedmetadata", seek);
  };
  audio.addEventListener("loadedmetadata", seek);
  if (autoplay) void audio.play().catch(() => set({ playing: false, loading: false }));
  updateMediaSession();
}

function parsePosition(pos: string): [number, number] | null {
  const m = /^(\d+):([\d.]+)$/.exec(pos || "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export const player = {
  /** id книги, которая сейчас в плеере */
  bookId: () => state.book?.id ?? null,
  /** Начать книгу: с сохранённого места, с начала указанного файла или с секунды внутри файла. */
  open(book: BookDetail, opts: { index?: number; time?: number; autoplay?: boolean } = {}) {
    const same = state.book?.id === book.id;
    if (same && opts.index === undefined) {
      if (opts.autoplay !== false) void audio.play();
      return;
    }
    if (state.book && !same) save();
    set({ book, sleepAt: null, sleepEndOfChapter: false });
    let index = opts.index ?? 0;
    let time = opts.time ?? 0;
    if (opts.index === undefined) {
      const saved = book.state.status !== "finished" ? parsePosition(book.state.position) : null;
      if (saved && saved[0] < book.files.length) [index, time] = saved;
    }
    lastSaved = "";
    loadFile(index, time, opts.autoplay !== false);
  },
  toggle() {
    if (!state.book) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  },
  pause() {
    audio.pause();
  },
  seek(time: number) {
    if (!state.book) return;
    audio.currentTime = Math.max(0, Math.min(time, audio.duration || time));
    set({ time: audio.currentTime });
  },
  skip(delta: number) {
    if (!state.book) return;
    const t = audio.currentTime + delta;
    if (t < 0 && state.index > 0) {
      const prev = state.index - 1;
      loadFile(prev, Math.max(0, (state.book.files[prev]?.duration ?? 0) + t), !audio.paused);
    } else if (audio.duration && t > audio.duration && state.index + 1 < state.book.files.length) {
      loadFile(state.index + 1, t - audio.duration, !audio.paused);
    } else player.seek(t);
  },
  goChapter(ch: Chapter) {
    if (!state.book) return;
    if (ch.index !== state.index) loadFile(ch.index, ch.start, true);
    else {
      player.seek(ch.start);
      void audio.play().catch(() => {});
    }
  },
  nextChapter() {
    if (!state.book) return;
    const list = chaptersOf(state.book);
    const cur = currentChapter();
    const i = cur ? list.findIndex((c) => c.index === cur.index && c.start === cur.start) : -1;
    if (list[i + 1]) player.goChapter(list[i + 1]);
  },
  prevChapter() {
    if (!state.book) return;
    const list = chaptersOf(state.book);
    const cur = currentChapter();
    const i = cur ? list.findIndex((c) => c.index === cur.index && c.start === cur.start) : 0;
    // если глава играет дольше 5 секунд — в её начало, иначе в предыдущую
    const inside = cur ? (state.book.files.length === 1 ? state.time - cur.start : state.time) : 0;
    if (inside > 5 && cur) player.goChapter(cur);
    else if (list[i - 1]) player.goChapter(list[i - 1]);
  },
  setRate(rate: number) {
    audio.playbackRate = rate;
    try {
      localStorage.setItem(RATE_KEY, String(rate));
    } catch {
      /* приватный режим */
    }
    set({ rate });
  },
  /** Таймер сна: минуты, «до конца главы» или выключить. */
  setSleep(minutes: number | "chapter" | null) {
    if (minutes === null) set({ sleepAt: null, sleepEndOfChapter: false });
    else if (minutes === "chapter") set({ sleepAt: null, sleepEndOfChapter: true });
    else set({ sleepAt: Date.now() + minutes * 60_000, sleepEndOfChapter: false });
  },
  close() {
    save();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    set({ book: null, playing: false, time: 0, sleepAt: null, sleepEndOfChapter: false });
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
  },
};

let fading = false;
function checkSleep() {
  if (fading) return;
  const stop = () => {
    // мягко убираем громкость за 6 секунд и ставим на паузу
    fading = true;
    const start = audio.volume;
    let step = 0;
    const id = window.setInterval(() => {
      step++;
      audio.volume = Math.max(0, start * (1 - step / 12));
      if (step >= 12) {
        window.clearInterval(id);
        audio.pause();
        audio.volume = start;
        fading = false;
        set({ sleepAt: null, sleepEndOfChapter: false });
      }
    }, 500);
  };
  if (state.sleepAt && Date.now() >= state.sleepAt) stop();
  else if (state.sleepEndOfChapter) {
    const ch = currentChapter();
    if (ch && ch.end > 0 && state.time >= ch.end - 1.5) stop();
  }
}

// ---------------- экран блокировки ----------------

function updateMediaSession() {
  if (!("mediaSession" in navigator) || !state.book) return;
  const b = state.book;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentChapter()?.title || b.title,
      artist: b.authors.join(", "),
      album: b.title,
      artwork: b.cover ? [{ src: new URL(b.cover, window.location.href).href, sizes: "600x900", type: "image/webp" }] : [],
    });
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => void audio.play());
    ms.setActionHandler("pause", () => audio.pause());
    ms.setActionHandler("seekbackward", (d) => player.skip(-(d.seekOffset || 15)));
    ms.setActionHandler("seekforward", (d) => player.skip(d.seekOffset || 30));
    ms.setActionHandler("previoustrack", () => player.prevChapter());
    ms.setActionHandler("nexttrack", () => player.nextChapter());
    ms.setActionHandler("seekto", (d) => d.seekTime !== undefined && player.seek(d.seekTime));
  } catch {
    /* старые браузеры */
  }
}

export function usePlayer() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
  );
}
