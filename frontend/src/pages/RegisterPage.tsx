import { useState, type ChangeEvent, type FormEvent } from "react";
import { AuthShell } from "@/components/AuthShell";
import { LoaderCircle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { PageLoader } from "@/components/ui/misc";
import { api, setSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@/lib/query";
import { Link, Navigate, navigate } from "@/lib/router";
import { toast } from "@/lib/toast";

export default function RegisterPage() {
  const { user } = useAuth();
  const settings = useQuery(["settings"], api.settings.get);
  const [form, setForm] = useState({ username: "", display_name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" />;
  if (settings.isLoading) return <PageLoader />;
  if (settings.data?.registration_mode !== "open")
    return (
      <AuthShell siteName={settings.data?.site_name} title="Регистрация закрыта" subtitle="Попросите администратора создать вам учётную запись.">
        <Link to="/login" className="font-bold text-accent-ink hover:underline">
          Ко входу
        </Link>
      </AuthShell>
    );

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setSession(await api.auth.register(form));
      navigate("/", { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell siteName={settings.data?.site_name} title="Регистрация" subtitle="Музыка с домашнего сервера — для своих.">
      <form onSubmit={submit} className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="username" label="Логин" hint="Латиница, цифры, _ . -">
            <Input id="username" required autoComplete="username" pattern="[a-zA-Z0-9_.\-]{3,64}" value={form.username} onChange={set("username")} />
          </Field>
          <Field id="display_name" label="Имя">
            <Input id="display_name" value={form.display_name} onChange={set("display_name")} />
          </Field>
        </div>
        <Field id="email" label="Email">
          <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field id="password" label="Пароль" hint="Минимум 8 символов">
          <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set("password")} />
        </Field>
        <Button type="submit" size="lg" disabled={busy}>
          {busy && <LoaderCircle className="size-4 animate-spin" />} Создать аккаунт
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Уже есть аккаунт?{" "}
        <Link to="/login" className="font-bold text-accent-ink hover:underline">
          Войти
        </Link>
      </p>
    </AuthShell>
  );
}
