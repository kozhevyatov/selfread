import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookGrid } from "@/components/books";
import { BooksByFolder, FolderView } from "@/components/FolderView";
import { Book as BookIcon, CloudUpload, Folder, Headphones, LayoutGrid, Search, X } from "@/components/icons";
import { dialogs } from "@/lib/dialogs";
import { PageHeader } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Empty, ErrorBox, PageLoader, Spinner } from "@/components/ui/misc";
import { api, type BookKind, type ReadStatus } from "@/lib/api";
import { booksLabel } from "@/lib/format";
import { useQuery } from "@/lib/query";
import { Link, setSearchParam, useParams, useSearchParams } from "@/lib/router";
import { cn } from "@/lib/utils";

const PAGE = 60;

const SORTS = [
  { value: "added", label: "Сначала новые" },
  { value: "title", label: "По названию" },
  { value: "author", label: "По автору" },
  { value: "series", label: "По серии" },
  { value: "year", label: "По году" },
  { value: "folder", label: "По папкам" },
];

const STATUS_FILTERS: { value: ReadStatus | ""; label: string }[] = [
  { value: "", label: "Все" },
  { value: "reading", label: "Читаю" },
  { value: "want", label: "Хочу прочитать" },
  { value: "finished", label: "Прочитано" },
  { value: "none", label: "Не начаты" },
  { value: "abandoned", label: "Брошено" },
];

/**
 * Список книг с фильтрами. Один компонент на несколько разделов:
 * «Все книги» (/books), «Аудиокниги» (/audio), медиатека (/libraries/:id), поиск (/search).
 * Фильтры живут в адресе — их можно сохранить в закладки и вернуться кнопкой «назад».
 */
export default function BooksPage({ mode = "all" }: { mode?: "all" | "ebook" | "audio" | "library" | "search" }) {
  const params = useSearchParams();
  const { id } = useParams<{ id: string }>();
  const libraryId = mode === "library" ? Number(id) : undefined;
  const q = params.get("q") ?? "";
  const status = (params.get("status") ?? "") as ReadStatus | "";
  const format = params.get("format") ?? "";
  const author = params.get("author") ?? "";
  const series = params.get("series") ?? "";
  const sort = params.get("sort") ?? (series ? "series" : "added");
  // в медиатеке: обычный список или «Папки» — навигация как в проводнике
  const folderView = mode === "library" && params.get("view") === "folders";
  const folderPath = params.get("path") ?? "";
  const kind: BookKind | "" = mode === "audio" ? "audio" : mode === "ebook" ? "ebook" : ((params.get("kind") ?? "") as BookKind | "");
  const [limit, setLimit] = useState(PAGE);
  const [query, setQuery] = useState(q);

  const filterKey = JSON.stringify({ q, status, format, author, series, sort, kind, libraryId });
  useEffect(() => setLimit(PAGE), [filterKey]);
  useEffect(() => setQuery(q), [q]);

  const libraries = useQuery(["libraries"], api.libraries);
  const targets = useQuery(["upload-targets"], api.uploads.targets, { staleTime: 5 * 60_000 });
  const facets = useQuery(["facets"], api.books.facets);
  const list = useQuery(
    ["books", filterKey, limit],
    () => api.books.list({ q, status, format, author, series, sort, kind, library: libraryId, limit }),
    { enabled: !folderView },
  );

  // при «Показать ещё» и смене фильтров не мигаем загрузкой — держим прошлый список, пока идёт запрос
  const last = useRef<{ key: string; data: typeof list.data }>({ key: "", data: undefined });
  if (list.data) last.current = { key: filterKey, data: list.data };
  const data = list.data ?? (last.current.key === filterKey ? last.current.data : undefined);

  const library = libraries.data?.find((l) => l.id === libraryId);
  const title =
    mode === "audio" ? "Аудиокниги" : mode === "ebook" && !series && !author ? "Электронные книги" : mode === "library" ? (library?.name ?? "Медиатека") : mode === "search" ? "Поиск" : series ? series : author ? author : "Все книги";
  const formats = Object.entries(facets.data?.formats ?? {})
    .filter(([f]) => {
      const isAudio = ["mp3", "m4b", "m4a", "ogg", "opus", "flac", "aac", "wav", "oga"].includes(f);
      return mode === "audio" ? isAudio : mode === "ebook" ? !isAudio : true;
    })
    .sort((a, b) => b[1] - a[1]);

  const searchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSearchParam("q", query.trim() || null);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        actions={
          targets.data?.length ? (
            <Button onClick={() => dialogs.upload(mode === "library" && targets.data?.some((t) => t.id === libraryId) ? libraryId : undefined)}>
              <CloudUpload className="size-4" /> Загрузить
            </Button>
          ) : undefined
        }
        subtitle={
          data ? (
            <>
              {booksLabel(data.total)}
              {mode === "library" && library && <> · {library.scope === "personal" ? "личная медиатека" : "общая медиатека"}</>}
              {(series || author) && mode === "all" && (
                <>
                  {" · "}
                  <Link to="/books" className="font-semibold text-accent-ink hover:underline">
                    все книги
                  </Link>
                </>
              )}
            </>
          ) : undefined
        }
      />

      {mode === "library" && (
        <div role="tablist" aria-label="Вид" className="-mt-2 flex gap-1 self-start rounded-xl bg-surface-2 p-1">
          {(
            [
              [false, "Все книги", LayoutGrid],
              [true, "Папки", Folder],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={folderView === v}
              onClick={() => {
                setSearchParam("path", null);
                setSearchParam("view", v ? "folders" : null);
              }}
              className={cn("flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold", folderView === v ? "bg-surface shadow-sm" : "text-muted hover:text-fg")}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      )}

      {folderView && libraryId ? (
        <FolderView libraryId={libraryId} path={folderPath} />
      ) : (
      <>
      <div className="flex flex-col gap-3">
        <form onSubmit={searchSubmit} role="search" className="flex flex-wrap gap-3">
          <label className="flex h-11 min-w-0 flex-1 basis-64 items-center gap-2 rounded-xl border bg-surface px-3.5 focus-within:border-accent">
            <Search className="size-[18px] shrink-0 text-muted" />
            <span className="sr-only">Поиск</span>
            <input
              type="search"
              value={query}
              autoFocus={mode === "search"}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === "audio" ? "Название, автор, чтец…" : "Название, автор, серия…"}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
            />
            {query && (
              <button type="button" aria-label="Очистить" onClick={() => (setQuery(""), setSearchParam("q", null))} className="text-faint hover:text-fg">
                <X className="size-4" />
              </button>
            )}
          </label>
          <div className="flex gap-3">
            {formats.length > 1 && (
              <Select aria-label="Формат" value={format} onChange={(e) => setSearchParam("format", e.target.value || null)} className="w-44">
                <option value="">Все форматы</option>
                {formats.map(([f, n]) => (
                  <option key={f} value={f}>
                    {f.toUpperCase()} · {n}
                  </option>
                ))}
              </Select>
            )}
            <Select aria-label="Сортировка" value={sort} onChange={(e) => setSearchParam("sort", e.target.value)} className="w-44">
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        </form>

        <div role="radiogroup" aria-label="Статус" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={status === s.value}
              onClick={() => setSearchParam("status", s.value || null)}
              className={cn(
                "h-9 shrink-0 rounded-[10px] border px-3.5 text-[13px] font-semibold whitespace-nowrap transition",
                status === s.value ? "border-accent bg-accent-soft text-accent-ink" : "bg-surface text-muted hover:text-fg",
              )}
            >
              {s.label}
            </button>
          ))}
          {mode === "all" && (
            <button
              type="button"
              aria-pressed={kind === "ebook"}
              onClick={() => setSearchParam("kind", kind === "ebook" ? null : "ebook")}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-3.5 text-[13px] font-semibold whitespace-nowrap transition sm:ml-auto",
                kind === "ebook" ? "border-accent bg-accent-soft text-accent-ink" : "bg-surface text-muted hover:text-fg",
              )}
            >
              <BookIcon className="size-4" /> Только электронные
            </button>
          )}
        </div>
      </div>

      {!data && list.error ? (
        <ErrorBox error={list.error} />
      ) : !data ? (
        <PageLoader />
      ) : data.items.length === 0 ? (
        <div className="card">
          <Empty
            icon={mode === "audio" ? <Headphones /> : <BookIcon />}
            title={q || status || format ? "Ничего не нашлось" : mode === "audio" ? "Аудиокниг пока нет" : "Книг пока нет"}
            text={
              q || status || format
                ? "Попробуйте изменить запрос или сбросить фильтры."
                : "Книги появятся после сканирования медиатеки. Подойдут EPUB, FB2, MOBI, AZW3, PDF, DjVu, комиксы и аудиокниги."
            }
          />
        </div>
      ) : (
        <>
          {sort === "folder" ? <BooksByFolder books={data.items} libraryNames={new Map((libraries.data ?? []).map((l) => [l.id, l.name]))} /> : <BookGrid books={data.items} />}
          {data.items.length < data.total && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)} disabled={list.isFetching}>
                {list.isFetching && <Spinner className="size-4" />} Показать ещё
              </Button>
            </div>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}
