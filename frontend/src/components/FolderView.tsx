/** Раздел «Папки»: подключённые папки (медиатеки) и навигация по ним как в проводнике —
 *  путь сверху, подпапки, ниже книги этой папки; книгу можно сразу читать или слушать. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Book, type FolderEntry, type MyLibrary } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canRead } from "@/lib/bookSources";
import { authorsText, formatDuration, percent } from "@/lib/format";
import { player, usePlayer } from "@/lib/player";
import { invalidate, useQuery } from "@/lib/query";
import { Link, navigate } from "@/lib/router";
import { toast } from "@/lib/toast";
import { cn, countLabel } from "@/lib/utils";
import { BookCover, BookGrid, StatusChip } from "./books";
import { PageHeader } from "./Section";
import { Button } from "./ui/button";
import {
  BookOpen,
  ChevronRight,
  Folder,
  FolderOpen,
  Headphones,
  LayoutGrid,
  ListMusic,
  Lock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Users,
  X,
} from "./icons";
import { Empty, ErrorBox, PageLoader, Spinner } from "./ui/misc";

type ViewMode = "grid" | "list";
const VIEW_KEY = "sr-folder-view";

function useViewMode(): [ViewMode, (v: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const set = (v: ViewMode) => {
    setMode(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* браузер без хранилища — вид просто не запомнится */
    }
  };
  return [mode, set];
}

export function folderUrl(libraryId: number, path = "") {
  return `/folders/${libraryId}${path ? `?path=${encodeURIComponent(path)}` : ""}`;
}

/** «12 книг · 3 аудио» */
function contentLabel(ebooks: number, audio: number) {
  const parts: string[] = [];
  if (ebooks) parts.push(countLabel(ebooks, "книга", "книги", "книг"));
  if (audio) parts.push(countLabel(audio, "аудиокнига", "аудиокниги", "аудиокниг"));
  return parts.join(" · ") || "пусто";
}

/** Открыть книгу сразу: аудио — в плеере с сохранённого места, электронную — в читалке. */
async function launch(book: Book) {
  if (book.kind === "audio") {
    if (player.bookId() === book.id) {
      player.toggle();
      return;
    }
    try {
      player.open(await api.books.get(book.id));
    } catch (err) {
      toast.error((err as Error).message);
    }
  } else if (canRead(book)) navigate(`/read/${book.id}`);
  else navigate(`/books/${book.id}`);
}

function started(book: Book) {
  return book.state.progress > 0 && book.state.status !== "finished";
}

function actionLabel(book: Book) {
  if (book.kind === "audio") return started(book) ? "Продолжить" : "Слушать";
  if (!canRead(book)) return "Открыть";
  return started(book) ? "Продолжить" : "Читать";
}

/** Кнопка «▶ / читать» для книги в папке */
function LaunchButton({ book, size = "md", className }: { book: Book; size?: "sm" | "md"; className?: string }) {
  const s = usePlayer();
  const playing = book.kind === "audio" && s.book?.id === book.id && s.playing;
  const Icon = book.kind === "audio" ? (playing ? Pause : Play) : BookOpen;
  return (
    <button
      type="button"
      aria-label={`${playing ? "Пауза" : actionLabel(book)}: ${book.title}`}
      title={playing ? "Пауза" : actionLabel(book)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void launch(book);
      }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg shadow-card transition hover:brightness-110 active:scale-95",
        size === "sm" ? "size-9" : "size-11",
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-4" : "size-5"} fill={book.kind === "audio" ? "currentColor" : "none"} />
    </button>
  );
}

// ---------------- корень: все подключённые папки ----------------

export function FoldersRoot() {
  const { user } = useAuth();
  const libraries = useQuery(["libraries"], api.libraries);
  const [view, setView] = useViewMode();

  if (libraries.isLoading) return <PageLoader />;
  if (libraries.error) return <ErrorBox error={libraries.error} />;
  const libs = libraries.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Папки"
        subtitle={libs.length ? countLabel(libs.length, "подключённая папка", "подключённые папки", "подключённых папок") : undefined}
        actions={libs.length > 0 && <ViewToggle value={view} onChange={setView} />}
      />
      {libs.length === 0 ? (
        <div className="card">
          <Empty
            icon={<Folder />}
            title="Папок пока нет"
            text={user?.is_admin ? "Подключите папку с книгами на сервере — она появится здесь." : "Администратор ещё не открыл вам ни одной медиатеки."}
          />
          {user?.is_admin && (
            <div className="flex justify-center pb-8">
              <Link to="/admin?tab=libraries&new=1" className="flex items-center gap-2 font-semibold text-accent-ink hover:underline">
                <Plus className="size-4" /> Добавить медиатеку
              </Link>
            </div>
          )}
        </div>
      ) : (
        <FolderList
          view={view}
          items={libs.map((lib: MyLibrary) => ({
            key: String(lib.id),
            name: lib.name,
            to: folderUrl(lib.id),
            ebooks: lib.book_count,
            audio: lib.audio_count,
            icon: lib.scope === "personal" ? Lock : Users,
            hint: lib.scope === "personal" ? "личная" : "общая",
          }))}
        />
      )}
    </div>
  );
}

// ---------------- папка медиатеки ----------------

export function FolderView({ libraryId, path }: { libraryId: number; path: string }) {
  const [view, setView] = useViewMode();
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(300);
  const [scanning, setScanning] = useState(false);
  const listing = useQuery(["folders", libraryId, path], () => api.folders(libraryId, path));
  const books = useQuery(["books", "folder", libraryId, path, limit], () =>
    api.books.list({ library: libraryId, folder: path || "/", sort: "folder", limit }),
  );
  // пока идёт сканирование — спрашиваем статус; закончилось — обновляем папку
  const scan = useQuery(["scan-status", libraryId], () => api.scanStatus(libraryId), { enabled: scanning, refetchInterval: scanning ? 2000 : undefined, staleTime: 0 });
  useEffect(() => {
    if (scanning && scan.data && !scan.data.running) {
      setScanning(false);
      invalidate(["folders", libraryId], ["books"], ["libraries"]);
      toast.success("Папка просканирована");
    }
  }, [scanning, scan.data, libraryId]);
  // новая папка — фильтр и «показать ещё» сбрасываются
  useEffect(() => {
    setFilter("");
    setLimit(300);
  }, [libraryId, path]);

  const needle = filter.trim().toLowerCase();
  const folders = useMemo(
    () => (listing.data?.folders ?? []).filter((f) => !needle || f.name.toLowerCase().includes(needle)),
    [listing.data, needle],
  );
  const items = useMemo(
    () =>
      (books.data?.items ?? []).filter(
        (b) => !needle || b.title.toLowerCase().includes(needle) || b.authors.some((a) => a.toLowerCase().includes(needle)) || b.series.toLowerCase().includes(needle),
      ),
    [books.data, needle],
  );

  if (listing.isLoading) return <PageLoader />;
  if (listing.error) return <ErrorBox error={listing.error} />;
  const data = listing.data!;
  const lib = data.library;
  const parts = path ? path.split("/") : [];
  const title = parts.length ? parts[parts.length - 1] : lib.name;
  const total = data.folders.length + data.books_here;

  const startScan = async () => {
    try {
      await api.scanFolder(libraryId, path);
      setScanning(true);
      toast.info("Сканирование запущено");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Путь" className="-mb-3 flex flex-wrap items-center gap-0.5 text-sm">
        <Link to="/folders" className="rounded-lg px-2 py-1 font-semibold text-muted hover:bg-surface-2 hover:text-fg">
          Папки
        </Link>
        <ChevronRight className="size-4 text-faint" />
        <Crumb to={folderUrl(libraryId)} current={!parts.length}>
          <FolderOpen className="size-4 text-accent-ink" /> {lib.name}
        </Crumb>
        {parts.map((name, i) => (
          <span key={i} className="flex items-center gap-0.5">
            <ChevronRight className="size-4 text-faint" />
            <Crumb to={folderUrl(libraryId, parts.slice(0, i + 1).join("/"))} current={i === parts.length - 1}>
              {name}
            </Crumb>
          </span>
        ))}
      </nav>

      <PageHeader
        title={title}
        subtitle={
          <>
            {parts.length === 0 && (lib.scope === "personal" ? "Личная медиатека · " : "Общая медиатека · ")}
            {data.folders.length > 0 && `${countLabel(data.folders.length, "папка", "папки", "папок")} · `}
            {contentLabel(data.here.ebook, data.here.audio)}
            {data.folders.length > 0 && data.books_here === 0 && " прямо здесь"}
          </>
        }
        actions={
          <>
            {lib.can_scan && (
              <Button variant="outline" size="sm" onClick={startScan} disabled={scanning} title="Найти новые и изменённые книги в этой папке">
                {scanning ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
                {scanning ? (scan.data?.this_library && scan.data.total ? `${scan.data.done} из ${scan.data.total}` : "Сканирую…") : "Сканировать"}
              </Button>
            )}
            <ViewToggle value={view} onChange={setView} />
          </>
        }
      />

      {data.continue && <ContinueCard book={data.continue} />}

      {total > 12 && (
        <label className="flex h-11 max-w-md items-center gap-2 rounded-xl border bg-surface px-3.5 focus-within:border-accent">
          <Search className="size-[18px] shrink-0 text-muted" />
          <span className="sr-only">Найти в папке</span>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Найти в этой папке…"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
          />
          {filter && (
            <button type="button" aria-label="Очистить" onClick={() => setFilter("")} className="text-faint hover:text-fg">
              <X className="size-4" />
            </button>
          )}
        </label>
      )}

      {folders.length > 0 && (
        <FolderList
          view={view}
          items={folders.map((f: FolderEntry) => ({
            key: f.path,
            name: f.name,
            to: folderUrl(libraryId, f.path),
            ebooks: f.ebooks,
            audio: f.audio,
            icon: f.audio && !f.ebooks ? Headphones : Folder,
          }))}
        />
      )}

      {books.error ? (
        <ErrorBox error={books.error} />
      ) : items.length > 0 ? (
        <>
          {folders.length > 0 && <h2 className="-mb-2 text-[15px] font-semibold text-muted">Книги в этой папке</h2>}
          {view === "grid" ? (
            <BookGrid books={[]}>
              {items.map((b) => (
                <FolderBookTile key={b.id} book={b} />
              ))}
            </BookGrid>
          ) : (
            <ul className="card flex flex-col divide-y">
              {items.map((b) => (
                <FolderBookRow key={b.id} book={b} />
              ))}
            </ul>
          )}
          {!needle && books.data && books.data.total > books.data.items.length && (
            <Button variant="outline" className="self-center" onClick={() => setLimit((n) => n + 300)}>
              Показать ещё · {books.data.total - books.data.items.length}
            </Button>
          )}
        </>
      ) : needle && folders.length === 0 ? (
        <p className="text-muted">В этой папке ничего не нашлось по запросу «{filter.trim()}».</p>
      ) : books.data && data.folders.length === 0 ? (
        <div className="card">
          <Empty
            icon={<Folder />}
            title={data.exists ? "Папка пуста" : "Папка не найдена"}
            text={
              data.exists
                ? "Здесь нет книг — ни в самой папке, ни во вложенных."
                : "Её переименовали или она ещё не просканирована. Нажмите «Сканировать», если книги только что добавлены."
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function Crumb({ to, current, children }: { to: string; current: boolean; children: ReactNode }) {
  return (
    <Link
      to={to}
      aria-current={current ? "page" : undefined}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold hover:bg-surface-2 aria-[current=page]:text-accent-ink"
    >
      {children}
    </Link>
  );
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Вид" className="flex gap-1 rounded-xl bg-surface-2 p-1">
      {(
        [
          ["grid", "Плитки", LayoutGrid],
          ["list", "Список", ListMusic],
        ] as const
      ).map(([v, label, Icon]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          aria-label={label}
          title={label}
          onClick={() => onChange(v)}
          className={cn("flex size-8 items-center justify-center rounded-lg", value === v ? "bg-surface shadow-card" : "text-muted hover:text-fg")}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}

type FolderItem = {
  key: string;
  name: string;
  to: string;
  ebooks: number;
  audio: number;
  icon: typeof Folder;
  hint?: string;
};

function FolderList({ items, view }: { items: FolderItem[]; view: ViewMode }) {
  if (view === "list") {
    return (
      <ul className="card flex flex-col divide-y">
        {items.map(({ key, name, to, ebooks, audio, icon: Icon, hint }) => (
          <li key={key}>
            <Link to={to} className="flex min-h-14 items-center gap-3.5 px-4 py-2 text-fg hover:bg-surface-2">
              <Icon className="size-5 shrink-0 text-accent-ink" strokeWidth={1.7} />
              <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
              <span className="hidden shrink-0 text-[13px] text-muted sm:block">
                {hint && `${hint} · `}
                {contentLabel(ebooks, audio)}
              </span>
              <ChevronRight className="size-4 shrink-0 text-faint" />
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
      {items.map(({ key, name, to, ebooks, audio, icon: Icon, hint }) => (
        <li key={key}>
          <Link to={to} className="card flex w-full items-center gap-3 px-4 py-3 text-left text-fg transition hover:-translate-y-0.5">
            <Icon className="size-6 shrink-0 text-accent-ink" strokeWidth={1.7} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{name}</span>
              <span className="block truncate text-[13px] text-muted">
                {hint && `${hint} · `}
                {contentLabel(ebooks, audio)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** «Продолжить в этой папке» */
function ContinueCard({ book }: { book: Book }) {
  const audio = book.kind === "audio";
  return (
    <div className="card flex items-center gap-4 p-3 pr-4">
      <Link to={`/books/${book.id}`} className="w-[52px] shrink-0">
        <BookCover book={book} size="sm" badge={false} />
      </Link>
      <Link to={`/books/${book.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5 text-fg">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
          {audio && <Headphones className="size-3.5" />}
          Продолжить {audio ? "слушать" : "читать"} · {percent(book.state.progress)}
        </span>
        <span className="truncate font-semibold">{book.title}</span>
        <span className="truncate text-[13px] text-muted">{book.state.chapter || authorsText(book.authors)}</span>
      </Link>
      <LaunchButton book={book} />
    </div>
  );
}

/** Книга плиткой: как в сетке, плюс кнопка «читать / слушать» на обложке. */
function FolderBookTile({ book }: { book: Book }) {
  const progress = started(book);
  return (
    <Link to={`/books/${book.id}`} className="group flex min-w-0 flex-col gap-2 text-fg">
      <div className="relative transition group-hover:-translate-y-0.5">
        <BookCover book={book} />
        <LaunchButton book={book} size="sm" className="absolute right-2 bottom-2" />
      </div>
      {progress && (
        <span className="block h-1 overflow-hidden rounded-full bg-surface-3">
          <span className="block h-full rounded-full bg-accent" style={{ width: percent(book.state.progress) }} />
        </span>
      )}
      <span className="line-clamp-2 leading-snug font-semibold">{book.title}</span>
      <span className="-mt-1.5 line-clamp-1 text-[13px] text-muted">{authorsText(book.authors)}</span>
      {book.state.status !== "none" && <StatusChip status={book.state.status} kind={book.kind} className="self-start" />}
    </Link>
  );
}

/** Книга строкой списка */
function FolderBookRow({ book }: { book: Book }) {
  const audio = book.kind === "audio";
  const meta = audio ? (book.duration ? formatDuration(book.duration) : "аудио") : book.formats.map((f) => f.toUpperCase()).join(", ");
  return (
    <li className="flex items-center gap-3.5 px-4 py-2.5">
      <Link to={`/books/${book.id}`} className="w-10 shrink-0">
        <BookCover book={book} size="sm" badge={false} />
      </Link>
      <Link to={`/books/${book.id}`} className="flex min-w-0 flex-1 flex-col text-fg">
        <span className="truncate font-semibold">{book.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
          {audio && <Headphones className="size-3.5 shrink-0" />}
          <span className="truncate">
            {[authorsText(book.authors), meta, started(book) ? percent(book.state.progress) : ""].filter(Boolean).join(" · ")}
          </span>
        </span>
      </Link>
      <LaunchButton book={book} size="sm" />
    </li>
  );
}

/** Книги, сгруппированные по папкам (сортировка «По папкам»). */
export function BooksByFolder({ books, libraryNames }: { books: Book[]; libraryNames: Map<number, string> }) {
  const groups: { key: string; library: number; folder: string; items: Book[] }[] = [];
  for (const b of books) {
    const key = `${b.library_id}:${b.folder}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(b);
    else groups.push({ key, library: b.library_id, folder: b.folder, items: [b] });
  }
  const many = new Set(groups.map((g) => g.library)).size > 1;
  return (
    <div className="flex flex-col gap-8">
      {groups.map((g, i) => (
        <section key={`${g.key}-${i}`} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-muted">
            <Folder className="size-4 shrink-0 text-accent-ink" />
            <Link to={folderUrl(g.library, g.folder)} className="truncate hover:text-fg hover:underline">
              {many && `${libraryNames.get(g.library) ?? "Медиатека"} / `}
              {g.folder ? g.folder.split("/").join(" / ") : "Без папки"}
            </Link>
          </h2>
          <BookGrid books={g.items} />
        </section>
      ))}
    </div>
  );
}
