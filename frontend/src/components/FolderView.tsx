/** Медиатека по папкам — как в проводнике: путь сверху, папки плитками, ниже — книги этой папки. */
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { navigate } from "@/lib/router";
import { countLabel } from "@/lib/utils";
import { BookGrid } from "./books";
import { ChevronRight, Folder, FolderOpen } from "./icons";
import { Empty, ErrorBox, PageLoader } from "./ui/misc";

export function FolderView({ libraryId, path }: { libraryId: number; path: string }) {
  const listing = useQuery(["folders", libraryId, path], () => api.folders(libraryId, path));
  const books = useQuery(["books", "folder", libraryId, path], () => api.books.list({ library: libraryId, folder: path || "/", sort: "folder", limit: 1000 }));
  // переход по папке — новая запись в истории: «назад» поднимается на уровень выше
  const go = (p: string) => {
    const params = new URLSearchParams(window.location.search);
    if (p) params.set("path", p);
    else params.delete("path");
    const qs = params.toString();
    navigate(window.location.pathname + (qs ? `?${qs}` : ""));
  };

  if (listing.isLoading) return <PageLoader />;
  if (listing.error) return <ErrorBox error={listing.error} />;
  const data = listing.data!;
  const parts = path ? path.split("/") : [];

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Путь" className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" onClick={() => go("")} className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold hover:bg-surface-2">
          <FolderOpen className="size-4 text-accent-ink" /> {data.library?.name ?? "Медиатека"}
        </button>
        {parts.map((name, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="size-4 text-faint" />
            <button
              type="button"
              onClick={() => go(parts.slice(0, i + 1).join("/"))}
              aria-current={i === parts.length - 1 ? "page" : undefined}
              className="rounded-lg px-2 py-1 font-semibold hover:bg-surface-2 aria-[current=page]:text-accent-ink"
            >
              {name}
            </button>
          </span>
        ))}
      </nav>

      {data.folders.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
          {data.folders.map((f) => (
            <li key={f.path}>
              <button type="button" onClick={() => go(f.path)} className="card flex w-full items-center gap-3 px-4 py-3 text-left transition hover:-translate-y-0.5">
                <Folder className="size-6 shrink-0 text-accent-ink" strokeWidth={1.7} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{f.name}</span>
                  <span className="text-[13px] text-muted">{countLabel(f.count, "книга", "книги", "книг")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {books.error ? (
        <ErrorBox error={books.error} />
      ) : books.data && books.data.items.length > 0 ? (
        <BookGrid books={books.data.items} />
      ) : books.data && data.folders.length === 0 ? (
        <div className="card">
          <Empty icon={<Folder />} title="Папка пуста" text="Здесь нет книг — ни в самой папке, ни во вложенных." />
        </div>
      ) : null}
    </div>
  );
}

/** Книги, сгруппированные по папкам (сортировка «По папкам»). */
export function BooksByFolder({ books, libraryNames }: { books: Parameters<typeof BookGrid>[0]["books"]; libraryNames: Map<number, string> }) {
  const groups: { key: string; library: number; folder: string; items: typeof books }[] = [];
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
            <span className="truncate">
              {many && `${libraryNames.get(g.library) ?? "Медиатека"} / `}
              {g.folder ? g.folder.split("/").join(" / ") : "Без папки"}
            </span>
          </h2>
          <BookGrid books={g.items} />
        </section>
      ))}
    </div>
  );
}
