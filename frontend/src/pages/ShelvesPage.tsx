import { useEffect, useState, type FormEvent } from "react";
import { BookGrid, ShelfCard } from "@/components/books";
import { LibraryBig, LoaderCircle, Pencil, Plus, Trash } from "@/components/icons";
import { PageHeader, Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Empty, ErrorBox, PageLoader } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { api, type Shelf } from "@/lib/api";
import { dialogs } from "@/lib/dialogs";
import { booksLabel } from "@/lib/format";
import { invalidate, useQuery } from "@/lib/query";
import { navigate, setSearchParam, useParams, useSearchParams } from "@/lib/router";
import { toast } from "@/lib/toast";

function ShelfDialog({ shelf, onClose }: { shelf?: Shelf; onClose: () => void }) {
  const [name, setName] = useState(shelf?.name ?? "");
  const [description, setDescription] = useState(shelf?.description ?? "");
  const [shared, setShared] = useState(shelf?.is_shared ?? false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const data = { name: name.trim(), description, is_shared: shared };
      const saved = shelf ? await api.shelves.update(shelf.id, data) : await api.shelves.create(data);
      invalidate(["shelves"], ["shelf", saved.id], ["home"]);
      onClose();
      if (!shelf) navigate(`/shelves/${saved.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={shelf ? "Полка" : "Новая полка"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="shelf-form" disabled={busy || !name.trim()}>
            {busy && <LoaderCircle className="size-4 animate-spin" />} {shelf ? "Сохранить" : "Создать"}
          </Button>
        </>
      }
    >
      <form id="shelf-form" onSubmit={submit} className="grid gap-5">
        <Field id="shelf-name" label="Название">
          <Input id="shelf-name" required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, «Классика»" />
        </Field>
        <Field id="shelf-desc" label="Описание">
          <Textarea id="shelf-desc" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex items-start justify-between gap-4 rounded-2xl border bg-surface-2 p-4">
          <span>
            <span className="block font-semibold">Общая полка</span>
            <span className="text-sm text-muted">Видна всем пользователям сервиса. Менять её можете только вы.</span>
          </span>
          <Switch checked={shared} onChange={setShared} label="Общая полка" />
        </div>
      </form>
    </Dialog>
  );
}

export default function ShelvesPage() {
  const params = useSearchParams();
  const shelves = useQuery(["shelves"], api.shelves.list);
  const creating = params.get("new") === "1";

  if (shelves.isLoading) return <PageLoader />;
  if (shelves.error) return <ErrorBox error={shelves.error} />;
  const mine = shelves.data!.filter((s) => s.mine);
  const others = shelves.data!.filter((s) => !s.mine);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Полки"
        subtitle="Ваши подборки книг. Одна книга может стоять на нескольких полках."
        actions={
          <Button onClick={() => setSearchParam("new", "1")}>
            <Plus className="size-4" /> Новая полка
          </Button>
        }
      />
      {mine.length === 0 && others.length === 0 ? (
        <div className="card">
          <Empty
            icon={<LibraryBig />}
            title="Полок пока нет"
            text="Создайте полку и добавляйте на неё книги со страницы книги — кнопкой «На полку»."
            action={
              <Button onClick={() => setSearchParam("new", "1")}>
                <Plus className="size-4" /> Создать полку
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {mine.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
              {mine.map((s) => (
                <ShelfCard key={s.id} shelf={s} />
              ))}
            </div>
          )}
          {others.length > 0 && (
            <Section title="Общие полки других читателей">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
                {others.map((s) => (
                  <ShelfCard key={s.id} shelf={s} />
                ))}
              </div>
            </Section>
          )}
        </>
      )}
      {creating && <ShelfDialog onClose={() => setSearchParam("new", null)} />}
    </div>
  );
}

export function ShelfPage() {
  const { id } = useParams<{ id: string }>();
  const shelfId = Number(id);
  const shelf = useQuery(["shelf", shelfId], () => api.shelves.get(shelfId));
  const books = useQuery(["books", "shelf", shelfId], () => api.books.list({ shelf: shelfId, sort: "title", limit: 1000 }));
  const [editing, setEditing] = useState(false);

  useEffect(() => setEditing(false), [shelfId]);

  if (shelf.isLoading) return <PageLoader />;
  if (shelf.error) return <ErrorBox error={shelf.error} />;
  const s = shelf.data!;

  const remove = async () => {
    const ok = await dialogs.confirm({
      title: "Удалить полку?",
      text: `Полка «${s.name}» исчезнет. Сами книги останутся в библиотеке.`,
      action: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.shelves.remove(s.id);
      invalidate(["shelves"], ["home"]);
      navigate("/shelves", { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={s.name}
        subtitle={
          <>
            {booksLabel(s.book_count)} · {s.mine ? (s.is_shared ? "общая полка" : "личная полка") : `полка читателя ${s.owner?.name ?? ""}`}
            {s.description && <span className="mt-2 block whitespace-pre-line text-fg">{s.description}</span>}
          </>
        }
        actions={
          s.mine && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Изменить
              </Button>
              <Button variant="ghost" onClick={remove} aria-label="Удалить полку">
                <Trash className="size-4" />
              </Button>
            </>
          )
        }
      />
      {books.isLoading ? (
        <PageLoader />
      ) : books.data && books.data.items.length ? (
        <BookGrid books={books.data.items} />
      ) : (
        <div className="card">
          <Empty icon={<LibraryBig />} title="На полке пусто" text="Откройте книгу и нажмите «На полку», чтобы добавить её сюда." />
        </div>
      )}
      {editing && <ShelfDialog shelf={s} onClose={() => setEditing(false)} />}
    </div>
  );
}
