import { useEffect, useRef, useState, type FormEvent } from "react";
import { AvatarCropper } from "@/components/AvatarCropper";
import { FolderBrowser } from "@/components/FolderBrowser";
import {
  FolderPlus,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  Lock,
  Pencil,
  RefreshCw,
  ScanSearch,
  Trash,
  TriangleAlert,
  UserPlus,
  Users,
} from "@/components/icons";
import { Avatar } from "@/components/Layout";
import { PageHeader } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, Card, ErrorBox, PageLoader, Progress } from "@/components/ui/misc";
import { Segmented, Switch } from "@/components/ui/switch";
import { api, updateCurrentUser, type AdminLibrary, type AdminUser } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dialogs } from "@/lib/dialogs";
import { formatDate, formatSize } from "@/lib/format";
import { invalidate, useQuery } from "@/lib/query";
import { setSearchParam, useSearchParams } from "@/lib/router";
import { toast } from "@/lib/toast";
import { cn, countLabel } from "@/lib/utils";

type Tab = "libraries" | "users" | "general";

// ---------------- общие ----------------

function GeneralTab() {
  const s = useQuery(["admin", "settings"], api.admin.settings);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (s.data) {
      setName(s.data.site_name);
      setUrl(s.data.public_url);
    }
  }, [s.data]);
  if (!s.data) return <PageLoader />;
  const update = async (patch: Parameters<typeof api.admin.updateSettings>[0], msg = "Сохранено") => {
    try {
      await api.admin.updateSettings(patch);
      invalidate(["admin", "settings"], ["settings"]);
      toast.success(msg);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  return (
    <div className="grid max-w-3xl gap-5">
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ site_name: name });
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="min-w-60 flex-1">
            <Field id="site" label="Название сервиса">
              <Input id="site" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="outline">
            Сохранить
          </Button>
        </form>
      </Card>
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ public_url: url });
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="min-w-60 flex-1">
            <Field id="public-url" label="Внешний адрес сервиса" hint="Например, https://read.example.com. Пригодится для ссылок и каталога OPDS.">
              <Input id="public-url" type="url" placeholder={window.location.origin} value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="outline">
            Сохранить
          </Button>
        </form>
      </Card>
      <Card className="flex items-start justify-between gap-6">
        <div>
          <div className="text-[16px] font-bold">Свободная регистрация</div>
          <p className="mt-1 text-sm text-muted">
            {s.data.registration_mode === "open"
              ? "Любой, у кого есть ссылка, может создать аккаунт. Новым пользователям открываются общие медиатеки с пометкой «для новых пользователей»."
              : "Регистрация закрыта. Новых пользователей добавляет администратор."}
          </p>
        </div>
        <Switch
          label="Свободная регистрация"
          checked={s.data.registration_mode === "open"}
          onChange={(v) => update({ registration_mode: v ? "open" : "closed" }, v ? "Регистрация открыта" : "Регистрация закрыта")}
        />
      </Card>
      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[16px] font-bold">Автоматическое сканирование</div>
          <p className="mt-1 text-sm text-muted">Как часто проверять медиатеки на новые и изменённые книги.</p>
        </div>
        <div className="w-56">
          <Select aria-label="Интервал сканирования" value={s.data.scan_interval} onChange={(e) => update({ scan_interval: Number(e.target.value) })}>
            <option value={0}>Выключено</option>
            <option value={15}>Каждые 15 минут</option>
            <option value={60}>Каждый час</option>
            <option value={360}>Каждые 6 часов</option>
            <option value={1440}>Раз в сутки</option>
          </Select>
        </div>
      </Card>
    </div>
  );
}

// ---------------- медиатеки ----------------

function ScanBar() {
  const scan = useQuery(["admin", "scan"], api.admin.scanStatus, { refetchInterval: 2000, staleTime: 0 });
  const [wasRunning, setWasRunning] = useState(false);
  const s = scan.data;
  useEffect(() => {
    if (!s) return;
    if (wasRunning && !s.running) invalidate(["admin", "libraries"], ["home"], ["books"], ["libraries"], ["facets"]);
    setWasRunning(s.running);
  }, [s?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  return (
    <Card className="flex flex-wrap items-center gap-4">
      <ScanSearch className={cn("size-6", s.running ? "animate-pulse text-accent-ink" : "text-faint")} />
      <div className="min-w-0 flex-1">
        {s.running ? (
          <>
            <div className="font-semibold">Сканирование · «{s.library}»</div>
            <div className="truncate text-sm text-muted">
              {s.total ? `${s.done} из ${s.total}` : "Ищем книги…"}
              {s.current && ` · ${s.current}`}
            </div>
            {s.total > 0 && <Progress value={(s.done / s.total) * 100} className="mt-2 max-w-md" />}
          </>
        ) : (
          <>
            <div className="font-semibold">Сканирование не идёт</div>
            <div className="text-sm text-muted">
              {s.finished_at ? `Последнее: ${formatDate(s.finished_at)} · новых ${s.added}, обновлено ${s.updated}, удалено ${s.removed}` : "После запуска контейнера ещё не запускалось"}
            </div>
          </>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={s.running} onClick={() => api.admin.scan().then(() => scan.refetch())}>
          <RefreshCw className="size-4" /> Найти новое
        </Button>
        <Button variant="ghost" size="sm" disabled={s.running} onClick={() => api.admin.scan(undefined, true).then(() => scan.refetch())}>
          Перечитать всё
        </Button>
      </div>
    </Card>
  );
}

type PathMode = "auto" | "browse";

function LibraryDialog({ open, onClose, lib }: { open: boolean; onClose: () => void; lib?: AdminLibrary }) {
  const users = useQuery(["admin", "users"], api.admin.users, { enabled: open });
  const [scope, setScope] = useState<"shared" | "personal">(lib?.scope ?? "shared");
  const [owner, setOwner] = useState<number | "">(lib?.owner?.id ?? "");
  const [pathMode, setPathMode] = useState<PathMode>("auto");
  const [path, setPath] = useState(lib?.path ?? "");
  const [name, setName] = useState(lib?.name ?? "");
  const [def, setDef] = useState(lib?.default_access ?? true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setScope(lib?.scope ?? "shared");
      setOwner(lib?.owner?.id ?? "");
      setPathMode("auto");
      setPath(lib?.path ?? "");
      setName(lib?.name ?? "");
      setDef(lib?.default_access ?? true);
    }
  }, [open, lib]);

  const ownerUser = users.data?.find((u) => u.id === owner);
  const needsPath = !lib && (scope === "shared" || pathMode === "browse");
  const canSave = Boolean(name.trim()) && (!needsPath || Boolean(path)) && (lib || scope === "shared" || owner !== "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (lib) await api.admin.updateLibrary(lib.id, { name: name.trim(), ...(lib.scope === "shared" || path !== lib.path ? { path } : {}), default_access: def });
      else
        await api.admin.createLibrary({
          name: name.trim(),
          path: needsPath ? path : "",
          scope,
          owner_id: scope === "personal" ? Number(owner) : null,
          default_access: def,
        });
      invalidate(["admin"], ["libraries"], ["home"]);
      toast.success(lib ? "Медиатека обновлена" : "Медиатека добавлена — идёт сканирование");
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={lib ? "Медиатека" : "Новая медиатека"}
      description={lib ? lib.path : "Папка с книгами и аудиокнигами. Подпапки сканируются тоже."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="lib-form" disabled={!canSave || busy}>
            {busy && <LoaderCircle className="size-4 animate-spin" />} {lib ? "Сохранить" : "Добавить"}
          </Button>
        </>
      }
    >
      <form id="lib-form" onSubmit={submit} className="grid gap-5">
        {!lib && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-bold text-muted">Тип</span>
            <Segmented<"shared" | "personal">
              label="Тип медиатеки"
              value={scope}
              onChange={setScope}
              className="max-w-md"
              options={[
                { value: "shared", label: "Общая" },
                { value: "personal", label: "Личная" },
              ]}
            />
            <span className="text-[13px] text-muted">
              {scope === "shared"
                ? "Видят пользователи, которым вы откроете доступ (или все — переключателем ниже)."
                : "Видит только владелец. Другим пользователям её открыть нельзя."}
            </span>
          </div>
        )}

        {!lib && scope === "personal" && (
          <>
            <Field id="lib-owner" label="Владелец">
              <Select
                id="lib-owner"
                required
                value={owner}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : "";
                  setOwner(id);
                  const u = users.data?.find((x) => x.id === id);
                  if (u && !name.trim()) setName(`Книги · ${u.display_name || u.username}`);
                }}
              >
                <option value="">Выберите пользователя</option>
                {users.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name || u.username} ({u.username})
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-bold text-muted">Где хранить книги</span>
              <Segmented<PathMode>
                label="Папка"
                value={pathMode}
                onChange={setPathMode}
                className="max-w-lg"
                options={[
                  { value: "auto", label: "Новая папка пользователя" },
                  { value: "browse", label: "Папка на сервере" },
                ]}
              />
              <span className="text-[13px] text-muted">
                {pathMode === "auto"
                  ? `Создадим media/${ownerUser?.username ?? "<логин>"}/books — туда можно класть книги по сети или загружать (позже — прямо из приложения).`
                  : "Выберите существующую папку из подключённых к контейнеру."}
              </span>
            </div>
          </>
        )}

        {(needsPath || (lib && lib.scope === "shared")) && (
          <FolderBrowser
            value={path}
            onChange={(p, n) => {
              setPath(p);
              if (!name.trim()) setName(n);
            }}
          />
        )}

        <Field id="lib-name" label="Название в приложении">
          <Input id="lib-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, «Домашняя библиотека»" />
        </Field>

        {(lib ? lib.scope === "shared" : scope === "shared") && (
          <div className="flex items-start justify-between gap-4 rounded-2xl border bg-surface-2 p-4">
            <span>
              <span className="block font-semibold">Для новых пользователей</span>
              <span className="text-sm text-muted">Новые пользователи (и все существующие при добавлении) получат доступ на чтение.</span>
            </span>
            <Switch checked={def} onChange={setDef} label="Для новых пользователей" />
          </div>
        )}
      </form>
    </Dialog>
  );
}

function LibrariesTab() {
  const params = useSearchParams();
  const libs = useQuery(["admin", "libraries"], api.admin.libraries);
  const [editing, setEditing] = useState<AdminLibrary | null>(null);
  const adding = params.get("new") === "1";
  const setAdding = (v: boolean) => setSearchParam("new", v ? "1" : null);
  if (libs.isLoading) return <PageLoader />;
  if (libs.error) return <ErrorBox error={libs.error} />;
  const shared = libs.data!.filter((l) => l.scope === "shared");
  const personal = libs.data!.filter((l) => l.scope === "personal");

  const patch = async (l: AdminLibrary, data: Parameters<typeof api.admin.updateLibrary>[1]) => {
    try {
      await api.admin.updateLibrary(l.id, data);
      invalidate(["admin"], ["libraries"], ["home"], ["books"]);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const remove = async (l: AdminLibrary) => {
    const ok = await dialogs.confirm({
      title: `Убрать медиатеку «${l.name}»?`,
      text: "Книги исчезнут из библиотеки вместе с прогрессом и местом на полках. Файлы на диске останутся нетронутыми.",
      action: "Убрать",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admin.deleteLibrary(l.id);
      invalidate(["admin"], ["libraries"], ["home"], ["books"], ["shelves"]);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const card = (l: AdminLibrary) => (
    <Card key={l.id} className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl border bg-surface-2", l.enabled ? "text-accent-ink" : "text-faint")}>
          {l.scope === "personal" ? <Lock className="size-6" /> : <Users className="size-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-bold">{l.name}</span>
            <Badge>{l.scope === "personal" ? `личная · ${l.owner?.name ?? ""}` : "общая"}</Badge>
            {!l.enabled && <Badge>выключена</Badge>}
            {l.writable ? <Badge className="border-success/40 text-success">чтение и запись</Badge> : <Badge>только чтение</Badge>}
          </div>
          <div className="truncate text-[13px] text-faint">{l.path}</div>
          <div className="mt-1.5 text-sm text-muted">
            {countLabel(l.book_count, "книга", "книги", "книг")} · {countLabel(l.audio_count, "аудиокнига", "аудиокниги", "аудиокниг")} · {formatSize(l.total_size)}
          </div>
          <div className="text-[13px] text-faint">
            Сканирование: {formatDate(l.last_scan_at)}
            {l.scope === "shared" && ` · доступ у ${countLabel(l.user_count, "пользователя", "пользователей", "пользователей")}`}
          </div>
          {!l.exists && (
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-danger">
              <TriangleAlert className="size-4" /> Папка недоступна внутри контейнера — проверьте volumes
            </div>
          )}
          {l.last_scan_error && l.exists && <div className="mt-2 text-sm font-semibold text-danger">{l.last_scan_error}</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t pt-4">
        <label className="flex items-center gap-2.5 text-sm font-semibold">
          <Switch checked={l.enabled} onChange={(v) => patch(l, { enabled: v })} label="Включена" /> Включена
        </label>
        {l.scope === "shared" && (
          <label className="flex items-center gap-2.5 text-sm font-semibold">
            <Switch checked={l.default_access} onChange={(v) => patch(l, { default_access: v })} label="Для новых пользователей" /> Для новых пользователей
          </label>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Сканировать" title="Сканировать" onClick={() => api.admin.scan(l.id).then(() => invalidate(["admin", "scan"]))}>
            <RefreshCw className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Изменить" title="Изменить" onClick={() => setEditing(l)}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Убрать медиатеку" title="Убрать" onClick={() => remove(l)}>
            <Trash className="size-4" />
          </Button>
        </div>
      </div>
    </Card>
  );

  return (
    <div className="grid gap-5">
      <ScanBar />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="title-display text-2xl">Общие медиатеки</h2>
        <Button onClick={() => setAdding(true)}>
          <FolderPlus className="size-4" /> Добавить медиатеку
        </Button>
      </div>
      {shared.length ? (
        <div className="grid items-start gap-4 xl:grid-cols-2">{shared.map(card)}</div>
      ) : (
        <p className="card px-5 py-4 text-sm text-muted">
          Общих медиатек пока нет. Подключите папку с книгами в docker-compose (например, <code>BOOKS_DIR=/volume2/books</code> в .env) и добавьте её здесь.
        </p>
      )}
      <h2 className="title-display mt-2 text-2xl">Личные медиатеки</h2>
      {personal.length ? (
        <div className="grid items-start gap-4 xl:grid-cols-2">{personal.map(card)}</div>
      ) : (
        <p className="card px-5 py-4 text-sm text-muted">Личную медиатеку видит только её владелец. Создаётся кнопкой «Добавить медиатеку» с типом «Личная».</p>
      )}
      <LibraryDialog open={adding} onClose={() => setAdding(false)} />
      <LibraryDialog open={editing !== null} onClose={() => setEditing(null)} lib={editing ?? undefined} />
    </div>
  );
}

// ---------------- пользователи ----------------

function UserDetail({ user, libs, me }: { user: AdminUser; libs: AdminLibrary[]; me: number }) {
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  const update = async (data: Parameters<typeof api.admin.updateUser>[1]) => {
    try {
      await api.admin.updateUser(user.id, data);
      invalidate(["admin", "users"]);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const access = new Map(user.access.map((a) => [a.library_id, a.can_write]));
  const setAccess = async (libId: number, read: boolean) => {
    const next = new Map(access);
    if (!read) next.delete(libId);
    else next.set(libId, Boolean(access.get(libId)));
    try {
      await api.admin.setAccess(
        user.id,
        [...next].map(([library_id, can_write]) => ({ library_id, can_write })),
      );
      invalidate(["admin"]);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const shared = libs.filter((l) => l.scope === "shared");
  const personal = libs.filter((l) => l.owner?.id === user.id);

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={() => setEditOpen(true)} aria-label="Изменить профиль" className="rounded-2xl transition hover:opacity-85">
          <Avatar name={user.display_name || user.username} src={user.avatar} className="size-14 rounded-2xl text-xl" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="title-display truncate text-2xl">{user.display_name || user.username}</h2>
          <div className="truncate text-sm text-muted">
            {user.username} · {user.email} · вход {formatDate(user.last_seen_at)}
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" /> Изменить
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPwOpen(true)}>
            <KeyRound className="size-4" /> Пароль
          </Button>
          {user.id !== me && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Удалить пользователя"
              onClick={async () => {
                const ok = await dialogs.confirm({
                  title: `Удалить ${user.username}?`,
                  text: "Удалятся его полки, прогресс чтения и личные медиатеки (файлы на диске останутся).",
                  action: "Удалить",
                  danger: true,
                });
                if (ok) api.admin.deleteUser(user.id).then(() => invalidate(["admin"])).catch((e) => toast.error((e as Error).message));
              }}
            >
              <Trash className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-3 rounded-2xl border bg-surface-2 p-4">
          <span>
            <span className="block font-semibold">Администратор</span>
            <span className="text-[13px] text-muted">Видит все общие медиатеки, управляет сервером</span>
          </span>
          <Switch label="Администратор" checked={user.is_admin} disabled={user.id === me} onChange={(v) => update({ is_admin: v })} />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-2xl border bg-surface-2 p-4">
          <span>
            <span className="block font-semibold">Активен</span>
            <span className="text-[13px] text-muted">Отключённый не сможет войти</span>
          </span>
          <Switch label="Активен" checked={user.is_active} disabled={user.id === me} onChange={(v) => update({ is_active: v })} />
        </label>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-[17px] font-bold">Общие медиатеки</h3>
        {user.is_admin && <div className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">Администратор всегда видит все общие медиатеки.</div>}
        {shared.length === 0 && <p className="text-sm text-muted">Общих медиатек пока нет.</p>}
        <div className="flex flex-col">
          {shared.map((l) => (
            <div key={l.id} className="flex items-center gap-3 border-t px-1 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{l.name}</div>
                <div className="truncate text-[12px] text-faint">{l.path}</div>
              </div>
              <Switch label={`Доступ: ${l.name}`} checked={user.is_admin || access.has(l.id)} disabled={user.is_admin} onChange={(v) => setAccess(l.id, v)} />
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2 border-t pt-5">
        <h3 className="text-[17px] font-bold">Личные медиатеки</h3>
        {personal.length ? (
          personal.map((l) => (
            <div key={l.id} className="flex items-center gap-3 text-sm">
              <Lock className="size-4 text-muted" />
              <span className="font-semibold">{l.name}</span>
              <span className="truncate text-faint">{l.path}</span>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted">Нет. Создать — во вкладке «Медиатеки», тип «Личная».</p>
        )}
      </section>

      <Dialog
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title={`Новый пароль для ${user.username}`}
        description="Пользователь выйдет на всех устройствах"
        footer={
          <Button type="submit" form="reset-form" disabled={pw.length < 8}>
            Сменить пароль
          </Button>
        }
      >
        <form
          id="reset-form"
          onSubmit={(e) => {
            e.preventDefault();
            api.admin
              .resetPassword(user.id, pw)
              .then(() => {
                toast.success("Пароль изменён");
                setPw("");
                setPwOpen(false);
              })
              .catch((err) => toast.error((err as Error).message));
          }}
        >
          <Field id="reset-pw" label="Пароль" hint="Минимум 8 символов">
            <Input id="reset-pw" type="text" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
        </form>
      </Dialog>
      <EditUserDialog open={editOpen} onClose={() => setEditOpen(false)} user={user} isMe={user.id === me} />
    </Card>
  );
}

/** Имя, логин, email и аватарка пользователя — для администратора. */
function EditUserDialog({ open, onClose, user, isMe }: { open: boolean; onClose: () => void; user: AdminUser; isMe: boolean }) {
  const [form, setForm] = useState({ display_name: user.display_name, username: user.username, email: user.email });
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setForm({ display_name: user.display_name, username: user.username, email: user.email });
  }, [open, user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = (u: AdminUser) => {
    invalidate(["admin"]);
    if (isMe) updateCurrentUser(u);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      done(await api.admin.updateUser(user.id, form));
      toast.success("Сохранено");
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Профиль пользователя"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="edit-user" disabled={busy}>
            {busy && <LoaderCircle className="size-4 animate-spin" />} Сохранить
          </Button>
        </>
      }
    >
      <form id="edit-user" onSubmit={submit} className="grid gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={form.display_name || form.username} src={user.avatar} className="size-20 rounded-2xl text-3xl" />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
              <ImageIcon className="size-4" /> {user.avatar ? "Заменить фото" : "Загрузить фото"}
            </Button>
            {user.avatar && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    done(await api.admin.deleteUserAvatar(user.id));
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              >
                <Trash className="size-4" /> Удалить
              </Button>
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) setFile(f);
            }}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="eu-name" label="Имя">
            <Input id="eu-name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </Field>
          <Field id="eu-login" label="Логин" hint="Латиница, цифры, точка, дефис">
            <Input
              id="eu-login"
              required
              pattern="[a-zA-Z0-9_.\-]{3,64}"
              autoCapitalize="none"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value.trim() })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field id="eu-email" label="Email">
              <Input id="eu-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          </div>
        </div>
      </form>
      <AvatarCropper
        file={file}
        onCancel={() => setFile(null)}
        onDone={async (blob) => {
          try {
            done(await api.admin.uploadUserAvatar(user.id, blob));
            setFile(null);
            toast.success("Аватарка обновлена");
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
      />
    </Dialog>
  );
}

function CreateUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const empty = { username: "", display_name: "", email: "", password: "", is_admin: false };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setForm(empty);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await api.admin.createUser(form);
      invalidate(["admin"]);
      toast.success(`Пользователь ${u.username} создан`);
      onCreated(u.id);
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Новый пользователь"
      description="Общие медиатеки с пометкой «для новых пользователей» откроются автоматически"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="new-user" disabled={busy}>
            {busy && <LoaderCircle className="size-4 animate-spin" />} Создать
          </Button>
        </>
      }
    >
      <form id="new-user" onSubmit={submit} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="nu-login" label="Логин">
            <Input id="nu-login" required pattern="[a-zA-Z0-9_.\-]{3,64}" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field id="nu-name" label="Имя">
            <Input id="nu-name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </Field>
        </div>
        <Field id="nu-email" label="Email">
          <Input id="nu-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field id="nu-pw" label="Пароль" hint="Минимум 8 символов, пользователь сможет сменить его в профиле">
          <Input id="nu-pw" required minLength={8} autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <label className="flex items-center justify-between gap-3 rounded-2xl border p-4">
          <span className="font-semibold">Администратор</span>
          <Switch label="Администратор" checked={form.is_admin} onChange={(v) => setForm({ ...form, is_admin: v })} />
        </label>
      </form>
    </Dialog>
  );
}

function UsersTab() {
  const { user: me } = useAuth();
  const users = useQuery(["admin", "users"], api.admin.users);
  const libs = useQuery(["admin", "libraries"], api.admin.libraries);
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  if (users.isLoading || libs.isLoading) return <PageLoader />;
  if (users.error) return <ErrorBox error={users.error} />;
  const list = users.data!;
  const current = list.find((u) => u.id === selected) ?? list.find((u) => u.id !== me?.id) ?? list[0];

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="flex flex-col gap-0.5 p-2 sm:p-2">
        {list.map((u) => (
          <button
            key={u.id}
            onClick={() => setSelected(u.id)}
            aria-pressed={current?.id === u.id}
            className={cn("flex items-center gap-3 rounded-xl p-3 text-left transition", current?.id === u.id ? "bg-accent-soft" : "hover:bg-surface-2")}
          >
            <Avatar name={u.display_name || u.username} src={u.avatar} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate font-semibold">
                {u.display_name || u.username}
                {!u.is_active && <Lock className="size-3.5 text-faint" />}
              </span>
              <span className="block truncate text-[13px] text-muted">{u.username}</span>
            </span>
            <span className={cn("text-[12px] font-bold", u.is_admin ? "text-accent-ink" : "text-faint")}>{u.is_admin ? "Админ" : "Читатель"}</span>
          </button>
        ))}
        <Button variant="outline" className="m-1 mt-2" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" /> Добавить пользователя
        </Button>
      </Card>
      {current && <UserDetail user={current} libs={libs.data ?? []} me={me?.id ?? 0} />}
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} onCreated={setSelected} />
    </div>
  );
}

export default function AdminPage() {
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab) || "libraries";
  return (
    <div className="flex flex-col gap-7">
      <PageHeader title="Управление" />
      <div className="scrollbar-none -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Segmented<Tab>
          label="Раздел"
          value={tab}
          onChange={(t) => setSearchParam("tab", t)}
          className="w-max min-w-full flex-nowrap sm:max-w-lg sm:min-w-0"
          options={[
            { value: "libraries", label: "Медиатеки" },
            { value: "users", label: "Пользователи" },
            { value: "general", label: "Общие" },
          ]}
        />
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "libraries" && <LibrariesTab />}
      {tab === "general" && <GeneralTab />}
    </div>
  );
}
