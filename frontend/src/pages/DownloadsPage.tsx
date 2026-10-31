/** Книги, скачанные на это устройство: открываются и без связи. */
import { useEffect, useState } from "react";
import { CloudDownload, Headphones, HardDrive, Trash, WifiOff } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/misc";
import { dialogs } from "@/lib/dialogs";
import { formatSize } from "@/lib/format";
import { useOffline } from "@/lib/network";
import { offlineSupported, removeDownload, storageEstimate, useDownloads, verifyDownloads } from "@/lib/offline";
import { Link } from "@/lib/router";
import { useOutboxSize } from "@/lib/sync";
import { countLabel, hueOf } from "@/lib/utils";

export default function DownloadsPage() {
  const { downloads, progress } = useDownloads();
  const offline = useOffline();
  const pendingSync = useOutboxSize();
  const [space, setSpace] = useState<{ usage: number; quota: number } | null>(null);
  const items = Object.values(downloads).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const total = items.reduce((s, d) => s + d.bytes, 0);

  useEffect(() => {
    void verifyDownloads();
    void storageEstimate().then(setSpace);
  }, [items.length]);

  return (
    <div className="flex flex-col gap-7">
      <header>
        <p className="text-sm text-muted">Читаются и слушаются без интернета — в самолёте, в метро, на даче</p>
        <h1 className="title-display mt-1 text-[30px] sm:text-[34px]">На устройстве</h1>
      </header>

      {offline && (
        <div className="card flex items-start gap-3 border-accent/40 bg-accent-soft p-4 text-sm">
          <WifiOff className="mt-0.5 size-5 shrink-0 text-accent-ink" />
          <span>
            Нет связи с сервером. Скачанные книги открываются как обычно; прогресс, закладки и время чтения сохранятся здесь и уйдут на сервер, когда связь вернётся
            {pendingSync ? ` (ждут отправки: ${pendingSync})` : ""}.
          </span>
        </div>
      )}

      {!offlineSupported() ? (
        <p className="card px-5 py-4 text-sm text-muted">Этот браузер не умеет хранить книги офлайн. Откройте SelfRead в Chrome, Safari или Firefox по адресу https://.</p>
      ) : items.length === 0 && progress.size === 0 ? (
        <div className="card">
          <Empty
            icon={<CloudDownload />}
            title="Здесь пока пусто"
            text="На странице книги нажмите «Скачать на устройство» — книга или аудиокнига сохранится в браузере и будет открываться без связи."
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted">
            <span className="flex items-center gap-1.5">
              <HardDrive className="size-4" /> {countLabel(items.length, "книга", "книги", "книг")} · {formatSize(total)}
            </span>
            {space && space.quota > 0 && <span>Свободно в браузере ≈ {formatSize(Math.max(0, space.quota - space.usage))}</span>}
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {items.map((d) => {
              const n = (hueOf(d.title) % 6) + 1;
              return (
                <li key={d.id} className="card flex items-center gap-4 p-3">
                  <Link to={d.kind === "audio" ? `/books/${d.id}` : `/read/${d.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                    {d.cover ? (
                      <img src={d.cover} alt="" className="aspect-[2/3] w-12 shrink-0 rounded-md object-cover shadow-sm" />
                    ) : (
                      <span className="flex aspect-[2/3] w-12 shrink-0 items-center justify-center rounded-md" style={{ background: `var(--cover-${n})`, color: "var(--cover-ink)" }}>
                        {d.kind === "audio" && <Headphones className="size-4" />}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="line-clamp-2 font-semibold leading-snug">{d.title}</span>
                      <span className="block truncate text-sm text-muted">
                        {d.authors.join(", ")}
                        {d.authors.length ? " · " : ""}
                        {d.kind === "audio" ? "аудиокнига" : d.format.toUpperCase()} · {formatSize(d.bytes)}
                      </span>
                    </span>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Убрать «${d.title}» с устройства`}
                    title="Убрать с устройства"
                    onClick={async () => {
                      const ok = await dialogs.confirm({ title: "Убрать с устройства?", text: `Освободится ${formatSize(d.bytes)}. В библиотеке книга останется.`, action: "Убрать" });
                      if (ok) await removeDownload(d.id);
                    }}
                  >
                    <Trash className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
