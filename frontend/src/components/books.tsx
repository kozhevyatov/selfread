/** Обложки, карточки книг, статусы, оценка — общие кусочки страниц библиотеки. */
import { useState, type ReactNode } from "react";
import { api, coverUrl, type Book, type ReadStatus, type Shelf } from "@/lib/api";
import { authorsText, formatDuration, percent, seriesText } from "@/lib/format";
import { patchEverywhere } from "@/lib/query";
import { Link } from "@/lib/router";
import { toast } from "@/lib/toast";
import { cn, hueOf } from "@/lib/utils";
import { Check, Headphones, Star } from "./icons";

// ---------------- обложка ----------------

/** Обложка книги; если картинки нет — «тканевый» переплёт цвета палитры с названием. */
export function BookCover({
  book,
  className,
  size = "md",
  badge = true,
}: {
  book: Pick<Book, "id" | "title" | "authors" | "cover" | "format" | "kind">;
  className?: string;
  size?: "sm" | "md" | "lg";
  badge?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const url = coverUrl(book.cover);
  const n = (hueOf(book.title + book.id) % 6) + 1;
  return (
    <div
      className={cn("book-cover relative aspect-[2/3] w-full overflow-hidden", className)}
      style={{ background: `var(--cover-${n})`, color: n === 4 ? "var(--cover-ink-4)" : "var(--cover-ink)" }}
    >
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className={cn("absolute inset-0 flex flex-col justify-between", size === "sm" ? "p-2" : "px-3 pt-6 pb-3")}>
          <span
            className={cn(
              "title-display line-clamp-5 leading-[1.15] font-semibold [overflow-wrap:anywhere]",
              size === "sm" ? "text-[11px]" : size === "lg" ? "text-[26px]" : "text-[16px]",
            )}
          >
            {book.title}
          </span>
          <span className={cn("line-clamp-2 opacity-85", size === "sm" ? "text-[8px]" : "text-[11px]")}>{book.authors.join(", ")}</span>
        </div>
      )}
      {/* корешок */}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-[5px] bg-black/12" />
      {badge && size !== "sm" && (
        <span className="absolute top-2 right-2 flex items-center gap-1 rounded-[5px] bg-surface/95 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-fg uppercase shadow-sm">
          {book.kind === "audio" && <Headphones className="size-3" />}
          {book.format}
        </span>
      )}
    </div>
  );
}

// ---------------- статусы ----------------

export const STATUSES: { id: Exclude<ReadStatus, "none">; label: string }[] = [
  { id: "want", label: "Хочу прочитать" },
  { id: "reading", label: "Читаю" },
  { id: "finished", label: "Прочитано" },
  { id: "abandoned", label: "Брошено" },
];

export function statusLabel(status: ReadStatus, kind: Book["kind"] = "ebook") {
  if (status === "none") return "Не начата";
  if (kind === "audio") {
    return { want: "Хочу послушать", reading: "Слушаю", finished: "Прослушано", abandoned: "Брошено" }[status];
  }
  return STATUSES.find((s) => s.id === status)?.label ?? status;
}

const CHIP: Record<ReadStatus, string> = {
  none: "bg-surface-2 text-muted",
  want: "bg-[color-mix(in_srgb,var(--cover-4)_22%,var(--surface))] text-fg",
  reading: "bg-accent-soft text-accent-ink",
  finished: "bg-[color-mix(in_srgb,var(--success)_16%,var(--surface))] text-success",
  abandoned: "bg-surface-2 text-faint line-through decoration-1",
};

export function StatusChip({ status, kind, className }: { status: ReadStatus; kind?: Book["kind"]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap", CHIP[status], className)}>
      {statusLabel(status, kind)}
    </span>
  );
}

/** Обновить статус/прогресс книги и все её копии в закэшированных списках. */
export async function saveState(book: Pick<Book, "id">, data: Parameters<typeof api.books.setState>[1]) {
  try {
    const state = await api.books.setState(book.id, data);
    patchEverywhere((value) => patchBookState(value, book.id, state));
    return state;
  } catch (err) {
    toast.error((err as Error).message);
    return null;
  }
}

function patchBookState(value: unknown, id: number, state: Book["state"]): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((v) => {
      const p = patchBookState(v, id, state);
      if (p !== v) changed = true;
      return p;
    });
    return changed ? next : value;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.id === id && "state" in obj && "kind" in obj) return { ...obj, state };
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const p = typeof v === "object" ? patchBookState(v, id, state) : v;
      if (p !== v) changed = true;
      next[k] = p;
    }
    return changed ? next : value;
  }
  return value;
}

// ---------------- оценка ----------------

export function Rating({ value, onChange, size = "md" }: { value: number; onChange?: (v: number) => void; size?: "sm" | "md" }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center" role={onChange ? "radiogroup" : undefined} aria-label="Оценка" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} из 5`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(value === n ? 0 : n)}
            className="flex size-9 items-center justify-center rounded-lg hover:bg-surface-2"
          >
            <Star className={cn("size-5 transition", n <= shown ? "fill-accent text-accent" : "text-faint")} />
          </button>
        ) : (
          <Star key={n} className={cn(size === "sm" ? "size-3.5" : "size-4", n <= value ? "fill-accent text-accent" : "text-surface-3")} />
        ),
      )}
    </div>
  );
}

// ---------------- карточки ----------------

/** Книга в сетке: обложка, название, автор, статус. */
export function BookTile({ book, showStatus = true }: { book: Book; showStatus?: boolean }) {
  const progress = book.state.status === "reading" && book.state.progress > 0;
  return (
    <Link to={`/books/${book.id}`} className="group flex min-w-0 flex-col gap-2 text-fg">
      <div className="transition group-hover:-translate-y-0.5">
        <BookCover book={book} />
      </div>
      {progress && (
        <span className="block h-1 overflow-hidden rounded-full bg-surface-3">
          <span className="block h-full rounded-full bg-accent" style={{ width: percent(book.state.progress) }} />
        </span>
      )}
      <span className="line-clamp-2 leading-snug font-semibold">{book.title}</span>
      <span className="-mt-1.5 line-clamp-1 text-[13px] text-muted">{authorsText(book.authors)}</span>
      {showStatus && book.state.status !== "none" && <StatusChip status={book.state.status} kind={book.kind} className="self-start" />}
    </Link>
  );
}

export function BookGrid({ books, children }: { books: Book[]; children?: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(146px,1fr))] sm:gap-x-5">
      {books.map((b) => (
        <BookTile key={b.id} book={b} />
      ))}
      {children}
    </div>
  );
}

/** «Читаю сейчас»: обложка, где остановился, прогресс. */
export function ReadingCard({ book }: { book: Book }) {
  const audio = book.kind === "audio";
  const left =
    audio && book.duration
      ? `осталось ${formatDuration(book.duration * (1 - book.state.progress))}`
      : book.pages
        ? `осталось ~${Math.max(1, Math.round(book.pages * (1 - book.state.progress)))} стр.`
        : "";
  return (
    <Link to={`/books/${book.id}`} className="card flex gap-4 p-4 text-fg transition hover:-translate-y-0.5">
      <div className="w-[78px] shrink-0">
        <BookCover book={book} size="sm" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
          {audio && <Headphones className="size-3.5" />}
          <span className="truncate">{book.state.chapter || (audio ? "Аудиокнига" : book.format.toUpperCase())}</span>
        </span>
        <span className="title-display line-clamp-2 text-[18px] leading-tight">{book.title}</span>
        <span className="truncate text-sm text-muted">{authorsText(book.authors)}</span>
        <span className="mt-auto block h-1.5 overflow-hidden rounded-full bg-surface-3">
          <span className="block h-full rounded-full bg-accent" style={{ width: percent(book.state.progress) }} />
        </span>
        <span className="mt-1 flex justify-between gap-2 text-[13px] text-muted">
          <span className="font-semibold text-fg">{percent(book.state.progress)}</span>
          <span className="truncate">{left}</span>
        </span>
      </div>
    </Link>
  );
}

/** Полка: «корешки» книг и подпись. */
export function ShelfCard({ shelf }: { shelf: Shelf }) {
  const heights = [58, 50, 62, 44];
  const widths = [16, 20, 14, 18];
  return (
    <Link to={`/shelves/${shelf.id}`} className="card flex flex-col gap-3.5 p-4 text-fg transition hover:-translate-y-0.5">
      <div className="flex h-16 items-end gap-1 border-b-[3px] border-[color-mix(in_srgb,var(--cover-6)_45%,var(--line))] px-1">
        {heights.map((h, i) => {
          const book = shelf.preview[i];
          const n = book ? (hueOf(book.title + book.id) % 6) + 1 : ((shelf.id + i) % 6) + 1;
          return (
            <span
              key={i}
              className={cn("rounded-t-[2px]", !book && "opacity-25")}
              style={{ width: widths[i], height: h, background: `var(--cover-${n})` }}
            />
          );
        })}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[16px] font-semibold">{shelf.name}</span>
        <span className="truncate text-[13px] text-muted">
          {shelf.book_count} {plural(shelf.book_count)} · {shelf.mine ? (shelf.is_shared ? "общая" : "личная") : `от ${shelf.owner?.name ?? "—"}`}
        </span>
      </div>
    </Link>
  );
}

function plural(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "книга";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "книги";
  return "книг";
}

/** Строка «серия · номер» для страницы книги и списков. */
export function SeriesLine({ book }: { book: Pick<Book, "series" | "series_index"> }) {
  if (!book.series) return null;
  return (
    <Link to={`/books?series=${encodeURIComponent(book.series)}`} className="text-sm font-semibold text-accent-ink hover:underline">
      {seriesText(book.series, book.series_index)}
    </Link>
  );
}

export function CheckRow({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-semibold hover:bg-surface-2"
    >
      <span className={cn("flex size-5 items-center justify-center rounded-md border-2", checked ? "border-accent bg-accent text-accent-fg" : "border-surface-3")}>
        {checked && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
