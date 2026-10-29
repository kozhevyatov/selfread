/**
 * Загрузка книг из браузера: перетащить файлы или папку (аудиокнигу), выбрать медиатеку,
 * при желании — подпапку. Файлы уходят по одному с прогрессом, после — сканирование.
 */
import { useEffect, useRef, useState, type DragEvent } from "react";
import { api, uploadFile, type UploadTarget } from "@/lib/api";
import { dialogs } from "@/lib/dialogs";
import { formatSize } from "@/lib/format";
import { invalidate, useQuery } from "@/lib/query";
import { toast } from "@/lib/toast";
import { cn, plural } from "@/lib/utils";
import { CircleCheck, CloudUpload, FolderOpen, LoaderCircle, TriangleAlert, X } from "./icons";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Field, Input, Select } from "./ui/input";
import { Spinner } from "./ui/misc";

const BOOK_EXT = /\.(epub|fb2|fbz|fb2\.zip|mobi|azw3?|kf8|pdf|djvu?|cbz|cbr|cb7|txt|rtf|docx?|odt|html?|chm|mp3|m4a|m4b|aac|ogg|oga|opus|flac|wav|jpe?g|png|webp|opf)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)$/i;

type Item = { file: File; rel: string; status: "wait" | "upload" | "done" | "error"; loaded: number; error?: string };

/** Файлы из перетащенной папки — с путями внутри неё. */
async function readEntry(entry: FileSystemEntry, prefix = ""): Promise<{ file: File; rel: string }[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    return [{ file, rel: prefix + file.name }];
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const all: FileSystemEntry[] = [];
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      all.push(...batch);
    }
    const nested = await Promise.all(all.map((e) => readEntry(e, `${prefix}${entry.name}/`)));
    return nested.flat();
  }
  return [];
}

export function UploadDialog({ libraryId }: { libraryId?: number }) {
  const targets = useQuery(["upload-targets"], api.uploads.targets);
  const [target, setTarget] = useState<number | null>(libraryId ?? null);
  const [folder, setFolder] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (target === null && targets.data?.length) setTarget(targets.data.find((t) => t.id === libraryId)?.id ?? targets.data[0].id);
  }, [targets.data, target, libraryId]);

  const add = (list: { file: File; rel: string }[]) => {
    const ok = list.filter((x) => BOOK_EXT.test(x.file.name) && !x.file.name.startsWith("."));
    const skipped = list.length - ok.length;
    if (skipped) toast.info(`Пропущено файлов неподходящего формата: ${skipped}`);
    setItems((cur) => [...cur.filter((i) => i.status !== "done"), ...ok.map((x) => ({ ...x, status: "wait" as const, loaded: 0 }))]);
    // несколько аудиофайлов без папки — предложим папку (одна аудиокнига = одна папка)
    const audio = ok.filter((x) => AUDIO_EXT.test(x.file.name) && !x.rel.includes("/"));
    if (audio.length > 1 && !folder) setFolder(audio[0].file.name.replace(/\.[^.]+$/, "").replace(/^[\d\s._-]+/, "").trim() || "Новая аудиокнига");
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const dt: DataTransfer = e.dataTransfer;
    const entries = Array.from(dt.items)
      .map((i: DataTransferItem) => i.webkitGetAsEntry?.())
      .filter(Boolean) as FileSystemEntry[];
    if (entries.length) add((await Promise.all(entries.map((en) => readEntry(en)))).flat());
    else add(Array.from(dt.files).map((file: File) => ({ file, rel: file.name })));
  };

  const start = async () => {
    if (!target) return;
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const base = folder.trim().replace(/^\/+|\/+$/g, "");
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      if (ctrl.signal.aborted) break;
      const it = items[i];
      if (it.status === "done") continue;
      setItems((cur) => cur.map((x, k) => (k === i ? { ...x, status: "upload", loaded: 0, error: undefined } : x)));
      try {
        await uploadFile(target, base ? `${base}/${it.rel}` : it.rel, it.file, (loaded) => setItems((cur) => cur.map((x, k) => (k === i ? { ...x, loaded } : x))), ctrl.signal);
        ok++;
        setItems((cur) => cur.map((x, k) => (k === i ? { ...x, status: "done", loaded: x.file.size } : x)));
      } catch (err) {
        setItems((cur) => cur.map((x, k) => (k === i ? { ...x, status: "error", error: (err as Error).message } : x)));
      }
    }
    setBusy(false);
    abort.current = null;
    if (ok) {
      try {
        await api.uploads.done(target);
      } catch {
        /* просканируется по расписанию */
      }
      toast.success(`Загружено ${ok} ${plural(ok, "файл", "файла", "файлов")}. Книги появятся в библиотеке через минуту.`);
      waitForScan();
    }
  };

  const total = items.reduce((a, i) => a + i.file.size, 0);
  const loaded = items.reduce((a, i) => a + (i.status === "done" ? i.file.size : i.loaded), 0);
  const pending = items.filter((i) => i.status !== "done").length;
  const list = targets.data ?? [];

  return (
    <Dialog
      open
      wide
      onClose={() => {
        abort.current?.abort();
        dialogs.closeQuiet();
      }}
      title="Загрузить книги"
      description="EPUB, FB2, MOBI, AZW3, PDF, DjVu, CBZ, TXT, DOCX и аудиокниги. Аудиокнигу удобно загружать целой папкой."
      footer={
        <>
          <Button variant="ghost" onClick={() => (busy ? abort.current?.abort() : dialogs.closeQuiet())}>
            {busy ? "Остановить" : "Закрыть"}
          </Button>
          <Button onClick={start} disabled={busy || !pending || !target}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
            {busy ? `Загружаю · ${total ? Math.round((loaded / total) * 100) : 0}%` : pending ? `Загрузить ${pending} ${plural(pending, "файл", "файла", "файлов")}` : "Загрузить"}
          </Button>
        </>
      }
    >
      {targets.isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <div className="flex gap-3 rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm leading-relaxed">
          <TriangleAlert className="size-5 shrink-0 text-danger" />
          <span>
            Загружать некуда. Нужна личная медиатека или общая с правом записи (и папка, подключённая без <code>:ro</code>). Попросите администратора
            создать вам личную медиатеку в «Управлении».
          </span>
        </div>
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="up-lib" label="Медиатека">
              <Select id="up-lib" value={target ?? ""} onChange={(e) => setTarget(Number(e.target.value))} disabled={busy}>
                {list.map((t: UploadTarget) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.scope === "personal" ? "личная" : "общая"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="up-folder" label="Подпапка (необязательно)" hint="Например, «Толстой» или название аудиокниги">
              <Input id="up-folder" value={folder} onChange={(e) => setFolder(e.target.value)} disabled={busy} placeholder="В корень медиатеки" />
            </Field>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition",
              over ? "border-accent bg-accent-soft" : "bg-surface-2",
            )}
          >
            <CloudUpload className="size-8 text-accent-ink" />
            <p className="font-semibold">Перетащите сюда файлы или папку</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
                Выбрать файлы
              </Button>
              <Button variant="outline" size="sm" onClick={() => dirInput.current?.click()} disabled={busy}>
                <FolderOpen className="size-4" /> Выбрать папку
              </Button>
            </div>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                add(Array.from((e.target.files ?? []) as ArrayLike<File>).map((file: File) => ({ file, rel: file.name })));
                e.target.value = "";
              }}
            />
            <input
              ref={dirInput}
              type="file"
              hidden
              // выбор папки целиком (аудиокнига с главами, серия книг)
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(e) => {
                add(Array.from((e.target.files ?? []) as ArrayLike<File>).map((file: File) => ({ file, rel: file.webkitRelativePath || file.name })));
                e.target.value = "";
              }}
            />
          </div>

          {items.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-sm text-muted">
                <span>
                  {items.length} {plural(items.length, "файл", "файла", "файлов")} · {formatSize(total)}
                </span>
                {!busy && (
                  <button type="button" onClick={() => setItems([])} className="font-semibold hover:text-fg">
                    Очистить
                  </button>
                )}
              </div>
              <ul className="max-h-64 divide-y overflow-y-auto rounded-2xl border">
                {items.map((it, i) => (
                  <li key={`${it.rel}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{it.rel}</span>
                      {it.status === "upload" && (
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3">
                          <span className="block h-full bg-accent" style={{ width: `${it.file.size ? (it.loaded / it.file.size) * 100 : 0}%` }} />
                        </span>
                      )}
                      {it.error && <span className="block truncate text-danger">{it.error}</span>}
                    </span>
                    <span className="num shrink-0 text-muted">{formatSize(it.file.size)}</span>
                    {it.status === "done" ? (
                      <CircleCheck className="size-4 shrink-0 text-success" />
                    ) : it.status === "upload" ? (
                      <LoaderCircle className="size-4 shrink-0 animate-spin text-accent-ink" />
                    ) : it.status === "error" ? (
                      <TriangleAlert className="size-4 shrink-0 text-danger" />
                    ) : (
                      !busy && (
                        <button type="button" aria-label={`Убрать ${it.file.name}`} onClick={() => setItems((cur) => cur.filter((_, k) => k !== i))} className="text-faint hover:text-fg">
                          <X className="size-4" />
                        </button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** После загрузки ждём конца сканирования и обновляем списки. */
function waitForScan() {
  let tries = 0;
  const tick = async () => {
    tries++;
    try {
      const s = await api.uploads.status();
      if (!s.running || tries > 120) {
        invalidate(["home"], ["books"], ["facets"], ["libraries"], ["admin", "libraries"]);
        return;
      }
    } catch {
      return;
    }
    window.setTimeout(tick, 2000);
  };
  window.setTimeout(tick, 1500);
}
