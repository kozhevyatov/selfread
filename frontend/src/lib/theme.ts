/**
 * Палитры интерфейса: «Бумага», «Чернила» (светлые) и «Библиотека» (тёмная).
 * Выбор хранится в профиле на сервере и дублируется в localStorage — чтобы при загрузке
 * страница сразу открылась в нужных цветах, без «вспышки» (см. скрипт в index.html).
 * Автопереключение: днём одна палитра, ночью другая — по системной теме устройства.
 */
import { useSyncExternalStore } from "react";
import type { Palette, User } from "./api";

export type PaletteInfo = {
  id: Palette;
  name: string;
  mode: "светлая" | "тёмная";
  dark: boolean;
  description: string;
  /** цвета для мини-превью в настройках */
  preview: { bg: string; side: string; line: string; text: string; accent: string; covers: [string, string, string] };
  themeColor: string;
};

export const PALETTES: PaletteInfo[] = [
  {
    id: "paper",
    name: "Бумага",
    mode: "светлая",
    dark: false,
    description: "Тёплый молочный фон, бордовый акцент",
    preview: { bg: "#F6F1E7", side: "#FBF8F1", line: "#E2D8C6", text: "#2B2724", accent: "#8C2F39", covers: ["#7A2E35", "#C9A96E", "#34425C"] },
    themeColor: "#F6F1E7",
  },
  {
    id: "ink",
    name: "Чернила",
    mode: "светлая",
    dark: false,
    description: "Серо-голубой фон, чернильно-синий акцент",
    preview: { bg: "#EEF1F5", side: "#F7F8FB", line: "#D7DDE6", text: "#1C2340", accent: "#2E4BA8", covers: ["#1C2340", "#C2603F", "#4F7A8C"] },
    themeColor: "#EEF1F5",
  },
  {
    id: "library",
    name: "Библиотека",
    mode: "тёмная",
    dark: true,
    description: "Тёмно-зелёный фон, латунный акцент",
    preview: { bg: "#14231D", side: "#101C17", line: "#2C4438", text: "#EDE6D3", accent: "#C9A45C", covers: ["#6E2B2B", "#C9A45C", "#2D5A6B"] },
    themeColor: "#14231D",
  },
];

export const paletteInfo = (id: Palette) => PALETTES.find((p) => p.id === id) ?? PALETTES[0];

type ThemePrefs = { palette: Palette; auto: boolean; day: Palette; night: Palette };

const KEY = "sr-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function load(): ThemePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && raw.palette) return raw as ThemePrefs;
  } catch {
    /* приватный режим */
  }
  return { palette: "paper", auto: false, day: "paper", night: "library" };
}

let prefs = load();
let active: Palette = resolve(prefs);
const listeners = new Set<() => void>();

function resolve(p: ThemePrefs): Palette {
  return p.auto ? (media.matches ? p.night : p.day) : p.palette;
}

function apply() {
  active = resolve(prefs);
  const info = paletteInfo(active);
  const root = document.documentElement;
  root.dataset.palette = active;
  root.classList.toggle("dark", info.dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", info.themeColor);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", info.dark ? "only dark" : "only light");
  listeners.forEach((l) => l());
}

media.addEventListener("change", () => prefs.auto && apply());
apply();

function save(next: ThemePrefs) {
  prefs = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* приватный режим */
  }
  apply();
}

/** Подхватить оформление из профиля (после входа и при обновлении пользователя). */
export function syncThemeFromUser(user: User | null) {
  if (!user) return;
  const next: ThemePrefs = { palette: user.palette, auto: user.palette_auto, day: user.palette_day, night: user.palette_night };
  if (JSON.stringify(next) !== JSON.stringify(prefs)) save(next);
}

/** Временный предпросмотр (без сохранения) — например, при наведении в настройках. */
export function setThemePrefs(next: Partial<ThemePrefs>) {
  save({ ...prefs, ...next });
}

export function useTheme() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => active,
  );
}

export function isDark() {
  return document.documentElement.classList.contains("dark");
}
