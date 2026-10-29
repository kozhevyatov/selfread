import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { AuthShell, Stepper } from "@/components/AuthShell";
import { CircleCheck, Database, HardDrive, KeyRound, LoaderCircle, Server } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, setSession, type DatabaseConfig } from "@/lib/api";
import { invalidate, setQueryData, useQuery } from "@/lib/query";
import { navigate } from "@/lib/router";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export const SETUP_STEPS = ["База данных", "Администратор", "Медиатеки", "Готово"];

function OptionCard({ selected, onClick, icon, title, text }: { selected: boolean; onClick: () => void; icon: ReactNode; title: string; text: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-2 rounded-2xl border-2 p-4 text-left transition",
        selected ? "border-accent bg-accent/8" : "border-line bg-surface hover:border-accent/40",
      )}
    >
      <span className={cn("flex w-full items-center justify-between")}>
        <span className={cn("rounded-xl p-2", selected ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}>{icon}</span>
        <span className={cn("size-5 rounded-full border-2", selected ? "border-[6px] border-accent" : "border-surface-3")} />
      </span>
      <span className="text-[16px] font-extrabold">{title}</span>
      <span className="text-[13px] leading-relaxed text-muted">{text}</span>
    </button>
  );
}

function DatabaseStep({ token, onDone }: { token: string; onDone: () => void }) {
  const [cfg, setCfg] = useState<DatabaseConfig>({ type: "sqlite", host: "db", port: 3306, user: "root", password: "", database: "selfread" });
  const [tested, setTested] = useState(false);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);

  const set = (k: keyof DatabaseConfig) => (e: ChangeEvent<HTMLInputElement>) => {
    setTested(false);
    setCfg((c) => ({ ...c, [k]: k === "port" ? Number(e.target.value) || undefined : e.target.value }));
  };

  const test = async () => {
    setBusy("test");
    try {
      await api.setup.testDb(cfg, token);
      setTested(true);
      toast.success("Подключение работает");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("save");
    try {
      await api.setup.database(cfg, token);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <form onSubmit={save} className="grid gap-6">
      <div role="radiogroup" aria-label="База данных" className="grid gap-3 sm:grid-cols-2">
        <OptionCard
          selected={cfg.type === "sqlite"}
          onClick={() => setCfg((c) => ({ ...c, type: "sqlite" }))}
          icon={<HardDrive className="size-5" />}
          title="Встроенная SQLite"
          text="Ничего настраивать не нужно, файл базы лежит в папке приложения."
        />
        <OptionCard
          selected={cfg.type === "mysql"}
          onClick={() => {
            setTested(false);
            setCfg((c) => ({ ...c, type: "mysql" }));
          }}
          icon={<Server className="size-5" />}
          title="MySQL / MariaDB"
          text="Свой сервер базы данных. Подходит для больших библиотек и бэкапов."
        />
      </div>

      {cfg.type === "mysql" && (
        <div className="grid gap-4">
          <div className="grid grid-cols-[1fr_6.5rem] gap-3">
            <Field id="host" label="Хост" hint="Имя контейнера MariaDB, например db">
              <Input id="host" required value={cfg.host ?? ""} onChange={set("host")} />
            </Field>
            <Field id="port" label="Порт">
              <Input id="port" type="number" value={cfg.port ?? ""} onChange={set("port")} />
            </Field>
          </div>
          <Field id="database" label="Имя базы" hint="Базу нужно создать заранее (utf8mb4)">
            <Input id="database" required value={cfg.database ?? ""} onChange={set("database")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="user" label="Пользователь">
              <Input id="user" required autoComplete="off" value={cfg.user ?? ""} onChange={set("user")} />
            </Field>
            <Field id="dbpass" label="Пароль">
              <Input id="dbpass" type="password" autoComplete="new-password" value={cfg.password ?? ""} onChange={set("password")} />
            </Field>
          </div>
          {tested ? (
            <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success/10 px-4 py-3 text-sm font-semibold text-success">
              <CircleCheck className="size-5" /> Подключение установлено
            </div>
          ) : (
            <Button variant="outline" onClick={test} disabled={busy !== null}>
              {busy === "test" ? <LoaderCircle className="size-4 animate-spin" /> : <Database className="size-4" />} Проверить подключение
            </Button>
          )}
        </div>
      )}

      <div className="flex justify-end border-t pt-6">
        <Button type="submit" size="lg" disabled={busy !== null}>
          {busy === "save" && <LoaderCircle className="size-4 animate-spin" />} Далее: администратор
        </Button>
      </div>
    </form>
  );
}

function AdminStep({ token }: { token: string }) {
  const [form, setForm] = useState({ username: "admin", display_name: "", email: "", password: "", confirm: "", site_name: "SelfRead" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) return toast.error("Пароли не совпадают");
    setBusy(true);
    try {
      const res = await api.setup.admin(
        {
          username: form.username,
          display_name: form.display_name,
          email: form.email,
          password: form.password,
          site_name: form.site_name,
          registration_mode: open ? "open" : "closed",
        },
        token,
      );
      setSession(res);
      setQueryData(["setup-status"], (s: { setup_complete: boolean } | undefined) => (s ? { ...s, setup_complete: true } : s));
      invalidate(["settings"]);
      navigate("/welcome", { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="username" label="Логин" hint="Латиница, цифры, _ . -">
          <Input id="username" required autoComplete="username" value={form.username} onChange={set("username")} />
        </Field>
        <Field id="display_name" label="Имя">
          <Input id="display_name" value={form.display_name} onChange={set("display_name")} />
        </Field>
      </div>
      <Field id="email" label="Email">
        <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="password" label="Пароль" hint="Минимум 8 символов">
          <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set("password")} />
        </Field>
        <Field id="confirm" label="Ещё раз">
          <Input id="confirm" type="password" required autoComplete="new-password" value={form.confirm} onChange={set("confirm")} />
        </Field>
      </div>
      <div className="mt-1 grid gap-5 border-t pt-6">
        <Field id="site_name" label="Название сервиса">
          <Input id="site_name" required value={form.site_name} onChange={set("site_name")} />
        </Field>
        <div className="flex items-start justify-between gap-4 rounded-2xl border bg-surface p-4">
          <span>
            <span className="block font-bold">Свободная регистрация</span>
            <span className="text-sm text-muted">Любой, у кого есть ссылка, сможет создать аккаунт. Можно поменять позже.</span>
          </span>
          <Switch checked={open} onChange={setOpen} label="Свободная регистрация" />
        </div>
      </div>
      <div className="flex justify-end border-t pt-6">
        <Button type="submit" size="lg" disabled={busy}>
          {busy && <LoaderCircle className="size-4 animate-spin" />} Далее: медиатеки
        </Button>
      </div>
    </form>
  );
}

export default function SetupPage() {
  const status = useQuery(["setup-status"], api.setup.status);
  const [dbDone, setDbDone] = useState(false);
  const [token, setToken] = useState("");
  const step = status.data?.database_configured || dbDone ? 1 : 0;

  return (
    <AuthShell
      wide
      top={<Stepper steps={SETUP_STEPS} current={step} />}
      title={step === 0 ? "Где хранить данные?" : "Администратор"}
      subtitle={
        step === 0
          ? "Здесь будут пользователи, полки, статусы и прогресс чтения. Сами книги остаются в своих папках."
          : "Этот пользователь управляет медиатеками, доступом и регистрацией."
      }
    >
      {status.data?.setup_token_required && (
        <div className="mb-6">
          <Field id="setup_token" label="Токен настройки" hint="Значение SETUP_TOKEN из docker-compose">
            <div className="relative">
              <KeyRound className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint" />
              <Input id="setup_token" className="pl-10" value={token} onChange={(e) => setToken(e.target.value)} />
            </div>
          </Field>
        </div>
      )}
      {step === 0 ? <DatabaseStep token={token} onDone={() => setDbDone(true)} /> : <AdminStep token={token} />}
    </AuthShell>
  );
}
