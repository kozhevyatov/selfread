import { useEffect, useState } from "react";
import { api, type FsListing } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ArrowLeft, Check, ChevronRight, Folder, FolderOpen, TriangleAlert } from "./icons";
import { Spinner } from "./ui/misc";

/** Обзор папок внутри контейнера (MEDIA_ROOT): выбрать папку с книгами мышкой, а не вводить путь. */
export function FolderBrowser({ value, onChange }: { value: string; onChange: (absPath: string, name: string) => void }) {
  const [path, setPath] = useState("");
  const [data, setData] = useState<FsListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    api.admin
      .browse(path)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError((err as Error).message));
    return () => {
      alive = false;
    };
  }, [path]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <Spinner />;
  if (!data.root_exists)
    return (
      <div className="flex gap-3 rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm leading-relaxed">
        <TriangleAlert className="size-5 shrink-0 text-danger" />
        <span>
          Папка <code className="font-bold">{data.root}</code> не найдена внутри контейнера. Подключите папки с книгами в docker-compose,
          например <code className="font-bold">/volume2/books:/library/books:ro</code>, и перезапустите контейнер.
        </span>
      </div>
    );

  const crumbs = data.path ? data.path.split("/") : [];
  const current = data.abs_path ?? data.root;
  const name = crumbs[crumbs.length - 1] ?? "";

  return (
    <div className="overflow-hidden rounded-2xl border">
      <div className="flex items-center gap-1 border-b bg-surface-2/60 px-2 py-2 text-sm">
        <button
          type="button"
          aria-label="Назад"
          disabled={data.parent === null}
          onClick={() => setPath(data.parent ?? "")}
          className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg disabled:opacity-30"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto font-semibold whitespace-nowrap">
          <button type="button" onClick={() => setPath("")} className="rounded px-1 text-muted hover:text-fg">
            {data.root}
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-faint" />
              <button type="button" onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))} className="rounded px-1 hover:text-accent-ink">
                {c}
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto p-1.5">
        {data.dirs.length === 0 && <p className="px-3 py-4 text-sm text-faint">Подпапок нет</p>}
        {data.dirs.map((d) => (
          <button
            type="button"
            key={d}
            onClick={() => setPath(data.path ? `${data.path}/${d}` : d)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[15px] font-semibold hover:bg-surface-2"
          >
            <Folder className="size-5 text-accent-ink" />
            <span className="flex-1 truncate">{d}</span>
            <ChevronRight className="size-4 text-faint" />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t bg-surface-2/60 px-4 py-3">
        <FolderOpen className="size-5 text-muted" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="truncate font-bold">{current}</div>
          <div className="text-xs text-faint">{data.book_files ? `${data.book_files} файлов книг прямо в этой папке` : "Подпапки тоже будут просканированы"}</div>
        </div>
        <button
          type="button"
          disabled={!data.path}
          onClick={() => onChange(current, name)}
          className={cn(
            "flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-bold transition disabled:opacity-40",
            value === current ? "bg-success/15 text-success" : "bg-accent text-accent-fg",
          )}
        >
          {value === current && <Check className="size-4" />}
          {value === current ? "Выбрана" : "Выбрать эту папку"}
        </button>
      </div>
    </div>
  );
}
