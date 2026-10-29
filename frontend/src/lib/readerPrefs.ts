/**
 * Настройки читалки: тема страницы, шрифт, размер, интервал, поля, выравнивание, режим листания.
 * Хранятся в профиле (user.reader_prefs, JSON) — одинаковые на всех устройствах — и в localStorage,
 * чтобы книга сразу открывалась в нужном виде, даже без связи.
 */
import { useSyncExternalStore } from "react";
import { api, updateCurrentUser, type User } from "./api";

export type PageTheme = "day" | "sepia" | "gray" | "night" | "forest";
export type Flow = "paginated" | "scrolled";

export type ReaderPrefs = {
  theme: PageTheme;
  font: string;
  size: number; // px
  lineHeight: number;
  margin: number; // поля, % ширины колонки
  maxWidth: number; // px, ширина колонки текста
  justify: boolean;
  hyphenate: boolean;
  flow: Flow;
  columns: 1 | 2;
  publisherStyles: boolean; // оставить шрифты и цвета книги
};

export const DEFAULT_PREFS: ReaderPrefs = {
  theme: "day",
  font: "Literata",
  size: 19,
  lineHeight: 1.55,
  margin: 6,
  maxWidth: 720,
  justify: true,
  hyphenate: true,
  flow: "paginated",
  columns: 2,
  publisherStyles: false,
};

export const PAGE_THEMES: { id: PageTheme; label: string; bg: string; fg: string; link: string; dark: boolean }[] = [
  { id: "day", label: "День", bg: "#FFFDF8", fg: "#26221F", link: "#8C2F39", dark: false },
  { id: "sepia", label: "Сепия", bg: "#F3E7CF", fg: "#3B2F22", link: "#8A4B12", dark: false },
  { id: "gray", label: "Серый", bg: "#E4E6EA", fg: "#1F2430", link: "#2E4BA8", dark: false },
  { id: "night", label: "Ночь", bg: "#121212", fg: "#C9C4BA", link: "#D9A86C", dark: true },
  { id: "forest", label: "Лес", bg: "#14231D", fg: "#D9D1BC", link: "#C9A45C", dark: true },
];

export const FONTS: { id: string; label: string; stack: string }[] = [
  { id: "Literata", label: "Literata", stack: "Literata, Georgia, serif" },
  { id: "PT Serif", label: "PT Serif", stack: "'PT Serif', Georgia, serif" },
  { id: "Cormorant Garamond", label: "Cormorant", stack: "'Cormorant Garamond', Georgia, serif" },
  { id: "Georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { id: "Manrope", label: "Manrope", stack: "Manrope, system-ui, sans-serif" },
  { id: "Onest", label: "Onest", stack: "Onest, system-ui, sans-serif" },
  { id: "Golos Text", label: "Golos", stack: "'Golos Text', system-ui, sans-serif" },
];

/** Подключение шрифтов внутри страницы книги (у iframe своя таблица стилей). */
export const FONTS_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400..700;1,7..72,400..700&family=PT+Serif:ital,wght@0,400;0,700;1,400&family=Cormorant+Garamond:ital,wght@0,500..700;1,500&family=Manrope:wght@400..700&family=Onest:wght@400..700&family=Golos+Text:wght@400..700&display=swap";

const KEY = "sr-reader";

function load(): ReaderPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && typeof raw === "object") return { ...DEFAULT_PREFS, ...raw };
  } catch {
    /* приватный режим */
  }
  return DEFAULT_PREFS;
}

let prefs = load();
const listeners = new Set<() => void>();
let saveTimer = 0;

function emit() {
  listeners.forEach((l) => l());
}

/** Взять настройки из профиля (вызывается при входе). */
export function syncReaderPrefsFromUser(user: User | null) {
  if (!user?.reader_prefs) return;
  try {
    const remote = JSON.parse(user.reader_prefs);
    if (remote && typeof remote === "object" && Object.keys(remote).length) {
      const next = { ...DEFAULT_PREFS, ...remote };
      if (JSON.stringify(next) !== JSON.stringify(prefs)) {
        prefs = next;
        try {
          localStorage.setItem(KEY, JSON.stringify(prefs));
        } catch {
          /* приватный режим */
        }
        emit();
      }
    }
  } catch {
    /* битый JSON — оставляем локальные */
  }
}

export function setReaderPrefs(patch: Partial<ReaderPrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* приватный режим */
  }
  emit();
  // на сервер — не чаще раза в секунду (ползунок размера шрифта дёргает часто)
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    api.me
      .update({ reader_prefs: JSON.stringify(prefs) })
      .then((u) => updateCurrentUser(u))
      .catch(() => {});
  }, 1000);
}

export function getReaderPrefs() {
  return prefs;
}

export function useReaderPrefs() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => prefs,
  );
}

export function pageTheme(id: PageTheme) {
  return PAGE_THEMES.find((t) => t.id === id) ?? PAGE_THEMES[0];
}

export function fontStack(id: string) {
  return FONTS.find((f) => f.id === id)?.stack ?? FONTS[0].stack;
}

/** CSS, который читалка вставляет в каждую страницу книги. */
export function bookCSS(p: ReaderPrefs) {
  const t = pageTheme(p.theme);
  const font = fontStack(p.font);
  const keep = p.publisherStyles;
  return `
@import url("${FONTS_CSS_URL}");
@namespace epub "http://www.idpf.org/2007/ops";
html {
  color-scheme: ${t.dark ? "dark" : "light"};
  background: ${t.bg} !important;
  color: ${t.fg} !important;
}
body {
  background: transparent !important;
  color: ${t.fg} !important;
  ${keep ? "" : `font-family: ${font} !important;`}
  font-size: ${p.size}px !important;
}
${
  keep
    ? ""
    : `body *:not(code):not(pre):not(kbd):not(samp) { font-family: inherit !important; }
p, li, blockquote, dd, div { color: inherit !important; }`
}
p, li, blockquote, dd {
  line-height: ${p.lineHeight} !important;
  text-align: ${p.justify ? "justify" : "start"};
  -webkit-hyphens: ${p.hyphenate ? "auto" : "manual"};
  hyphens: ${p.hyphenate ? "auto" : "manual"};
  hanging-punctuation: allow-end last;
  widows: 2;
  orphans: 2;
}
[align="left"] { text-align: left; }
[align="right"] { text-align: right; }
[align="center"] { text-align: center; }
a:link, a:visited { color: ${t.link} !important; }
img, svg, video { max-width: 100%; height: auto; }
${t.dark ? "img { opacity: 0.9; }" : ""}
pre { white-space: pre-wrap !important; }
aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
::selection { background: ${t.link}55; }
`;
}
