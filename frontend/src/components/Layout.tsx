import type { ReactNode } from "react";
import { api, type MyLibrary } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useOffline } from "@/lib/network";
import { useQuery } from "@/lib/query";
import { isActive, Link, navigate, useLocation } from "@/lib/router";
import { cn, hueOf } from "@/lib/utils";
import {
  Book,
  ChevronRight,
  Headphones,
  House,
  LibraryBig,
  Lock,
  LogOut,
  Palette,
  Plus,
  Search,
  Settings,
  Shield,
  User,
  Users,
  WifiOff,
} from "./icons";
import { Brand, BookMark } from "./Logo";
import { Menu } from "./ui/menu";

const NAV = [
  { to: "/", label: "Главная", icon: House },
  { to: "/books", label: "Все книги", icon: Book },
  { to: "/audio", label: "Аудиокниги", icon: Headphones },
  { to: "/shelves", label: "Полки", icon: LibraryBig },
];

const TABS = [
  { to: "/", label: "Главная", icon: House },
  { to: "/books", label: "Книги", icon: Book },
  { to: "/audio", label: "Аудио", icon: Headphones },
  { to: "/shelves", label: "Полки", icon: LibraryBig },
  { to: "/search", label: "Поиск", icon: Search },
];

/** Аватарка: квадрат со скруглением, без картинки — первая буква на цветном фоне. */
export function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  if (src) return <img src={src} alt="" aria-hidden="true" loading="lazy" className={cn("inline-block size-9 shrink-0 rounded-[10px] bg-surface-2 object-cover", className)} />;
  const n = (hueOf(name) % 6) + 1;
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] font-bold", className)}
      style={{ background: `var(--cover-${n})`, color: n === 4 ? "var(--cover-ink-4)" : "var(--cover-ink)" }}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function NavLink({ to, label, icon: Icon, pathname }: { to: string; label: string; icon: typeof House; pathname: string }) {
  const active = isActive(pathname, to);
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-[10px] px-3 font-medium transition",
        active ? "bg-accent-soft font-semibold text-accent-ink" : "text-fg hover:bg-surface-2",
      )}
    >
      <Icon className="size-5" strokeWidth={1.8} />
      {label}
    </Link>
  );
}

function ScopeBadge({ lib }: { lib: MyLibrary }) {
  return (
    <span className="rounded-md border px-1.5 py-px text-[11px] font-semibold text-muted">{lib.scope === "personal" ? "личная" : "общая"}</span>
  );
}

function SideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label-caps px-3 pb-1.5">{title}</span>
      {children}
    </div>
  );
}

function UserBlock() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const name = user.display_name || user.username;
  return (
    <div className="flex items-center gap-2.5 border-t px-2 pt-3">
      <Avatar name={name} src={user.avatar} />
      <Link to="/profile" className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate font-semibold">{name}</span>
        <span className="truncate text-xs text-muted">{user.is_admin ? "администратор" : user.username}</span>
      </Link>
      <Menu
        label="Меню пользователя"
        items={[
          { label: "Профиль", icon: <User />, onSelect: () => navigate("/profile") },
          { label: "Оформление", icon: <Palette />, onSelect: () => navigate("/profile?tab=appearance") },
          ...(user.is_admin ? [{ label: "Управление", icon: <Shield />, onSelect: () => navigate("/admin") }] : []),
          { separator: true as const },
          { label: "Выйти", icon: <LogOut />, onSelect: () => void logout(), danger: true },
        ]}
        trigger={(props) => (
          <button {...props} aria-label="Настройки" className="flex size-11 items-center justify-center rounded-[10px] text-muted hover:bg-surface-2 hover:text-fg">
            <Settings className="size-5" strokeWidth={1.8} />
          </button>
        )}
      />
    </div>
  );
}

function Sidebar() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const settings = useQuery(["settings"], api.settings.get, { staleTime: 5 * 60_000 });
  const libraries = useQuery(["libraries"], api.libraries);
  const shelves = useQuery(["shelves"], api.shelves.list);
  const libs = libraries.data ?? [];
  const own = (shelves.data ?? []).slice(0, 8);

  return (
    <aside className="hidden w-[256px] shrink-0 flex-col gap-6 overflow-y-auto border-r bg-side px-4 py-7 lg:flex">
      <Link to="/" className="px-2">
        <Brand name={settings.data?.site_name} />
      </Link>
      <nav aria-label="Основное" className="flex flex-col gap-0.5">
        {NAV.map((item) => (
          <NavLink key={item.to} {...item} pathname={pathname} />
        ))}
      </nav>

      <SideSection title="Медиатеки">
        {libs.map((lib) => (
          <Link
            key={lib.id}
            to={`/libraries/${lib.id}`}
            aria-current={isActive(pathname, `/libraries/${lib.id}`) ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-2.5 rounded-[10px] px-3 transition",
              isActive(pathname, `/libraries/${lib.id}`) ? "bg-accent-soft text-accent-ink" : "hover:bg-surface-2",
            )}
          >
            {lib.scope === "personal" ? <Lock className="size-[18px] text-muted" strokeWidth={1.8} /> : <Users className="size-[18px] text-muted" strokeWidth={1.8} />}
            <span className="min-w-0 flex-1 truncate">{lib.name}</span>
            <ScopeBadge lib={lib} />
          </Link>
        ))}
        {libraries.data && libs.length === 0 && <p className="px-3 text-sm text-faint">Пока нет медиатек</p>}
        {user?.is_admin && (
          <Link
            to="/admin?tab=libraries&new=1"
            className="mt-1 flex min-h-11 items-center gap-2.5 rounded-[10px] border border-dashed px-3 text-muted transition hover:border-accent hover:text-accent-ink"
          >
            <Plus className="size-[18px]" />
            Добавить медиатеку
          </Link>
        )}
      </SideSection>

      <SideSection title="Полки">
        {own.map((s) => (
          <Link
            key={s.id}
            to={`/shelves/${s.id}`}
            className={cn(
              "flex min-h-10 items-center gap-2.5 rounded-[10px] px-3 transition",
              isActive(pathname, `/shelves/${s.id}`) ? "bg-accent-soft text-accent-ink" : "hover:bg-surface-2",
            )}
          >
            <span className="size-2.5 rounded-[3px]" style={{ background: `var(--cover-${(s.id % 6) + 1})` }} />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="text-[13px] text-muted">{s.book_count}</span>
          </Link>
        ))}
        <Link to="/shelves?new=1" className="flex min-h-10 items-center gap-2.5 rounded-[10px] px-3 text-sm text-muted hover:bg-surface-2 hover:text-fg">
          <Plus className="size-4" /> Новая полка
        </Link>
      </SideSection>

      <div className="mt-auto">
        <UserBlock />
      </div>
    </aside>
  );
}

function MobileHeader() {
  const { user } = useAuth();
  const settings = useQuery(["settings"], api.settings.get, { staleTime: 5 * 60_000 });
  if (!user) return null;
  const name = user.display_name || user.username;
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-bg/95 px-4 pt-[max(0.6rem,env(safe-area-inset-top))] pb-2.5 backdrop-blur lg:hidden">
      <Link to="/" className="flex min-w-0 flex-1 items-center gap-2">
        <BookMark className="size-7 shrink-0 text-accent-ink" />
        <span className="title-display truncate text-xl font-bold">{settings.data?.site_name ?? "SelfRead"}</span>
      </Link>
      <Link to="/profile" aria-label="Профиль" className="flex items-center gap-1 rounded-xl p-1 hover:bg-surface-2">
        <Avatar name={name} src={user.avatar} className="size-8" />
        <ChevronRight className="size-4 text-faint" />
      </Link>
    </header>
  );
}

function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Разделы"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-side/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {TABS.map(({ to, label, icon: Icon }) => {
        const active = isActive(pathname, to);
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? "page" : undefined}
            className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold", active ? "text-accent-ink" : "text-muted")}
          >
            <Icon className="size-[22px]" strokeWidth={active ? 2.1 : 1.8} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function OfflineBanner() {
  return (
    <div className="card mb-6 flex items-center gap-3 px-4 py-3 text-sm">
      <WifiOff className="size-5 shrink-0 text-muted" />
      <span>Нет связи с сервером. Показано то, что уже было загружено.</span>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const offline = useOffline();
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <div id="app-scroll" className="flex min-w-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
        <MobileHeader />
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-5 pb-[96px] sm:px-6 lg:px-10 lg:pt-8 lg:pb-14">
          {offline && <OfflineBanner />}
          {children}
        </main>
      </div>
      <TabBar />
    </div>
  );
}
