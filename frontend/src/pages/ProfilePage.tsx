import { useRef, useState, type FormEvent } from "react";
import { AvatarCropper } from "@/components/AvatarCropper";
import { Check, Image as ImageIcon, LoaderCircle, LogOut, Trash } from "@/components/icons";
import { Avatar } from "@/components/Layout";
import { PageHeader } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Card } from "@/components/ui/misc";
import { Segmented, Switch } from "@/components/ui/switch";
import { api, setSession, updateCurrentUser, type LibraryScope, type Palette, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { invalidate } from "@/lib/query";
import { navigate, setSearchParam, useSearchParams } from "@/lib/router";
import { PALETTES, setThemePrefs, type PaletteInfo } from "@/lib/theme";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

function AvatarCard() {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  if (!user) return null;
  const name = user.display_name || user.username;
  const remove = async () => {
    try {
      updateCurrentUser(await api.me.deleteAvatar());
      toast.success("Аватарка удалена");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  return (
    <Card className="flex flex-wrap items-center gap-5">
      <Avatar name={name} src={user.avatar} className="size-24 rounded-2xl text-4xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <h2 className="title-display text-xl">Аватарка</h2>
          <p className="text-sm text-muted">JPG, PNG или WebP. Обрежем в квадрат — выберите нужную часть.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => input.current?.click()}>
            <ImageIcon className="size-4" /> {user.avatar ? "Заменить" : "Загрузить фото"}
          </Button>
          {user.avatar && (
            <Button variant="ghost" onClick={remove}>
              <Trash className="size-4" /> Удалить
            </Button>
          )}
        </div>
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
      <AvatarCropper
        file={file}
        onCancel={() => setFile(null)}
        onDone={async (blob) => {
          updateCurrentUser(await api.me.uploadAvatar(blob));
          setFile(null);
          toast.success("Аватарка обновлена");
        }}
      />
    </Card>
  );
}

function ProfileTab({ user }: { user: User }) {
  const { logout } = useAuth();
  const [form, setForm] = useState({ display_name: user.display_name, username: user.username, email: user.email });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("profile");
    try {
      updateCurrentUser(await api.me.update(form));
      toast.success("Сохранено");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setScope = async (library_scope: LibraryScope) => {
    try {
      updateCurrentUser(await api.me.update({ library_scope }));
      // списки книг зависят от выбора — обновим их
      invalidate(["home"], ["books"], ["facets"]);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("password");
    try {
      setSession(await api.me.changePassword(pw.current, pw.next));
      setPw({ current: "", next: "" });
      toast.success("Пароль изменён. На других устройствах нужно войти заново.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <AvatarCard />

      <Card>
        <form onSubmit={saveProfile} className="grid gap-5">
          <h2 className="title-display text-xl">Имя, логин и почта</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="p-name" label="Имя">
              <Input id="p-name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            </Field>
            <Field id="p-login" label="Логин" hint={form.username !== user.username ? "После сохранения входите с новым логином" : "Для входа на сайт"}>
              <Input
                id="p-login"
                required
                autoCapitalize="none"
                pattern="[a-zA-Z0-9_.\-]{3,64}"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.trim() })}
              />
            </Field>
            <Field id="p-email" label="Email">
              <Input id="p-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          </div>
          <div>
            <Button type="submit" disabled={busy === "profile"}>
              {busy === "profile" && <LoaderCircle className="size-4 animate-spin" />} Сохранить
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="title-display text-xl">Что показывать в библиотеке</h2>
          <p className="text-sm text-muted">Главная, «Все книги» и поиск. Отдельная медиатека из меню открывается всегда целиком.</p>
        </div>
        <Segmented<LibraryScope>
          label="Медиатеки"
          value={user.library_scope}
          onChange={setScope}
          options={[
            { value: "all", label: "Все медиатеки" },
            { value: "shared", label: "Только общие" },
            { value: "mine", label: "Только мои" },
          ]}
          className="max-w-lg"
        />
      </Card>

      <Card>
        <form onSubmit={changePassword} className="grid gap-5">
          <h2 className="title-display text-xl">Пароль</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="p-cur" label="Текущий пароль">
              <Input id="p-cur" type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </Field>
            <Field id="p-new" label="Новый пароль" hint="Минимум 8 символов">
              <Input id="p-new" type="password" autoComplete="new-password" required minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy === "password"}>
              {busy === "password" && <LoaderCircle className="size-4 animate-spin" />} Сменить пароль
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await api.auth.logoutAll().catch(() => {});
                await logout();
                navigate("/login");
              }}
            >
              <LogOut className="size-4" /> Выйти на всех устройствах
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}

function PalettePreview({ p }: { p: PaletteInfo }) {
  const c = p.preview;
  return (
    <span className="relative flex h-[124px] overflow-hidden rounded-[10px] border" style={{ background: c.bg, borderColor: c.line }}>
      <span className="flex w-11 flex-col gap-1.5 border-r px-2 py-2.5" style={{ background: c.side, borderColor: c.line }}>
        <span className="h-1.5 rounded-full" style={{ background: c.accent }} />
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1 rounded-full" style={{ background: c.line }} />
        ))}
      </span>
      <span className="flex flex-1 flex-col gap-2 p-3">
        <span className="text-[15px] font-bold" style={{ color: c.text, fontFamily: p.id === "paper" ? "Literata, serif" : p.id === "ink" ? "'PT Serif', serif" : "'Cormorant Garamond', serif" }}>
          Читаю сейчас
        </span>
        <span className="flex items-end gap-1.5">
          {c.covers.map((col) => (
            <span key={col} className="h-10 w-[26px] rounded-[2px_4px_4px_2px]" style={{ background: col }} />
          ))}
        </span>
        <span className="h-1 rounded-full" style={{ background: c.line }}>
          <span className="block h-1 w-[45%] rounded-full" style={{ background: c.accent }} />
        </span>
      </span>
    </span>
  );
}

function AppearanceTab({ user }: { user: User }) {
  const save = async (data: Partial<Pick<User, "palette" | "palette_auto" | "palette_day" | "palette_night">>) => {
    // сразу перекрашиваем, не дожидаясь сервера
    setThemePrefs({
      palette: data.palette ?? user.palette,
      auto: data.palette_auto ?? user.palette_auto,
      day: data.palette_day ?? user.palette_day,
      night: data.palette_night ?? user.palette_night,
    });
    try {
      updateCurrentUser(await api.me.update(data));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <>
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="title-display text-xl">Палитра интерфейса</h2>
          <p className="text-sm text-muted">Цвета и шрифты библиотеки, полок и меню. Сохраняется в профиле — на всех ваших устройствах.</p>
        </div>
        <div role="radiogroup" aria-label="Палитра" className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4">
          {PALETTES.map((p) => {
            const selected = !user.palette_auto && user.palette === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => save({ palette: p.id, palette_auto: false })}
                className={cn("flex flex-col gap-3 rounded-[14px] border-2 p-3 text-left transition", selected ? "border-accent" : "border-line hover:border-accent/50")}
              >
                <span className="relative">
                  <PalettePreview p={p} />
                  {selected && (
                    <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-accent text-accent-fg">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="flex flex-col gap-0.5 px-1 pb-1">
                  <span className="flex items-center gap-2 text-[16px] font-bold">
                    {p.name}
                    <span className="rounded-md border px-1.5 py-px text-[11px] font-semibold text-muted">{p.mode}</span>
                  </span>
                  <span className="text-[13px] text-muted">{p.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="title-display text-xl">Автоматическое переключение</h2>
            <p className="text-sm text-muted">Светлая палитра днём, тёмная ночью — вслед за настройкой устройства.</p>
          </div>
          <Switch checked={user.palette_auto} onChange={(v) => save({ palette_auto: v })} label="Автоматическое переключение" />
        </div>
        {user.palette_auto && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pal-day" label="Днём">
              <Select id="pal-day" value={user.palette_day} onChange={(e) => save({ palette_day: e.target.value as Palette })}>
                {PALETTES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="pal-night" label="Ночью">
              <Select id="pal-night" value={user.palette_night} onChange={(e) => save({ palette_night: e.target.value as Palette })}>
                {PALETTES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1 basis-80">
          <h2 className="title-display text-xl">Страница книги</h2>
          <p className="text-sm text-muted">Фон страницы (день, сепия, ночь), шрифт и поля книги настраиваются отдельно, прямо в читалке.</p>
        </div>
      </Card>
    </>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const params = useSearchParams();
  const tab = params.get("tab") === "appearance" ? "appearance" : "profile";
  if (!user) return null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title={tab === "appearance" ? "Оформление" : "Профиль"} subtitle={`${user.username}${user.is_admin ? " · администратор" : ""}`} />
      <Segmented<"profile" | "appearance">
        label="Раздел"
        value={tab}
        onChange={(v) => setSearchParam("tab", v === "profile" ? null : v)}
        options={[
          { value: "profile", label: "Профиль" },
          { value: "appearance", label: "Оформление" },
        ]}
        className="max-w-sm"
      />
      {tab === "appearance" ? <AppearanceTab user={user} /> : <ProfileTab user={user} />}
    </div>
  );
}
