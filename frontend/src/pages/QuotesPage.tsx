/** Все цитаты (и закладки) со всех книг: поиск, копирование, переход к месту в книге. */
import { useEffect, useState } from "react";
import { BookCover } from "@/components/books";
import { Bookmark, Copy, NotebookPen, Quote, Search, Trash } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Empty, ErrorBox, PageLoader } from "@/components/ui/misc";
import { colorValue, removeAnnotation, whereLabel } from "@/lib/annotations";
import { api, type AnnotationWithBook } from "@/lib/api";
import { dialogs } from "@/lib/dialogs";
import { formatDate } from "@/lib/format";
import { useQuery } from "@/lib/query";
import { Link, navigate, setSearchParam, useSearchParams } from "@/lib/router";
import { toast } from "@/lib/toast";
import { cn, countLabel } from "@/lib/utils";

const PAGE = 100;

export default function QuotesPage() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const kind = (params.get("kind") === "bookmark" ? "bookmark" : "quote") as "quote" | "bookmark";
  const [query, setQuery] = useState(q);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setQuery(q), [q]);
  useEffect(() => setLimit(PAGE), [q, kind]);
  const list = useQuery(["annotations-all", q, kind, limit], () => api.annotations.all({ q, kind, limit }));

  const go = (a: AnnotationWithBook) => {
    if (!a.book) return;
    if (a.book.kind === "audio") navigate(`/books/${a.book.id}`);
    else navigate(`/read/${a.book.id}${a.position.startsWith("epubcfi(") ? `?at=${encodeURIComponent(a.position)}` : ""}`);
  };
  const copy = async (a: AnnotationWithBook) => {
    const src = a.book ? `\n— ${a.book.authors.join(", ")}${a.book.authors.length ? ", " : ""}«${a.book.title}»` : "";
    try {
      await navigator.clipboard.writeText(`${a.text}${src}${a.note ? `\n\n${a.note}` : ""}`);
      toast.success("Скопировано");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };
  const remove = async (a: AnnotationWithBook) => {
    const ok = await dialogs.confirm({ title: kind === "quote" ? "Удалить цитату?" : "Удалить закладку?", text: a.text.slice(0, 200) || a.chapter, action: "Удалить", danger: true });
    if (!ok) return;
    try {
      await removeAnnotation(a);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Выделите текст в читалке — появится панель «цитата, заметка, копировать»</p>
          <h1 className="title-display mt-1 text-[30px] sm:text-[34px]">{kind === "quote" ? "Цитаты" : "Закладки"}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="radiogroup" aria-label="Что показывать" className="flex gap-1 rounded-xl bg-surface-2 p-1">
            {(
              [
                ["quote", "Цитаты"],
                ["bookmark", "Закладки"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={kind === id}
                onClick={() => setSearchParam("kind", id === "quote" ? null : id)}
                className={cn("h-9 rounded-lg px-3 text-sm font-semibold", kind === id ? "bg-surface shadow-sm" : "text-muted hover:text-fg")}
              >
                {label}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearchParam("q", query.trim() || null);
            }}
            role="search"
          >
            <label className="flex h-11 min-w-[240px] items-center gap-2 rounded-xl border bg-surface px-3.5 focus-within:border-accent">
              <Search className="size-[18px] shrink-0 text-muted" />
              <span className="sr-only">Поиск по цитатам</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Слово, книга, автор…" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint" />
            </label>
          </form>
        </div>
      </header>

      {list.isLoading && !list.data ? (
        <PageLoader />
      ) : list.error ? (
        <ErrorBox error={list.error} />
      ) : !list.data!.items.length ? (
        <div className="card">
          <Empty
            icon={kind === "quote" ? <Quote /> : <Bookmark />}
            title={q ? "Ничего не нашлось" : kind === "quote" ? "Цитат пока нет" : "Закладок пока нет"}
            text={
              q
                ? "Попробуйте другое слово."
                : kind === "quote"
                  ? "Выделите понравившийся фрагмент в читалке и выберите цвет — цитата сохранится здесь."
                  : "Значок закладки в верхней панели читалки или кнопка «Закладка» в плеере отмечают место."
            }
          />
        </div>
      ) : (
        <>
          <p className="-mt-3 text-sm text-muted">{countLabel(list.data!.total, kind === "quote" ? "цитата" : "закладка", kind === "quote" ? "цитаты" : "закладки", kind === "quote" ? "цитат" : "закладок")}</p>
          <ul className="columns-1 gap-4 lg:columns-2 2xl:columns-3">
            {list.data!.items.map((a) => (
              <li key={a.id} className="card mb-4 flex break-inside-avoid flex-col gap-3 p-5">
                {a.text && (
                  <button type="button" onClick={() => go(a)} className="text-left">
                    <blockquote
                      className={cn("text-[17px] leading-relaxed", kind === "quote" && "border-l-4 pl-4")}
                      style={kind === "quote" ? { borderColor: colorValue(a.color), fontFamily: "Literata, Georgia, serif" } : undefined}
                    >
                      {a.text}
                    </blockquote>
                  </button>
                )}
                {a.note && (
                  <p className="flex gap-2 text-[15px] text-muted">
                    <NotebookPen className="mt-1 size-4 shrink-0" /> {a.note}
                  </p>
                )}
                <div className="flex items-center gap-3 border-t pt-3">
                  {a.book && (
                    <Link to={`/books/${a.book.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="w-9 shrink-0">
                        <BookCover book={a.book} size="sm" />
                      </div>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{a.book.title}</span>
                        <span className="block truncate text-[12px] text-muted">
                          {whereLabel(a)} · {formatDate(a.created_at)}
                        </span>
                      </span>
                    </Link>
                  )}
                  {kind === "quote" && (
                    <Button variant="ghost" size="icon-sm" aria-label="Копировать цитату" title="Копировать" onClick={() => void copy(a)}>
                      <Copy className="size-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon-sm" aria-label="Удалить" title="Удалить" onClick={() => void remove(a)}>
                    <Trash className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {list.data!.items.length < list.data!.total && (
            <Button variant="outline" className="self-center" onClick={() => setLimit((l) => l + PAGE)}>
              Показать ещё
            </Button>
          )}
        </>
      )}
    </div>
  );
}
