import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { dialogs, useDialogState } from "@/lib/dialogs";
import { invalidate, useQuery } from "@/lib/query";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { CheckRow } from "./books";
import { Check, LoaderCircle, Plus } from "./icons";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { Spinner } from "./ui/misc";
import { EditBookDialog } from "./EditBookDialog";
import { UploadDialog } from "./UploadDialog";

/** «На полку»: отметить полки для книги (или нескольких) и создать новую. */
function ShelfPicker({ bookIds }: { bookIds: number[] }) {
  const shelves = useQuery(["shelves"], api.shelves.list);
  const single = bookIds.length === 1;
  const detail = useQuery(["book", bookIds[0]], () => api.books.get(bookIds[0]), { enabled: single });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toggled, setToggled] = useState<Record<number, boolean>>({});

  const own = (shelves.data ?? []).filter((s) => s.mine);
  const onShelf = (id: number) => toggled[id] ?? Boolean(single && detail.data?.shelves.some((s) => s.id === id));

  const toggle = async (id: number) => {
    const next = !onShelf(id);
    setToggled((t) => ({ ...t, [id]: next }));
    try {
      if (next) await api.shelves.addBooks(id, bookIds);
      else await Promise.all(bookIds.map((b) => api.shelves.removeBook(id, b)));
      invalidate(["shelves"], ["shelf", id], ["home"], ["book", bookIds[0]], ["books"]);
    } catch (err) {
      setToggled((t) => ({ ...t, [id]: !next }));
      toast.error((err as Error).message);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const shelf = await api.shelves.create({ name: name.trim(), book_ids: bookIds });
      invalidate(["shelves"], ["home"], ["book", bookIds[0]]);
      toast.success(`Добавлено на полку «${shelf.name}»`);
      dialogs.closeQuiet();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={dialogs.close}
      title="На полку"
      description={single ? undefined : `Книг: ${bookIds.length}`}
      footer={
        <Button onClick={dialogs.close}>
          <Check className="size-4" /> Готово
        </Button>
      }
    >
      {shelves.isLoading || (single && detail.isLoading) ? (
        <Spinner />
      ) : (
        <div className="grid gap-4">
          {own.length > 0 && (
            <div role="menu" className="-mx-2 grid">
              {own.map((s) => (
                <CheckRow key={s.id} checked={onShelf(s.id)} label={s.name} onClick={() => toggle(s.id)} />
              ))}
            </div>
          )}
          <form onSubmit={create} className={cn("flex gap-2", own.length > 0 && "border-t pt-4")}>
            <Input aria-label="Новая полка" placeholder="Новая полка" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant="outline" disabled={busy || !name.trim()}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />} Создать
            </Button>
          </form>
        </div>
      )}
    </Dialog>
  );
}

function Confirm({ title, text, action, danger, resolve }: { title: string; text: string; action: string; danger?: boolean; resolve: (ok: boolean) => void }) {
  const done = (ok: boolean) => {
    resolve(ok);
    dialogs.closeQuiet();
  };
  return (
    <Dialog
      open
      onClose={() => done(false)}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={() => done(false)}>
            Отмена
          </Button>
          <Button data-autofocus variant={danger ? "danger" : "primary"} onClick={() => done(true)}>
            <Check className={cn("size-4", danger && "hidden")} /> {action}
          </Button>
        </>
      }
    >
      <p className="text-muted">{text}</p>
    </Dialog>
  );
}

export function DialogHost() {
  const state = useDialogState();
  switch (state.kind) {
    case "shelf":
      return <ShelfPicker bookIds={state.bookIds} />;
    case "confirm":
      return <Confirm {...state} />;
    case "upload":
      return <UploadDialog libraryId={state.libraryId} />;
    case "editBook":
      return <EditBookDialog book={state.book} />;
    default:
      return null;
  }
}
