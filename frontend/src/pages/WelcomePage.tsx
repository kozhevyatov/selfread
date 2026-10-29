import { useState } from "react";
import { AuthShell, Stepper } from "@/components/AuthShell";
import { FolderBrowser } from "@/components/FolderBrowser";
import { BookOpen, CircleCheck, LoaderCircle, Lock, Plus, Trash, Users } from "@/components/icons";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/misc";
import { Segmented, Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { invalidate, useQuery } from "@/lib/query";
import { Link } from "@/lib/router";
import { toast } from "@/lib/toast";
import { countLabel } from "@/lib/utils";
import { SETUP_STEPS } from "./SetupPage";

/** Шаги 3–4 установки: медиатеки и первое сканирование. Можно пропустить и добавить позже. */
export default function WelcomePage() {
  const { user } = useAuth();
  const [step, setStep] = useState<2 | 3>(2);
  const libs = useQuery(["admin", "libraries"], api.admin.libraries);
  const scan = useQuery(["admin", "scan"], api.admin.scanStatus, { refetchInterval: 1500, staleTime: 0 });
  const [kind, setKind] = useState<"personal" | "shared">("personal");
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      if (kind === "shared") {
        if (!path) return;
        await api.admin.createLibrary({ name: name.trim() || path.split("/").pop() || "Книги", path, scope: "shared", default_access: open });
      } else {
        await api.admin.createLibrary({ name: name.trim() || "Мои книги", path: "", scope: "personal", owner_id: user?.id, default_access: false });
      }
      setPath("");
      setName("");
      invalidate(["admin"], ["libraries"]);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.admin.deleteLibrary(id);
      invalidate(["admin"], ["libraries"]);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (step === 3) {
    const s = scan.data;
    const total = (libs.data ?? []).reduce((a, l) => a + l.book_count + l.audio_count, 0);
    return (
      <AuthShell wide top={<Stepper steps={SETUP_STEPS} current={3} />} title="Всё готово" subtitle="Медиатеки сканируются в фоне — можно сразу открывать библиотеку.">
        <div className="grid gap-5">
          {(libs.data ?? []).length > 0 && (
            <div className="rounded-2xl border bg-surface-2 p-5">
              {s?.running ? (
                <>
                  <div className="mb-3 flex items-center gap-3 font-semibold">
                    <LoaderCircle className="size-5 animate-spin text-accent-ink" /> Сканирую «{s.library}»{s.total ? ` · ${s.done} из ${s.total}` : ""}
                  </div>
                  <Progress value={s.total ? (s.done / s.total) * 100 : 100} className={s.total ? "" : "animate-pulse"} />
                </>
              ) : (
                <div className="flex items-center gap-3 font-semibold">
                  <CircleCheck className="size-5 text-success" /> Найдено {countLabel(total, "книга", "книги", "книг")}
                </div>
              )}
            </div>
          )}
          <div className="flex gap-4 rounded-2xl border bg-surface-2 p-5">
            <BookOpen className="size-6 shrink-0 text-accent-ink" />
            <p className="text-sm leading-relaxed text-muted">
              Подходят EPUB, FB2 (и FB2.ZIP), MOBI, AZW3, PDF, DjVu, CBZ, TXT, DOCX и аудиокниги (MP3, M4B, M4A, OGG, FLAC). Книги с одинаковым
              именем в одной папке — это одна книга в нескольких форматах. Аудиокнига — папка с файлами или один .m4b.
            </p>
          </div>
          <div className="flex justify-end border-t pt-6">
            <Link to="/" className={buttonClass("primary", "lg")}>
              Открыть библиотеку
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      wide
      top={<Stepper steps={SETUP_STEPS} current={2} />}
      title="Медиатеки"
      subtitle="Папки с книгами. Общую видят те, кому вы откроете доступ, личную — только владелец. Можно пропустить и добавить позже в управлении."
    >
      <div className="grid gap-6">
        {(libs.data ?? []).length > 0 && (
          <div className="grid gap-2">
            {libs.data!.map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-2xl border bg-surface-2 p-3">
                <span className="flex size-10 items-center justify-center rounded-xl border bg-surface text-accent-ink">
                  {l.scope === "personal" ? <Lock className="size-5" /> : <Users className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {l.name} <span className="text-sm font-normal text-muted">· {l.scope === "personal" ? "личная" : "общая"}</span>
                  </div>
                  <div className="truncate text-[13px] text-faint">{l.path}</div>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={`Убрать ${l.name}`} onClick={() => remove(l.id)}>
                  <Trash className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <Segmented<"personal" | "shared">
          label="Тип медиатеки"
          value={kind}
          onChange={setKind}
          className="max-w-md"
          options={[
            { value: "personal", label: "Моя личная" },
            { value: "shared", label: "Общая папка на сервере" },
          ]}
        />

        {kind === "personal" ? (
          <div className="grid gap-4 rounded-2xl border bg-surface-2 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field id="lib-name" label="Название" hint={`Папка media/${user?.username ?? "admin"}/books создастся сама`}>
              <Input id="lib-name" value={name} placeholder="Мои книги" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button onClick={add} disabled={busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />} Создать
            </Button>
          </div>
        ) : (
          <>
            <FolderBrowser
              value={path}
              onChange={(p, n) => {
                setPath(p);
                setName(n);
              }}
            />
            {path && (
              <div className="grid gap-4 rounded-2xl border bg-surface-2 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field id="lib-name" label="Название в приложении">
                  <Input id="lib-name" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Button onClick={add} disabled={busy}>
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />} Добавить
                </Button>
                <label className="flex items-center gap-3 text-sm text-muted sm:col-span-2">
                  <Switch checked={open} onChange={setOpen} label="Открыта для всех пользователей" />
                  Открыта для всех пользователей (для чтения)
                </label>
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap justify-between gap-3 border-t pt-6">
          <Button variant="ghost" onClick={() => setStep(3)}>
            Пропустить
          </Button>
          <Button size="lg" disabled={!libs.data?.length} onClick={() => setStep(3)}>
            Далее
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
