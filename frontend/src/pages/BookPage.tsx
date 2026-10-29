import { useState, type ReactNode } from "react";
import { BookCover, BookGrid, Rating, saveState, SeriesLine, STATUSES, statusLabel } from "@/components/books";
import { ArrowLeft, BookOpen, Download, Headphones, LibraryBig, Lock, Play, Users } from "@/components/icons";
import { Section } from "@/components/Section";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, ErrorBox, PageLoader } from "@/components/ui/misc";
import { api, audioUrl, fileUrl, type BookDetail, type ReadStatus } from "@/lib/api";
import { dialogs } from "@/lib/dialogs";
import { formatDuration, formatSize, formatTime, pagesLabel, percent } from "@/lib/format";
import { setQueryData, useQuery } from "@/lib/query";
import { Link, navigate, useParams } from "@/lib/router";
import { cn } from "@/lib/utils";

const LANGS: Record<string, string> = { ru: "русский", en: "английский", uk: "украинский", be: "белорусский", de: "немецкий", fr: "французский", es: "испанский", it: "итальянский" };

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="label-caps">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 600;
  return (
    <div>
      <div className={cn("leading-relaxed whitespace-pre-line", !open && long && "line-clamp-6")}>{text}</div>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-2 text-sm font-semibold text-accent-ink hover:underline">
          {open ? "Свернуть" : "Читать полностью"}
        </button>
      )}
    </div>
  );
}

function StatusPicker({ book }: { book: BookDetail }) {
  const set = async (status: ReadStatus) => {
    const next = book.state.status === status ? "none" : status;
    const state = await saveState(book, { status: next });
    if (state) setQueryData(["book", book.id], (b: BookDetail | undefined) => (b ? { ...b, state } : b));
  };
  return (
    <div role="radiogroup" aria-label="Статус" className="flex flex-wrap gap-2">
      {STATUSES.map((s) => {
        const active = book.state.status === s.id;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => set(s.id)}
            className={cn(
              "h-10 rounded-[10px] border px-3.5 text-[14px] font-semibold transition",
              active ? "border-accent bg-accent text-accent-fg" : "bg-surface text-fg hover:border-accent",
            )}
          >
            {statusLabel(s.id, book.kind)}
          </button>
        );
      })}
    </div>
  );
}

/** Простой плеер аудиокниги: список файлов и стандартный проигрыватель (полноценный — следующим этапом). */
function AudioFiles({ book }: { book: BookDetail }) {
  const [current, setCurrent] = useState<number | null>(null);
  return (
    <div className="card overflow-hidden">
      {current !== null && (
        <div className="border-b bg-surface-2 p-3">
          <p className="mb-2 truncate px-1 text-sm font-semibold">{book.files[current]?.title ?? book.files[current]?.name}</p>
          <audio
            key={current}
            src={audioUrl(book.id, current)}
            controls
            autoPlay
            className="w-full"
            onEnded={() => setCurrent((c) => (c !== null && c + 1 < book.files.length ? c + 1 : null))}
          />
        </div>
      )}
      <ol className="max-h-[420px] divide-y overflow-y-auto">
        {book.files.map((f, i) => (
          <li key={i} className={cn("flex items-center gap-3 px-3 py-1.5", current === i && "bg-accent-soft")}>
            <button
              type="button"
              aria-label={`Слушать: ${f.title ?? f.name}`}
              onClick={() => setCurrent(i)}
              className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-accent-ink hover:bg-surface-2"
            >
              <Play className="size-4 fill-current" />
            </button>
            <span className="num w-7 shrink-0 text-sm text-faint">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{f.title || f.name}</span>
            <span className="num text-sm text-muted">{formatTime(f.duration)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function BookPage() {
  const { id } = useParams<{ id: string }>();
  const bookId = Number(id);
  const query = useQuery(["book", bookId], () => api.books.get(bookId));

  if (query.isLoading) return <PageLoader />;
  if (query.error) return <ErrorBox error={query.error} />;
  const book = query.data!;
  const audio = book.kind === "audio";
  const size = audio
    ? `${formatDuration(book.duration)} · ${book.files.length} ${book.files.length === 1 ? "файл" : "файлов"}`
    : book.pages
      ? pagesLabel(book.pages)
      : null;

  const setRating = async (rating: number) => {
    const state = await saveState(book, { rating });
    if (state) setQueryData(["book", book.id], (b: BookDetail | undefined) => (b ? { ...b, state } : b));
  };

  return (
    <div className="flex flex-col gap-10">
      <button type="button" onClick={() => navigate(-1)} className="-mb-4 flex items-center gap-1.5 self-start text-sm font-semibold text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Назад
      </button>

      <div className="grid gap-8 md:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
        <div className="mx-auto flex w-full max-w-[240px] flex-col gap-4">
          <BookCover book={book} size="lg" />
          {audio ? (
            <a href="#files" className={buttonClass("primary", "lg")}>
              <Headphones className="size-5" /> Слушать
            </a>
          ) : ["pdf", "txt"].includes(book.format) ? (
            <a href={fileUrl(book.id)} target="_blank" rel="noreferrer" className={buttonClass("primary", "lg")}>
              <BookOpen className="size-5" /> Открыть
            </a>
          ) : (
            <div className="flex flex-col gap-1.5">
              <button type="button" disabled className={buttonClass("primary", "lg", "w-full")}>
                <BookOpen className="size-5" /> Читать
              </button>
              <span className="text-center text-xs text-muted">Читалка — следующий этап. Пока можно скачать файл ниже.</span>
            </div>
          )}
          <Button variant="outline" onClick={() => dialogs.addToShelf([book.id])}>
            <LibraryBig className="size-4" /> На полку
          </Button>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-2">
            <SeriesLine book={book} />
            <h1 className="title-display text-[32px] leading-tight sm:text-[40px]">{book.title}</h1>
            <p className="text-lg">
              {book.authors.length ? (
                book.authors.map((a, i) => (
                  <span key={a}>
                    {i > 0 && ", "}
                    <Link to={`/books?author=${encodeURIComponent(a)}&sort=series`} className="font-semibold text-accent-ink hover:underline">
                      {a}
                    </Link>
                  </span>
                ))
              ) : (
                <span className="text-muted">Автор не указан</span>
              )}
              {book.narrator && <span className="text-muted"> · читает {book.narrator}</span>}
            </p>
          </div>

          <div className="card flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="label-caps">Мой статус</span>
              <Rating value={book.state.rating} onChange={setRating} />
            </div>
            <StatusPicker book={book} />
            {book.state.progress > 0 && book.state.status !== "finished" && (
              <div className="flex items-center gap-3">
                <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <span className="block h-full rounded-full bg-accent" style={{ width: percent(book.state.progress) }} />
                </span>
                <span className="num text-sm font-semibold">{percent(book.state.progress)}</span>
              </div>
            )}
            {book.shelves.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-4 text-sm">
                <span className="text-muted">На полках:</span>
                {book.shelves.map((s) => (
                  <Link key={s.id} to={`/shelves/${s.id}`} className="rounded-md bg-surface-2 px-2 py-0.5 font-semibold hover:text-accent-ink">
                    {s.name}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {book.description && <Description text={book.description} />}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {size && <Meta label={audio ? "Длительность" : "Объём"}>{size}</Meta>}
            {book.year && <Meta label="Год">{book.year}</Meta>}
            {book.language && <Meta label="Язык">{LANGS[book.language.slice(0, 2).toLowerCase()] ?? book.language}</Meta>}
            {book.publisher && <Meta label="Издательство">{book.publisher}</Meta>}
            {book.isbn && <Meta label="ISBN">{book.isbn}</Meta>}
            {book.library && (
              <Meta label="Медиатека">
                <Link to={`/libraries/${book.library.id}`} className="inline-flex items-center gap-1.5 hover:text-accent-ink">
                  {book.library.scope === "personal" ? <Lock className="size-4 text-muted" /> : <Users className="size-4 text-muted" />}
                  {book.library.name}
                </Link>
              </Meta>
            )}
          </dl>

          {book.subjects.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {book.subjects.map((s) => (
                <Badge key={s} className="text-[12px] font-semibold normal-case">
                  {s}
                </Badge>
              ))}
            </div>
          )}

          <div id="files" className="flex scroll-mt-20 flex-col gap-3">
            <h2 className="title-display text-2xl">{audio ? "Файлы" : "Форматы"}</h2>
            {audio ? (
              <AudioFiles book={book} />
            ) : (
              <div className="flex flex-wrap gap-3">
                {book.files.map((f) => (
                  <a
                    key={f.format}
                    href={fileUrl(book.id, f.format, true)}
                    className="card flex items-center gap-3 px-4 py-3 transition hover:-translate-y-0.5"
                    title={f.name}
                  >
                    <Download className="size-[18px] text-accent-ink" />
                    <span className="flex flex-col leading-tight">
                      <span className="font-bold uppercase">{f.format}</span>
                      <span className="text-xs text-muted">{formatSize(f.size)}</span>
                    </span>
                  </a>
                ))}
              </div>
            )}
            {book.scan_error && <p className="text-sm text-danger">При чтении файла: {book.scan_error}</p>}
          </div>
        </div>
      </div>

      {book.series_books.length > 0 && (
        <Section title={`Серия «${book.series}»`} link={`/books?series=${encodeURIComponent(book.series)}`}>
          <BookGrid books={book.series_books} />
        </Section>
      )}
    </div>
  );
}
