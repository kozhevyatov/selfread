/**
 * Правка карточки книги: название, авторы, серия, год, описание…, обложка.
 * Вкладка «Найти в интернете» — варианты из Google Books и Open Library: можно взять данные и обложку.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type BookDetail, type LookupItem } from "@/lib/api";
import { dialogs } from "@/lib/dialogs";
import { invalidate, setQueryData } from "@/lib/query";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { BookCover } from "./books";
import { Check, Globe, Image as ImageIcon, LoaderCircle, RotateCcw, Search } from "./icons";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Field, Input, Textarea } from "./ui/input";

type Form = {
  title: string;
  authors: string;
  narrator: string;
  series: string;
  series_index: string;
  year: string;
  publisher: string;
  language: string;
  isbn: string;
  subjects: string;
  description: string;
};

const LANGS = [
  ["ru", "русский"],
  ["en", "английский"],
  ["uk", "украинский"],
  ["be", "белорусский"],
  ["de", "немецкий"],
  ["fr", "французский"],
  ["es", "испанский"],
  ["it", "итальянский"],
];

function fromBook(b: BookDetail): Form {
  return {
    title: b.title,
    authors: b.authors.join(", "),
    narrator: b.narrator,
    series: b.series,
    series_index: b.series_index != null ? String(b.series_index) : "",
    year: b.year != null ? String(b.year) : "",
    publisher: b.publisher,
    language: b.language,
    isbn: b.isbn,
    subjects: b.subjects.join(", "),
    description: b.description,
  };
}

const list = (v: string) =>
  v
    .split(/[,;]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

export function EditBookDialog({ book }: { book: BookDetail }) {
  const [tab, setTab] = useState<"form" | "search">("form");
  const [form, setForm] = useState<Form>(() => fromBook(book));
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const audio = book.kind === "audio";

  useEffect(() => {
    if (!coverFile) return;
    const u = URL.createObjectURL(coverFile);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [coverFile]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const initial = fromBook(book);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.title.trim()) {
      toast.error("Название не может быть пустым");
      return;
    }
    setBusy(true);
    try {
      const patch: Parameters<typeof api.books.updateMeta>[1] = {};
      if (form.title !== initial.title) patch.title = form.title.trim();
      if (form.authors !== initial.authors) patch.authors = list(form.authors);
      if (form.subjects !== initial.subjects) patch.subjects = list(form.subjects);
      for (const k of ["narrator", "series", "publisher", "language", "isbn", "description"] as const) {
        if (form[k] !== initial[k]) patch[k] = form[k].trim();
      }
      if (form.series_index !== initial.series_index) {
        const n = Number(form.series_index.replace(",", "."));
        if (form.series_index.trim() && Number.isFinite(n)) patch.series_index = n;
        else patch.clear_series_index = true;
      }
      if (form.year !== initial.year) {
        const n = parseInt(form.year, 10);
        if (form.year.trim() && Number.isFinite(n)) patch.year = n;
        else patch.clear_year = true;
      }
      let next: BookDetail | null = null;
      if (Object.keys(patch).length) next = await api.books.updateMeta(book.id, patch);
      if (coverFile) next = await api.books.uploadCover(book.id, coverFile);
      else if (coverUrl.trim()) next = await api.books.coverFromUrl(book.id, coverUrl.trim());
      if (next) {
        setQueryData(["book", book.id], () => next!);
        invalidate(["books"], ["home"], ["shelf"], ["shelves"], ["facets"]);
        toast.success("Карточка книги сохранена");
      }
      dialogs.closeQuiet();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    const ok = await dialogs.confirm({
      title: "Вернуть данные из файла?",
      text: "Ручные правки и загруженная обложка забудутся — при сканировании данные снова возьмутся из файла книги.",
      action: "Вернуть",
    });
    if (!ok) {
      dialogs.editBook(book);
      return;
    }
    try {
      await api.books.resetMeta(book.id);
      toast.success("Готово — медиатека пересканируется, данные обновятся через минуту");
      window.setTimeout(() => invalidate(["book", book.id], ["books"], ["home"]), 8000);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const apply = (item: LookupItem, withCover: boolean) => {
    set({
      title: item.title || form.title,
      authors: item.authors.length ? item.authors.join(", ") : form.authors,
      year: item.year ? String(item.year) : form.year,
      publisher: item.publisher || form.publisher,
      isbn: item.isbn || form.isbn,
      language: item.language || form.language,
      subjects: item.subjects.length ? item.subjects.join(", ") : form.subjects,
      description: item.description || form.description,
    });
    if (withCover && item.cover) {
      setCoverFile(null);
      setCoverUrl(item.cover);
      setPreview(item.cover);
    }
    setTab("form");
    toast.success("Данные подставлены — проверьте и сохраните");
  };

  return (
    <Dialog
      open
      wide
      onClose={dialogs.closeQuiet}
      title="Карточка книги"
      description={book.locked?.length ? "Поля, исправленные вручную, сканер больше не перезаписывает." : undefined}
      footer={
        tab === "form" ? (
          <>
            {book.locked && book.locked.length > 0 && (
              <Button variant="ghost" onClick={reset} className="mr-auto">
                <RotateCcw className="size-4" /> Вернуть из файла
              </Button>
            )}
            <Button variant="ghost" onClick={dialogs.closeQuiet}>
              Отмена
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />} Сохранить
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setTab("form")}>
            Назад к карточке
          </Button>
        )
      }
    >
      <div role="tablist" className="-mt-1 mb-5 flex gap-1 rounded-xl bg-surface-2 p-1">
        {(
          [
            ["form", "Данные"],
            ["search", "Найти в интернете"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn("h-9 flex-1 rounded-lg text-sm font-semibold transition", tab === id ? "bg-surface shadow-sm" : "text-muted hover:text-fg")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "search" ? (
        <LookupPanel book={book} onApply={apply} />
      ) : (
        <form onSubmit={save} className="grid gap-5 sm:grid-cols-[150px_minmax(0,1fr)]">
          <div className="flex flex-col items-center gap-2.5">
            <div className="w-[150px]">
              {preview ? (
                <img src={preview} alt="Новая обложка" className="aspect-[2/3] w-full rounded-lg object-cover shadow-md" />
              ) : (
                <BookCover book={book} size="md" />
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} className="w-full">
              <ImageIcon className="size-4" /> Обложка…
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setCoverFile(f);
                  setCoverUrl("");
                }
                e.target.value = "";
              }}
            />
            <Input
              aria-label="Ссылка на обложку"
              placeholder="или ссылка"
              value={coverUrl}
              onChange={(e) => {
                setCoverUrl(e.target.value);
                setCoverFile(null);
                setPreview(e.target.value.startsWith("https://") ? e.target.value : null);
              }}
              className="h-9 text-sm"
            />
          </div>
          <div className="grid gap-4">
            <Field id="ed-title" label="Название">
              <Input id="ed-title" value={form.title} onChange={(e) => set({ title: e.target.value })} required maxLength={512} />
            </Field>
            <Field id="ed-authors" label="Авторы" hint="Через запятую">
              <Input id="ed-authors" value={form.authors} onChange={(e) => set({ authors: e.target.value })} />
            </Field>
            {audio && (
              <Field id="ed-narrator" label="Читает">
                <Input id="ed-narrator" value={form.narrator} onChange={(e) => set({ narrator: e.target.value })} />
              </Field>
            )}
            <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
              <Field id="ed-series" label="Серия">
                <Input id="ed-series" value={form.series} onChange={(e) => set({ series: e.target.value })} />
              </Field>
              <Field id="ed-sidx" label="Номер">
                <Input id="ed-sidx" inputMode="decimal" value={form.series_index} onChange={(e) => set({ series_index: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field id="ed-year" label="Год">
                <Input id="ed-year" inputMode="numeric" value={form.year} onChange={(e) => set({ year: e.target.value.replace(/[^\d]/g, "").slice(0, 4) })} />
              </Field>
              <Field id="ed-lang" label="Язык">
                <Input id="ed-lang" list="ed-langs" value={form.language} onChange={(e) => set({ language: e.target.value.slice(0, 16) })} />
                <datalist id="ed-langs">
                  {LANGS.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </datalist>
              </Field>
              <Field id="ed-isbn" label="ISBN">
                <Input id="ed-isbn" value={form.isbn} onChange={(e) => set({ isbn: e.target.value })} />
              </Field>
            </div>
            <Field id="ed-pub" label="Издательство">
              <Input id="ed-pub" value={form.publisher} onChange={(e) => set({ publisher: e.target.value })} />
            </Field>
            <Field id="ed-subj" label="Жанры и теги" hint="Через запятую">
              <Input id="ed-subj" value={form.subjects} onChange={(e) => set({ subjects: e.target.value })} />
            </Field>
            <Field id="ed-desc" label="Аннотация">
              <Textarea id="ed-desc" rows={6} value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <button type="submit" hidden />
          </div>
        </form>
      )}
    </Dialog>
  );
}

function LookupPanel({ book, onApply }: { book: BookDetail; onApply: (item: LookupItem, withCover: boolean) => void }) {
  const [q, setQ] = useState(`${book.title} ${book.authors[0] ?? ""}`.trim());
  const [isbn, setIsbn] = useState(book.isbn);
  const [items, setItems] = useState<LookupItem[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [withCover, setWithCover] = useState(true);

  const run = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const res = await api.books.lookup(book.id, q.trim(), isbn.trim());
      setItems(res.items);
      setErrors(res.errors);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={run} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
        <Input aria-label="Название и автор" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название и автор" />
        <Input aria-label="ISBN" value={isbn} onChange={(e) => setIsbn(e.target.value)} placeholder="ISBN (необязательно)" />
        <Button type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />} Искать
        </Button>
      </form>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={withCover} onChange={(e) => setWithCover(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        Брать и обложку
      </label>
      {busy && !items && (
        <div className="flex items-center gap-2 py-6 text-muted">
          <LoaderCircle className="size-5 animate-spin" /> Ищу в Google Books и Open Library…
        </div>
      )}
      {items && items.length === 0 && (
        <p className="py-4 text-sm text-muted">
          Ничего не нашлось. Попробуйте короче: только название или фамилию автора.
          {errors.length > 0 && <span className="mt-1 block text-danger">{errors.join(" · ")}</span>}
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="grid gap-3">
          {items.map((it, i) => (
            <li key={`${it.source}-${i}`} className="card flex gap-4 p-3">
              <div className="w-16 shrink-0">
                {it.cover ? (
                  <img src={it.cover} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-[2/3] w-full rounded-md bg-surface-2 object-cover" />
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center rounded-md bg-surface-2 text-faint">
                    <ImageIcon className="size-5" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold leading-snug">{it.title}</div>
                <div className="text-sm text-muted">{[it.authors.join(", "), it.year, it.publisher].filter(Boolean).join(" · ")}</div>
                {it.description && <p className="mt-1 line-clamp-2 text-[13px] text-muted">{it.description}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => onApply(it, withCover)}>
                    <Check className="size-4" /> Взять
                  </Button>
                  <span className="flex items-center gap-1 text-[12px] text-faint">
                    <Globe className="size-3.5" /> {it.source}
                    {it.isbn && ` · ISBN ${it.isbn}`}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items && items.length > 0 && errors.length > 0 && <p className="text-[12px] text-faint">Не ответили: {errors.join(" · ")}</p>}
    </div>
  );
}
