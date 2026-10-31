import { useState, type ReactNode } from "react";
import { BookCover, BookGrid, Rating, saveState, SeriesLine, STATUSES, statusLabel } from "@/components/books";
import { ArrowLeft, Bookmark, BookOpen, Download, Headphones, LibraryBig, LoaderCircle, Lock, NotebookPen, Pencil, Play, Quote, Trash, Users } from "@/components/icons";
import { OfflineButton } from "@/components/OfflineButton";
import { colorValue, useAnnotations, whereLabel } from "@/lib/annotations";
import { Section } from "@/components/Section";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, ErrorBox, PageLoader } from "@/components/ui/misc";
import { api, fileUrl, type BookDetail, type ReadStatus } from "@/lib/api";
import { canRead } from "@/lib/bookSources";
import { dialogs } from "@/lib/dialogs";
import { chaptersOf, currentChapter, player, usePlayer } from "@/lib/player";
import { formatDuration, formatSize, formatTime, pagesLabel, percent } from "@/lib/format";
import { invalidate, setQueryData, useQuery } from "@/lib/query";
import { toast } from "@/lib/toast";
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

/** Файлы или главы аудиокниги: клик — слушать с этого места. */
function AudioFiles({ book }: { book: BookDetail }) {
  const p = usePlayer();
  const current = p.book?.id === book.id ? currentChapter(p) : null;
  const chapters = chaptersOf(book);
  return (
    <div className="card overflow-hidden">
      <ol className="max-h-[420px] divide-y overflow-y-auto">
        {chapters.map((c, i) => {
          const active = current !== null && current.index === c.index && current.start === c.start;
          return (
            <li key={i} className={cn("flex items-center gap-3 px-3 py-1.5", active && "bg-accent-soft")}>
              <button
                type="button"
                aria-label={`Слушать: ${c.title}`}
                onClick={() => player.open(book, { index: c.index, time: c.start })}
                className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-accent-ink hover:bg-surface-2"
              >
                <Play className="size-4 fill-current" />
              </button>
              <span className="num w-7 shrink-0 text-sm text-faint">{i + 1}</span>
              <span className={cn("min-w-0 flex-1 truncate", active && "font-semibold text-accent-ink")}>{c.title}</span>
              <span className="num text-sm text-muted">{formatTime(c.end - c.start)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function BookPage() {
  const { id } = useParams<{ id: string }>();
  const bookId = Number(id);
  const query = useQuery(["book", bookId], () => api.books.get(bookId));
  const [deleting, setDeleting] = useState(false);

  if (query.isLoading) return <PageLoader />;
  if (query.error) return <ErrorBox error={query.error} />;
  const book = query.data!;
  const audio = book.kind === "audio";
  const size = audio
    ? `${formatDuration(book.duration)} · ${book.files.length} ${book.files.length === 1 ? "файл" : "файлов"}`
    : book.pages
      ? pagesLabel(book.pages)
      : null;

  const remove = async () => {
    const shared = book.library?.scope === "shared";
    const ok = await dialogs.confirm({
      title: "Удалить книгу?",
      text: `«${book.title}» удалится вместе с ${audio ? "файлами аудиокниги" : "файлом"} на сервере${shared ? " — у всех, у кого есть доступ к общей медиатеке, вместе с их прогрессом" : ""}. Вернуть не получится.`,
      action: "Удалить",
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.books.remove(book.id);
      if (player.bookId() === book.id) player.close();
      invalidate(["home"], ["books"], ["facets"], ["libraries"], ["shelves"], ["shelf"], ["admin", "libraries"]);
      toast.success(`Книга «${book.title}» удалена`);
      if (window.history.length > 1) navigate(-1);
      else navigate("/books");
    } catch (err) {
      toast.error((err as Error).message);
      setDeleting(false);
    }
  };

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
            <Button size="lg" onClick={() => player.open(book)}>
              <Headphones className="size-5" />
              {book.state.progress > 0 && book.state.status !== "finished" ? `Продолжить · ${percent(book.state.progress)}` : "Слушать"}
            </Button>
          ) : canRead(book) ? (
            <Link to={`/read/${book.id}`} className={buttonClass("primary", "lg")}>
              <BookOpen className="size-5" /> {book.state.progress > 0 && book.state.status !== "finished" ? `Продолжить · ${percent(book.state.progress)}` : "Читать"}
            </Link>
          ) : (
            <div className="flex flex-col gap-1.5">
              <a href={fileUrl(book.id, book.format, true)} className={buttonClass("primary", "lg", "w-full")}>
                <Download className="size-5" /> Скачать
              </a>
              <span className="text-center text-xs text-muted">Формат {book.format.toUpperCase()} пока открывается только в другом приложении.</span>
            </div>
          )}
          <Button variant="outline" onClick={() => dialogs.addToShelf([book.id])}>
            <LibraryBig className="size-4" /> На полку
          </Button>
          <OfflineButton book={book} />
          {book.can_edit && (
            <Button variant="ghost" onClick={() => dialogs.editBook(book)}>
              <Pencil className="size-4" /> Изменить карточку
            </Button>
          )}
          {book.can_delete && (
            <Button variant="ghost" onClick={remove} disabled={deleting} className="text-danger hover:text-danger">
              {deleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash className="size-4" />} Удалить книгу
            </Button>
          )}
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
            <h2 className="title-display text-2xl">{audio ? (book.chapters.length > 1 ? "Главы" : "Файлы") : "Форматы"}</h2>
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

      <BookNotes book={book} />

      {book.series_books.length > 0 && (
        <Section title={`Серия «${book.series}»`} link={`/books?series=${encodeURIComponent(book.series)}`}>
          <BookGrid books={book.series_books} />
        </Section>
      )}
    </div>
  );
}

/** Закладки и цитаты пользователя в этой книге */
function BookNotes({ book }: { book: BookDetail }) {
  const notes = useAnnotations(book.id);
  const items = [...notes.list].sort((a, b) => a.progress - b.progress);
  if (!items.length) return null;
  const go = (position: string) => {
    if (book.kind === "audio") player.jump(book, position);
    else navigate(`/read/${book.id}${position.startsWith("epubcfi(") ? `?at=${encodeURIComponent(position)}` : ""}`);
  };
  const quotes = items.filter((a) => a.kind === "quote").length;
  return (
    <Section title="Закладки и цитаты" link={quotes ? `/quotes?q=${encodeURIComponent(book.title)}` : undefined} linkLabel={quotes ? "Все цитаты" : undefined}>
      <ul className="grid gap-3 md:grid-cols-2">
        {items.slice(0, 40).map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => go(a.position)} className="card flex h-full w-full flex-col gap-2 p-4 text-left transition hover:-translate-y-0.5">
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                {a.kind === "bookmark" ? <Bookmark className="size-3.5 text-accent-ink" /> : <Quote className="size-3.5" style={{ color: colorValue(a.color) }} />}
                <span className="truncate">{whereLabel(a)}</span>
              </span>
              {a.text && (
                <span
                  className={cn("line-clamp-5 leading-relaxed", a.kind === "quote" && "border-l-[3px] pl-3 font-serif")}
                  style={a.kind === "quote" ? { borderColor: colorValue(a.color), fontFamily: "Literata, Georgia, serif" } : undefined}
                >
                  {a.text}
                </span>
              )}
              {a.note && (
                <span className="flex gap-1.5 text-sm text-muted">
                  <NotebookPen className="mt-0.5 size-3.5 shrink-0" /> {a.note}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
