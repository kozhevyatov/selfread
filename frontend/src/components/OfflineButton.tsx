/** Кнопка «Скачать на устройство» для чтения и прослушивания без связи. */
import type { BookDetail } from "@/lib/api";
import { dialogs } from "@/lib/dialogs";
import { formatSize } from "@/lib/format";
import { cancelDownload, downloadBook, offlineSupported, removeDownload, useDownloads } from "@/lib/offline";
import { toast } from "@/lib/toast";
import { CircleCheck, CloudDownload, LoaderCircle, X } from "./icons";
import { Button } from "./ui/button";

export function OfflineButton({ book }: { book: BookDetail }) {
  const { downloads, progress } = useDownloads();
  if (!offlineSupported()) return null;
  const saved = downloads[book.id];
  const p = progress.get(book.id);

  if (p && !p.error) {
    const pct = p.total ? Math.min(99, Math.round((p.done / p.total) * 100)) : 0;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <LoaderCircle className="size-4 animate-spin text-accent-ink" />
          <span className="flex-1">Скачиваю · {pct}%</span>
          <button type="button" onClick={() => cancelDownload(book.id)} aria-label="Остановить скачивание" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2">
            <X className="size-4" />
          </button>
        </div>
        <span className="block h-1.5 overflow-hidden rounded-full bg-surface-3">
          <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </span>
      </div>
    );
  }

  if (saved) {
    return (
      <Button
        variant="ghost"
        onClick={async () => {
          const ok = await dialogs.confirm({
            title: "Убрать с устройства?",
            text: `«${book.title}» останется в библиотеке, но без связи открыть её будет нельзя. Освободится ${formatSize(saved.bytes)}.`,
            action: "Убрать",
          });
          if (ok) await removeDownload(book.id);
        }}
        className="text-success"
        title="Книга скачана на это устройство"
      >
        <CircleCheck className="size-4" /> На устройстве
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      onClick={() =>
        downloadBook(book)
          .then(() => toast.success(`«${book.title}» доступна без связи`))
          .catch((err: Error) => toast.error(`Не удалось скачать: ${err.message}`))
      }
      title="Читать или слушать без интернета"
    >
      <CloudDownload className="size-4" /> {p?.error ? "Повторить скачивание" : "Скачать на устройство"}
    </Button>
  );
}
