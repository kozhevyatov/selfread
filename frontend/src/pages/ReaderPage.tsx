/**
 * Читалка. Книгу рисует foliate-js (<foliate-view>), вокруг — наша панель:
 * оглавление, настройки (тема страницы, шрифт, размер, интервал, поля, колонки, листание),
 * прогресс с ползунком. Позиция сохраняется на сервере — продолжить можно с любого устройства.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  Maximize2 as Maximize,
  Menu as MenuIcon,
  Minimize2 as Minimize,
  Minus,
  Plus,
  Search,
  TriangleAlert,
  X,
} from "@/components/icons";
import { api, fileUrl, type BookDetail } from "@/lib/api";
import { loadBookSource, pickFormat } from "@/lib/bookSources";
import { invalidate, setQueryData, useQuery } from "@/lib/query";
import {
  bookCSS,
  FONTS,
  PAGE_THEMES,
  pageTheme,
  setReaderPrefs,
  useReaderPrefs,
  type ReaderPrefs,
} from "@/lib/readerPrefs";
import { navigate, useParams, useSearchParams } from "@/lib/router";
import { cn } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */
type FoliateView = HTMLElement & {
  book: any;
  renderer: any;
  open: (book: any) => Promise<void>;
  init: (opts: { lastLocation?: any; showTextStart?: boolean }) => Promise<void>;
  goTo: (target: any) => Promise<any>;
  goToFraction: (f: number) => Promise<void>;
  goLeft: () => void;
  goRight: () => void;
  prev: () => void;
  next: () => void;
  close?: () => void;
  getSectionFractions: () => number[];
  search: (opts: { query: string }) => AsyncGenerator<any>;
  clearSearch: () => void;
};

type TocItem = { label: string; href: string; subitems?: TocItem[] };
type Location = { fraction: number; chapter: string; cfi: string; current?: number; total?: number };

let foliateLoaded: Promise<unknown> | null = null;
function loadFoliate() {
  // движок лежит в public/foliate и грузится как есть, без сборки
  foliateLoaded ??= import(/* @vite-ignore */ `${window.location.origin}/foliate/view.js`);
  return foliateLoaded;
}

const FIXED = new Set(["pdf", "cbz", "djvu"]);

// ---------------- оглавление ----------------

function TocList({ items, current, onGo, depth = 0 }: { items: TocItem[]; current: string; onGo: (href: string) => void; depth?: number }) {
  return (
    <ul className="flex flex-col">
      {items.map((item, i) => (
        <li key={`${item.href}-${i}`}>
          <button
            type="button"
            onClick={() => onGo(item.href)}
            className={cn(
              "w-full rounded-lg px-3 py-2 text-left text-[15px] leading-snug transition hover:bg-black/5 dark:hover:bg-white/5",
              current === item.label && "font-semibold text-[var(--reader-link)]",
            )}
            style={{ paddingLeft: 12 + depth * 16 }}
          >
            {item.label || "—"}
          </button>
          {item.subitems?.length ? <TocList items={item.subitems} current={current} onGo={onGo} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

// ---------------- настройки ----------------

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-bold tracking-wide uppercase opacity-60">{label}</span>
      {children}
    </div>
  );
}

function Stepper({ value, min, max, step, format, onChange, label }: { value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; label: string }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label={`${label}: меньше`} onClick={() => onChange(clamp(value - step))} disabled={value <= min} className="reader-btn size-11">
        <Minus className="size-4" />
      </button>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="h-11 flex-1 accent-[var(--reader-link)]"
      />
      <button type="button" aria-label={`${label}: больше`} onClick={() => onChange(clamp(value + step))} disabled={value >= max} className="reader-btn size-11">
        <Plus className="size-4" />
      </button>
      <span className="num w-14 text-right text-sm font-semibold">{format(value)}</span>
    </div>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex min-h-11 items-center justify-between gap-3 text-left">
      <span className="text-[15px]">{children}</span>
      <span className={cn("flex h-7 w-12 shrink-0 items-center rounded-full p-[3px] transition", checked ? "bg-[var(--reader-link)]" : "bg-black/15 dark:bg-white/15")}>
        <span className={cn("block size-[22px] rounded-full bg-white shadow transition-transform", checked && "translate-x-5")} />
      </span>
    </button>
  );
}

function Choice<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-xl bg-black/5 p-1 dark:bg-white/8">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-9 flex-1 rounded-lg px-2 text-[13px] font-semibold transition", value === o.value ? "bg-[var(--reader-bg)] shadow" : "opacity-70 hover:opacity-100")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SettingsPanel({ prefs, fixed }: { prefs: ReaderPrefs; fixed: boolean }) {
  const set = (patch: Partial<ReaderPrefs>) => setReaderPrefs(patch);
  return (
    <div className="flex flex-col gap-6">
      <Row label="Тема страницы">
        <div className="grid grid-cols-5 gap-2">
          {PAGE_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={prefs.theme === t.id}
              onClick={() => set({ theme: t.id })}
              className={cn("flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl border-2 text-[12px] font-semibold", prefs.theme === t.id ? "border-[var(--reader-link)]" : "border-black/10 dark:border-white/10")}
              style={{ background: t.bg, color: t.fg }}
            >
              <span className="text-lg leading-none" style={{ fontFamily: "Literata, Georgia, serif" }}>
                Аа
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </Row>
      {fixed ? (
        <p className="text-sm opacity-70">Это книга с фиксированной вёрсткой (PDF, комикс или DjVu): шрифт и поля задаёт сам файл. В тёмных темах страницы инвертируются.</p>
      ) : (
        <>
          <Row label="Шрифт">
            <div className="grid grid-cols-2 gap-2">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={prefs.font === f.id && !prefs.publisherStyles}
                  onClick={() => set({ font: f.id, publisherStyles: false })}
                  className={cn("h-11 rounded-xl border-2 px-3 text-left text-[16px]", prefs.font === f.id && !prefs.publisherStyles ? "border-[var(--reader-link)]" : "border-black/10 dark:border-white/10")}
                  style={{ fontFamily: f.stack }}
                >
                  {f.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={prefs.publisherStyles}
                onClick={() => set({ publisherStyles: !prefs.publisherStyles })}
                className={cn("h-11 rounded-xl border-2 px-3 text-left text-[14px]", prefs.publisherStyles ? "border-[var(--reader-link)]" : "border-black/10 dark:border-white/10")}
              >
                Как в книге
              </button>
            </div>
          </Row>
          <Row label="Размер текста">
            <Stepper label="Размер текста" value={prefs.size} min={12} max={36} step={1} format={(v) => `${v}px`} onChange={(size) => set({ size })} />
          </Row>
          <Row label="Межстрочный интервал">
            <Stepper label="Интервал" value={prefs.lineHeight} min={1.1} max={2.2} step={0.05} format={(v) => v.toFixed(2)} onChange={(lineHeight) => set({ lineHeight })} />
          </Row>
          <Row label="Поля">
            <Stepper label="Поля" value={prefs.margin} min={0} max={20} step={1} format={(v) => `${v}%`} onChange={(margin) => set({ margin })} />
          </Row>
          <Row label="Ширина колонки">
            <Stepper label="Ширина колонки" value={prefs.maxWidth} min={420} max={1400} step={20} format={(v) => `${v}`} onChange={(maxWidth) => set({ maxWidth })} />
          </Row>
          <Row label="Листание">
            <Choice
              label="Листание"
              value={prefs.flow}
              onChange={(flow) => set({ flow })}
              options={[
                { value: "paginated", label: "Страницы" },
                { value: "scrolled", label: "Прокрутка" },
              ]}
            />
          </Row>
          {prefs.flow === "paginated" && (
            <Row label="Колонки на широком экране">
              <Choice
                label="Колонки"
                value={prefs.columns}
                onChange={(columns) => set({ columns })}
                options={[
                  { value: 1, label: "Одна" },
                  { value: 2, label: "Две" },
                ]}
              />
            </Row>
          )}
          <div className="flex flex-col">
            <Toggle checked={prefs.justify} onChange={(justify) => set({ justify })}>
              Выравнивание по ширине
            </Toggle>
            <Toggle checked={prefs.hyphenate} onChange={(hyphenate) => set({ hyphenate })}>
              Переносы слов
            </Toggle>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- поиск ----------------

function SearchPanel({ view, onGo }: { view: FoliateView | null; onGo: (cfi: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ cfi: string; excerpt: { pre: string; match: string; post: string }; label?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async (e: FormEvent) => {
    e.preventDefault();
    if (!view || !q.trim()) return;
    setBusy(true);
    setResults([]);
    const found: typeof results = [];
    try {
      for await (const r of view.search({ query: q.trim() })) {
        if (r === "done") break;
        if (r.subitems) {
          for (const s of r.subitems) found.push({ ...s, label: r.label });
          setResults([...found]);
        } else if (r.cfi) {
          found.push(r);
          setResults([...found]);
        }
        if (found.length > 300) break;
      }
    } catch {
      /* поиск недоступен для формата */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={run} className="flex gap-2">
        <input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Слово или фраза"
          aria-label="Поиск по книге"
          className="h-11 min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3 outline-none focus:border-[var(--reader-link)] dark:border-white/15"
        />
        <button type="submit" className="reader-btn h-11 px-4 font-semibold" disabled={busy}>
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : "Найти"}
        </button>
      </form>
      {!busy && q && results.length === 0 && <p className="text-sm opacity-60">Ничего не найдено</p>}
      <ul className="flex flex-col gap-1">
        {results.map((r, i) => (
          <li key={`${r.cfi}-${i}`}>
            <button type="button" onClick={() => onGo(r.cfi)} className="w-full rounded-lg px-3 py-2 text-left text-[14px] leading-snug hover:bg-black/5 dark:hover:bg-white/5">
              {r.label && <span className="mb-0.5 block text-[12px] opacity-60">{r.label}</span>}
              <span className="opacity-75">…{r.excerpt.pre}</span>
              <mark className="rounded bg-[var(--reader-link)]/25 px-0.5 text-inherit">{r.excerpt.match}</mark>
              <span className="opacity-75">{r.excerpt.post}…</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------- страница ----------------

export default function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const bookId = Number(id);
  const params = useSearchParams();
  const detail = useQuery(["book", bookId], () => api.books.get(bookId));
  const prefs = useReaderPrefs();
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState<{ done: number; total: number } | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [loc, setLoc] = useState<Location>({ fraction: 0, chapter: "", cfi: "" });
  const [panel, setPanel] = useState<"toc" | "settings" | "search" | null>(null);
  const [bars, setBars] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [sectionMarks, setSectionMarks] = useState<number[]>([]);
  const saveTimer = useRef(0);
  const pending = useRef<Location | null>(null);

  const book = detail.data;
  const fmt = book ? (params.get("fmt") && book.formats.includes(params.get("fmt")!) ? params.get("fmt")! : pickFormat(book)) : null;
  const fixed = fmt ? FIXED.has(fmt) : false;
  const fixedRef = useRef(fixed);
  fixedRef.current = fixed;
  const theme = pageTheme(prefs.theme);

  // ---- сохранение позиции ----
  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const l = pending.current;
    if (!l || !book) return;
    pending.current = null;
    const progress = Math.max(0, Math.min(1, l.fraction));
    api.books
      .setState(book.id, { progress, position: l.cfi, chapter: l.chapter.slice(0, 500) })
      .then((state) => {
        setQueryData(["book", book.id], (b: BookDetail | undefined) => (b ? { ...b, state } : b));
        invalidate(["home"]);
      })
      .catch(() => {});
  }, [book]);

  const scheduleSave = useCallback(
    (l: Location) => {
      pending.current = l;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flush, 1500);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  // ---- открытие книги ----
  useEffect(() => {
    if (!book || !fmt || !host.current) return;
    let cancelled = false;
    let view: FoliateView | null = null;
    let source: any = null;
    setStatus("loading");
    (async () => {
      try {
        await loadFoliate();
        source = await loadBookSource(book, fmt, (done, total) => setLoaded({ done, total }));
        if (cancelled) return;
        view = document.createElement("foliate-view") as FoliateView;
        view.style.cssText = "display:block;width:100%;height:100%";
        host.current!.replaceChildren(view);
        viewRef.current = view;
        await view.open(source);
        if (cancelled) return;
        view.addEventListener("relocate", (e: any) => {
          const d = e.detail;
          const l: Location = {
            fraction: Number.isFinite(d.fraction) ? d.fraction : 0,
            chapter: d.tocItem?.label ?? "",
            cfi: d.cfi ?? "",
            // PDF, DjVu, CBZ — номер страницы = номер секции
            current: fixedRef.current && d.section ? d.section.current : d.location?.current,
            total: fixedRef.current && d.section ? d.section.total : d.location?.total,
          };
          setLoc(l);
          scheduleSave(l);
        });
        view.addEventListener("load", (e: any) => {
          const doc: Document = e.detail.doc;
          doc.addEventListener("keydown", onKey);
          // тап по тексту без выделения — показать/спрятать панели
          doc.addEventListener("click", () => {
            const sel = doc.getSelection?.();
            if (sel && !sel.isCollapsed) return;
            setBars((b) => !b);
            setPanel(null);
          });
        });
        setToc((view.book?.toc as TocItem[]) ?? []);
        try {
          setSectionMarks(view.getSectionFractions?.() ?? []);
        } catch {
          setSectionMarks([]);
        }
        applyPrefs(view, fmt);
        const pos = book.state.position;
        const lastLocation = pos && pos.startsWith("epubcfi(") ? pos : book.state.progress > 0 && book.state.status !== "finished" ? { fraction: book.state.progress } : null;
        await view.init({ lastLocation, showTextStart: !lastLocation && !FIXED.has(fmt) });
        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError((err as Error).message || "Не удалось открыть книгу");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      try {
        view?.close?.();
      } catch {
        /* уже закрыта */
      }
      source?.destroy?.();
      view?.remove();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id, fmt]);

  // ---- применение настроек ----
  const applyPrefs = (view: FoliateView, format: string | null) => {
    const r = view.renderer;
    if (!r) return;
    const p = prefsRef.current;
    if (format && FIXED.has(format)) {
      r.setAttribute?.("animated", "");
      return;
    }
    r.setStyles?.(bookCSS(p));
    r.setAttribute("flow", p.flow);
    r.setAttribute("gap", `${p.margin}%`);
    r.setAttribute("max-inline-size", `${p.maxWidth}px`);
    r.setAttribute("max-column-count", String(p.columns));
    r.setAttribute("margin", "44px");
    r.setAttribute("animated", "");
  };
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    if (viewRef.current && status === "ready") applyPrefs(viewRef.current, fmt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, status]);

  // ---- клавиатура ----
  const onKey = useCallback((e: KeyboardEvent) => {
    const v = viewRef.current;
    if (!v) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, select")) return;
    if (["ArrowLeft", "PageUp"].includes(e.key)) {
      e.preventDefault();
      v.goLeft();
    } else if (["ArrowRight", "PageDown", " "].includes(e.key)) {
      e.preventDefault();
      v.goRight();
    } else if (e.key === "Escape") setPanel(null);
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  // ---- полноэкранный режим ----
  useEffect(() => {
    const on = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const goTo = (target: string) => {
    void viewRef.current?.goTo(target);
    setPanel(null);
  };

  const close = () => {
    flush();
    if (window.history.length > 1) navigate(-1);
    else navigate(`/books/${bookId}`);
  };

  // тёмная тема для PDF и DjVu — инверсия страниц (комиксы не трогаем)
  const filter = fixed && theme.dark && fmt !== "cbz" ? "invert(0.88) hue-rotate(180deg)" : prefs.theme === "sepia" && fixed && fmt !== "cbz" ? "sepia(0.35)" : "none";

  if (detail.error) {
    return (
      <ReaderMessage onClose={close} title="Книга недоступна">
        {detail.error.message}
      </ReaderMessage>
    );
  }
  if (book && !fmt) {
    return (
      <ReaderMessage onClose={close} title="Этот формат пока не открывается в читалке">
        <p>Читалка понимает EPUB, FB2, MOBI, AZW3, PDF, DjVu, CBZ и TXT. Файл можно скачать и открыть в другом приложении.</p>
        <a href={fileUrl(book.id, book.format, true)} className="reader-btn mt-4 inline-flex h-11 items-center gap-2 px-4 font-semibold">
          <Download className="size-4" /> Скачать {book.format.toUpperCase()}
        </a>
      </ReaderMessage>
    );
  }

  const percent = Math.round(loc.fraction * 100);

  return (
    <div
      className="reader fixed inset-0 z-[60] flex flex-col overflow-hidden"
      style={
        {
          background: theme.bg,
          color: theme.fg,
          "--reader-bg": theme.bg,
          "--reader-fg": theme.fg,
          "--reader-link": theme.link,
          colorScheme: theme.dark ? "dark" : "light",
        } as CSSProperties
      }
    >
      <style>{`
        .reader foliate-view::part(filter) { filter: ${filter}; }
        .reader foliate-view::part(head), .reader foliate-view::part(foot) { color: ${theme.fg}; opacity: .55; font: 12px var(--font-ui); }
        .reader .reader-btn { display:inline-flex; align-items:center; justify-content:center; border-radius: 12px; transition: background .15s; }
        .reader .reader-btn:hover { background: color-mix(in srgb, ${theme.fg} 8%, transparent); }
        .reader .reader-btn:disabled { opacity: .35; }
      `}</style>

      {/* верхняя панель */}
      <header
        className={cn(
          "absolute inset-x-0 top-0 z-20 flex items-center gap-1 px-2 pt-[max(0.4rem,env(safe-area-inset-top))] pb-1.5 transition-all duration-200 sm:px-3",
          bars ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0",
        )}
        style={{ background: `color-mix(in srgb, ${theme.bg} 94%, transparent)`, borderBottom: `1px solid color-mix(in srgb, ${theme.fg} 10%, transparent)` }}
      >
        <button type="button" onClick={close} aria-label="Закрыть книгу" className="reader-btn size-11">
          <ArrowLeft className="size-5" />
        </button>
        <button type="button" onClick={() => setPanel(panel === "toc" ? null : "toc")} aria-label="Оглавление" aria-pressed={panel === "toc"} className="reader-btn size-11">
          <MenuIcon className="size-5" />
        </button>
        <div className="min-w-0 flex-1 px-2 text-center">
          <div className="truncate text-[15px] font-semibold" style={{ fontFamily: "Literata, Georgia, serif" }}>
            {book?.title ?? ""}
          </div>
          <div className="truncate text-[12px] opacity-60">{loc.chapter || (book ? book.authors.join(", ") : "")}</div>
        </div>
        {!fixed && (
          <button type="button" onClick={() => setPanel(panel === "search" ? null : "search")} aria-label="Поиск по книге" aria-pressed={panel === "search"} className="reader-btn size-11">
            <Search className="size-5" />
          </button>
        )}
        <button type="button" onClick={() => setPanel(panel === "settings" ? null : "settings")} aria-label="Настройки чтения" aria-pressed={panel === "settings"} className="reader-btn h-11 min-w-11 px-2 text-[17px] font-semibold" style={{ fontFamily: "Literata, Georgia, serif" }}>
          Aa
        </button>
        <span className="hidden sm:contents">
          <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Выйти из полноэкранного режима" : "Во весь экран"} className="reader-btn size-11">
            {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
          </button>
        </span>
      </header>

      {/* книга */}
      <div className="relative min-h-0 flex-1 pt-[max(3.6rem,calc(env(safe-area-inset-top)+3.2rem))] pb-[max(3.4rem,calc(env(safe-area-inset-bottom)+3rem))]">
        <div ref={host} className="size-full" />
        {/* зоны листания по краям (в режиме страниц) */}
        {status === "ready" && (prefs.flow === "paginated" || fixed) && (
          <>
            <button type="button" aria-label="Предыдущая страница" onClick={() => viewRef.current?.goLeft()} className="group absolute inset-y-0 left-0 hidden w-[9%] max-w-24 items-center justify-start pl-2 sm:flex">
              <ChevronLeft className="size-7 opacity-0 transition group-hover:opacity-40" />
            </button>
            <button type="button" aria-label="Следующая страница" onClick={() => viewRef.current?.goRight()} className="group absolute inset-y-0 right-0 hidden w-[9%] max-w-24 items-center justify-end pr-2 sm:flex">
              <ChevronRight className="size-7 opacity-0 transition group-hover:opacity-40" />
            </button>
          </>
        )}
        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <LoaderCircle className="size-7 animate-spin opacity-60" />
            <span className="text-sm opacity-60">
              {loaded?.total ? `Загружаю книгу · ${Math.round((loaded.done / loaded.total) * 100)}%` : "Открываю книгу…"}
            </span>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <TriangleAlert className="size-7 opacity-70" />
            <p className="max-w-md">Не получилось открыть книгу: {error}</p>
            {book && fmt && (
              <a href={fileUrl(book.id, fmt, true)} className="reader-btn h-11 gap-2 border px-4 font-semibold" style={{ borderColor: `color-mix(in srgb, ${theme.fg} 20%, transparent)` }}>
                <Download className="size-4" /> Скачать файл
              </a>
            )}
          </div>
        )}
      </div>

      {/* нижняя панель: прогресс */}
      <footer
        className={cn(
          "absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 px-4 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] transition-all duration-200",
          bars ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0",
        )}
        style={{ background: `color-mix(in srgb, ${theme.bg} 94%, transparent)`, borderTop: `1px solid color-mix(in srgb, ${theme.fg} 10%, transparent)` }}
      >
        <span className="num w-11 text-sm font-semibold">{percent}%</span>
        <div className="relative flex-1">
          <input
            type="range"
            aria-label="Прогресс чтения"
            min={0}
            max={1}
            step={0.001}
            value={loc.fraction}
            onChange={(e) => {
              const f = Number(e.target.value);
              setLoc((l) => ({ ...l, fraction: f }));
              void viewRef.current?.goToFraction(f);
            }}
            className="h-8 w-full accent-[var(--reader-link)]"
          />
          {sectionMarks.length > 1 && sectionMarks.length < 80 && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-[7px] top-1/2 h-0">
              {sectionMarks.slice(1).map((f, i) => (
                <span key={i} className="absolute -top-[3px] h-1.5 w-px opacity-30" style={{ left: `${f * 100}%`, background: theme.fg }} />
              ))}
            </div>
          )}
        </div>
        <span className="num hidden w-28 text-right text-[12px] opacity-60 sm:block">{loc.current !== undefined && loc.total ? `стр. ${loc.current + 1} из ${loc.total}` : ""}</span>
      </footer>

      {/* панели: оглавление слева, настройки и поиск справа */}
      {panel && (
        <div className="absolute inset-0 z-30" onClick={() => setPanel(null)}>
          <div className="absolute inset-0 bg-black/25" />
          <aside
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "animate-fade-in absolute inset-y-0 flex w-full max-w-[380px] flex-col shadow-2xl",
              panel === "toc" ? "left-0" : "right-0",
            )}
            style={{ background: theme.bg, borderColor: `color-mix(in srgb, ${theme.fg} 12%, transparent)` }}
            aria-label={panel === "toc" ? "Оглавление" : panel === "search" ? "Поиск" : "Настройки чтения"}
          >
            <div className="flex items-center justify-between gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
              <h2 className="text-xl font-semibold" style={{ fontFamily: "Literata, Georgia, serif" }}>
                {panel === "toc" ? "Оглавление" : panel === "search" ? "Поиск по книге" : "Настройки чтения"}
              </h2>
              <button type="button" onClick={() => setPanel(null)} aria-label="Закрыть" className="reader-btn size-10">
                <X className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              {panel === "toc" &&
                (toc.length ? <TocList items={toc} current={loc.chapter} onGo={goTo} /> : <p className="px-3 text-sm opacity-60">В книге нет оглавления.</p>)}
              {panel === "settings" && (
                <div className="px-2">
                  <SettingsPanel prefs={prefs} fixed={fixed} />
                </div>
              )}
              {panel === "search" && (
                <div className="px-2">
                  <SearchPanel view={viewRef.current} onGo={goTo} />
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function ReaderMessage({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <h1 className="title-display text-2xl">{title}</h1>
      <div className="max-w-md text-muted">{children}</div>
      <button type="button" onClick={onClose} className="mt-2 text-sm font-semibold text-accent-ink hover:underline">
        Вернуться
      </button>
    </div>
  );
}
