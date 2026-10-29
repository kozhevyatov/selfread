/** Мини-плеер аудиокниги над нижним меню и полноэкранный плеер с главами, скоростью и таймером сна. */
import { useEffect, useState } from "react";
import { formatTime } from "@/lib/format";
import { chaptersOf, currentChapter, overall, player, usePlayer, type PlayerState } from "@/lib/player";
import { Link, useLocation } from "@/lib/router";
import { cn } from "@/lib/utils";
import { BookCover } from "./books";
import { ChevronDown, LoaderCircle, Moon, RotateCcw, RotateCw, SkipBack, SkipForward, X } from "./icons";
import { PauseFill, PlayFill } from "./icon";

const RATES = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function PlayButton({ s, size = "md" }: { s: PlayerState; size?: "md" | "lg" }) {
  return (
    <button
      type="button"
      onClick={() => player.toggle()}
      aria-label={s.playing ? "Пауза" : "Слушать"}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition hover:brightness-110 active:scale-95",
        size === "lg" ? "size-[72px]" : "size-11",
      )}
    >
      {s.loading && s.playing ? (
        <LoaderCircle className={cn("animate-spin", size === "lg" ? "size-8" : "size-5")} />
      ) : s.playing ? (
        <PauseFill className={size === "lg" ? "size-8" : "size-5"} />
      ) : (
        <PlayFill className={cn(size === "lg" ? "size-8" : "size-5", "translate-x-px")} />
      )}
    </button>
  );
}

function SkipButton({ delta, size = "md" }: { delta: number; size?: "md" | "lg" }) {
  const Icon = delta < 0 ? RotateCcw : RotateCw;
  return (
    <button
      type="button"
      onClick={() => player.skip(delta)}
      aria-label={delta < 0 ? `Назад на ${-delta} секунд` : `Вперёд на ${delta} секунд`}
      className={cn("relative flex shrink-0 items-center justify-center rounded-full text-fg hover:bg-surface-2", size === "lg" ? "size-14" : "size-11")}
    >
      <Icon className={size === "lg" ? "size-8" : "size-6"} strokeWidth={1.6} />
      <span className={cn("absolute font-bold", size === "lg" ? "text-[10px]" : "text-[8px]")}>{Math.abs(delta)}</span>
    </button>
  );
}

function rateLabel(r: number) {
  return `${String(r).replace(".", ",")}×`;
}

function FullPlayer({ s, onClose }: { s: PlayerState; onClose: () => void }) {
  const book = s.book!;
  const chapters = chaptersOf(book);
  const ch = currentChapter(s);
  const total = overall(s);
  // ползунок — по текущей главе (в m4b) или по файлу
  const single = book.files.length === 1;
  const start = single && ch ? ch.start : 0;
  const end = single && ch ? ch.end || s.fileDuration : s.fileDuration;
  const pos = Math.max(0, s.time - start);
  const len = Math.max(0, end - start);
  const [sleepOpen, setSleepOpen] = useState(false);
  const sleepLeft = s.sleepAt ? Math.max(0, Math.round((s.sleepAt - Date.now()) / 60000)) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Плеер" className="animate-sheet-up fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-bg">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:flex-row lg:gap-12 lg:px-10 lg:pt-10">
        <div className="flex flex-col gap-6 lg:w-[420px] lg:shrink-0">
          <div className="flex items-center justify-between">
            <button type="button" onClick={onClose} aria-label="Свернуть плеер" className="flex size-11 items-center justify-center rounded-xl hover:bg-surface-2">
              <ChevronDown className="size-6" />
            </button>
            <Link to={`/books/${book.id}`} onClick={onClose} className="text-sm font-semibold text-accent-ink hover:underline">
              О книге
            </Link>
          </div>
          <div className="mx-auto w-full max-w-[220px] lg:max-w-[240px]">
            <BookCover book={{ ...book, format: "", kind: "audio" }} size="lg" badge={false} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-muted">{ch?.title}</p>
            <h2 className="title-display mt-1 text-2xl">{book.title}</h2>
            <p className="mt-1 text-muted">
              {book.authors.join(", ")}
              {book.narrator && ` · читает ${book.narrator}`}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <input
              type="range"
              aria-label="Позиция в главе"
              min={0}
              max={len || 1}
              step={1}
              value={Math.min(pos, len || 1)}
              onChange={(e) => player.seek(start + Number(e.target.value))}
              className="h-6 w-full accent-[var(--accent)]"
            />
            <div className="num flex justify-between text-[13px] text-muted">
              <span>{formatTime(pos)}</span>
              <span>−{formatTime(Math.max(0, len - pos))}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3">
            <button type="button" onClick={() => player.prevChapter()} aria-label="Предыдущая глава" className="flex size-12 items-center justify-center rounded-full hover:bg-surface-2">
              <SkipBack className="size-6" />
            </button>
            <SkipButton delta={-15} size="lg" />
            <PlayButton s={s} size="lg" />
            <SkipButton delta={30} size="lg" />
            <button type="button" onClick={() => player.nextChapter()} aria-label="Следующая глава" className="flex size-12 items-center justify-center rounded-full hover:bg-surface-2">
              <SkipForward className="size-6" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <label className="flex h-10 items-center gap-2 rounded-xl border bg-surface px-3 text-sm font-semibold">
              Скорость
              <select value={s.rate} onChange={(e) => player.setRate(Number(e.target.value))} className="bg-transparent outline-none" aria-label="Скорость">
                {RATES.map((r) => (
                  <option key={r} value={r}>
                    {rateLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setSleepOpen(!sleepOpen)}
                aria-expanded={sleepOpen}
                className={cn("flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold", s.sleepAt || s.sleepEndOfChapter ? "border-accent bg-accent-soft text-accent-ink" : "bg-surface")}
              >
                <Moon className="size-4" />
                {s.sleepEndOfChapter ? "До конца главы" : sleepLeft !== null ? `Сон через ${sleepLeft} мин` : "Таймер сна"}
              </button>
              {sleepOpen && (
                <div className="absolute bottom-12 left-1/2 z-10 flex w-48 -translate-x-1/2 flex-col rounded-2xl border bg-surface p-1.5 shadow-pop">
                  {[5, 15, 30, 45, 60].map((m) => (
                    <button key={m} type="button" onClick={() => (player.setSleep(m), setSleepOpen(false))} className="rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-surface-2">
                      {m} минут
                    </button>
                  ))}
                  <button type="button" onClick={() => (player.setSleep("chapter"), setSleepOpen(false))} className="rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-surface-2">
                    До конца главы
                  </button>
                  {(s.sleepAt || s.sleepEndOfChapter) && (
                    <button type="button" onClick={() => (player.setSleep(null), setSleepOpen(false))} className="rounded-xl px-3 py-2 text-left text-sm font-semibold text-danger hover:bg-surface-2">
                      Выключить
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <p className="num text-center text-[13px] text-muted">
            Прослушано {Math.round(total.fraction * 100)}% · осталось {formatTime(Math.max(0, (total.total - total.position) / (s.rate || 1)))}
          </p>
          {s.error && <p className="text-center text-sm text-danger">{s.error}</p>}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <h3 className="title-display text-xl">{chapters.length > 1 ? "Главы" : "Файл"}</h3>
          <ol className="card max-h-[60vh] divide-y overflow-y-auto lg:max-h-none lg:flex-1">
            {chapters.map((c, i) => {
              const active = ch !== null && c.index === ch.index && c.start === ch.start;
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => player.goChapter(c)}
                    aria-current={active ? "true" : undefined}
                    className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2", active && "bg-accent-soft")}
                  >
                    <span className="num w-7 shrink-0 text-sm text-faint">{i + 1}</span>
                    <span className={cn("min-w-0 flex-1 truncate", active && "font-semibold text-accent-ink")}>{c.title}</span>
                    <span className="num text-sm text-muted">{formatTime(c.end - c.start)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

/** Мини-плеер: виден, пока выбрана аудиокнига. */
export function PlayerBar() {
  const s = usePlayer();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  if (!s.book || pathname.startsWith("/read/")) return null;
  const ch = currentChapter(s);
  const { fraction } = overall(s);
  return (
    <>
      <div className="fixed inset-x-2 bottom-[calc(3.6rem+env(safe-area-inset-bottom))] z-40 lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-[440px]">
        <div className="card relative flex items-center gap-3 overflow-hidden p-2 pr-3 shadow-pop">
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-3">
            <span className="block h-full bg-accent" style={{ width: `${fraction * 100}%` }} />
          </span>
          <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Открыть плеер">
            <span className="w-11 shrink-0">
              <BookCover book={{ ...s.book, format: "", kind: "audio" }} size="sm" badge={false} />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-semibold">{s.book.title}</span>
              <span className="truncate text-[13px] text-muted">{ch?.title ?? s.book.authors.join(", ")}</span>
            </span>
          </button>
          <SkipButton delta={-15} />
          <PlayButton s={s} />
          <button type="button" onClick={() => player.close()} aria-label="Закрыть плеер" className="hidden size-9 items-center justify-center rounded-full text-faint hover:bg-surface-2 hover:text-fg sm:flex">
            <X className="size-4" />
          </button>
        </div>
      </div>
      {open && <FullPlayer s={s} onClose={() => setOpen(false)} />}
    </>
  );
}
