import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/AuthShell";
import { LoaderCircle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, setSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@/lib/query";
import { Link, Navigate, navigate, useSearchParams } from "@/lib/router";
import { toast } from "@/lib/toast";

export default function LoginPage() {
  const { user } = useAuth();
  const settings = useQuery(["settings"], api.settings.get);
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next.startsWith("/") ? next : "/"} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setSession(await api.auth.login(login, password, remember));
      navigate(next.startsWith("/") ? next : "/", { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell siteName={settings.data?.site_name} title="С возвращением" subtitle="Войдите, чтобы продолжить чтение.">
      <form onSubmit={submit} className="grid gap-5">
        <Field id="login" label="Логин или email">
          <Input id="login" autoComplete="username" autoFocus required value={login} onChange={(e) => setLogin(e.target.value)} />
        </Field>
        <Field id="password" label="Пароль">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold select-none">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Запомнить меня
        </label>
        <Button type="submit" size="lg" disabled={busy}>
          {busy && <LoaderCircle className="size-4 animate-spin" />} Войти
        </Button>
      </form>
      {settings.data?.registration_mode === "open" && (
        <p className="mt-6 text-center text-sm text-muted">
          Ещё нет аккаунта?{" "}
          <Link to="/register" className="font-bold text-accent-ink hover:underline">
            Зарегистрироваться
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
