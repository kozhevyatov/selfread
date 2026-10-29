import { useState, type FormEvent } from "react";
import { BookGrid, ReadingCard, ShelfCard } from "@/components/books";
import { Book as BookIcon, CloudUpload, FolderPlus, Plus, Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { dialogs } from "@/lib/dialogs";
import { Section } from "@/components/Section";
import { buttonClass } from "@/components/ui/button";
import { Empty, ErrorBox, PageLoader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { greeting, todayLabel } from "@/lib/format";
import { useQuery } from "@/lib/query";
import { Link, navigate } from "@/lib/router";

export function SearchBox({ initial = "", autoFocus = false, className = "" }: { initial?: string; autoFocus?: boolean; className?: string }) {
  const [q, setQ] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <form onSubmit={submit} role="search" className={className}>
      <label className="flex h-11 min-w-[260px] items-center gap-2 rounded-xl border bg-surface px-3.5 focus-within:border-accent">
        <Search className="size-[18px] shrink-0 text-muted" />
        <span className="sr-only">Поиск</span>
        <input
          type="search"
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Книга, автор, серия…"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
        />
      </label>
    </form>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const home = useQuery(["home"], api.home);
  const targets = useQuery(["upload-targets"], api.uploads.targets, { staleTime: 5 * 60_000 });
  const canUpload = Boolean(targets.data?.length);

  if (home.isLoading) return <PageLoader />;
  if (home.error) return <ErrorBox error={home.error} />;
  const data = home.data!;
  const empty = data.counts.total === 0;
  const continueTitle = data.reading.some((b) => b.kind === "audio") && data.reading.every((b) => b.kind === "audio") ? "Слушаю сейчас" : "Читаю сейчас";

  return (
    <div className="flex flex-col gap-9">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{todayLabel()}</p>
          <h1 className="title-display mt-1 text-[30px] sm:text-[34px]">
            {data.reading.length ? "Продолжим чтение?" : `${greeting()}${user?.display_name ? `, ${user.display_name}` : ""}`}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox className="hidden sm:block" />
          {canUpload && (
            <Button onClick={() => dialogs.upload()}>
              <CloudUpload className="size-4" /> Загрузить
            </Button>
          )}
        </div>
      </header>

      {empty ? (
        <div className="card">
          <Empty
            icon={<BookIcon />}
            title="Библиотека пока пуста"
            text={
              user?.is_admin
                ? "Добавьте медиатеку — папку с книгами на сервере или личную папку пользователя. Книги и аудиокниги найдутся сами."
                : "Администратор ещё не открыл вам ни одной медиатеки с книгами."
            }
            action={
              canUpload ? (
                <Button onClick={() => dialogs.upload()}>
                  <CloudUpload className="size-4" /> Загрузить книги
                </Button>
              ) : (
                user?.is_admin && (
                <Link to="/admin?tab=libraries&new=1" className={buttonClass("primary")}>
                  <FolderPlus className="size-4" /> Добавить медиатеку
                </Link>
                )
              )
            }
          />
        </div>
      ) : (
        <>
          {data.reading.length > 0 && (
            <Section title={continueTitle} link="/books?status=reading" linkLabel={`Все · ${data.counts.reading ?? data.reading.length}`}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-4">
                {data.reading.slice(0, 6).map((b) => (
                  <ReadingCard key={b.id} book={b} />
                ))}
              </div>
            </Section>
          )}

          <Section
            title="Мои полки"
            action={
              <Link to="/shelves?new=1" className="ml-auto flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline">
                <Plus className="size-4" /> Новая полка
              </Link>
            }
          >
            {data.shelves.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                {data.shelves.slice(0, 8).map((s) => (
                  <ShelfCard key={s.id} shelf={s} />
                ))}
              </div>
            ) : (
              <p className="card px-5 py-4 text-sm text-muted">
                Полки — ваши подборки: «Классика», «Для работы», «Детям». Добавляйте книги кнопкой «На полку» на странице книги.
              </p>
            )}
          </Section>

          {data.want.length > 0 && (
            <Section title="Хочу прочитать" link="/books?status=want">
              <BookGrid books={data.want.slice(0, 12)} />
            </Section>
          )}

          <Section title="Недавно добавлены" link="/books" linkLabel="Вся библиотека">
            <BookGrid books={data.recent} />
          </Section>
        </>
      )}
    </div>
  );
}
