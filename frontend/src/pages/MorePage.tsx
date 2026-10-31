/** «Ещё» на телефоне: разделы, которым не хватило места в нижнем меню. */
import { BookOpen, ChevronRight, CloudUpload, Palette, Search, Shield, User } from "@/components/icons";
import { MINE } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { dialogs } from "@/lib/dialogs";
import { Link } from "@/lib/router";

export default function MorePage() {
  const { user } = useAuth();
  const items = [
    { to: "/search", label: "Поиск", icon: Search },
    { to: "/ebooks", label: "Электронные книги", icon: BookOpen },
    ...MINE,
    { to: "/profile", label: "Профиль", icon: User },
    { to: "/profile?tab=appearance", label: "Оформление", icon: Palette },
    ...(user?.is_admin ? [{ to: "/admin", label: "Управление", icon: Shield }] : []),
  ];
  return (
    <div className="flex flex-col gap-5">
      <h1 className="title-display text-[30px]">Ещё</h1>
      <nav className="card flex flex-col divide-y">
        {items.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="flex min-h-14 items-center gap-3.5 px-4 font-medium hover:bg-surface-2">
            <Icon className="size-5 text-accent-ink" strokeWidth={1.8} />
            <span className="flex-1">{label}</span>
            <ChevronRight className="size-4 text-faint" />
          </Link>
        ))}
        <button type="button" onClick={() => dialogs.upload()} className="flex min-h-14 items-center gap-3.5 px-4 text-left font-medium hover:bg-surface-2">
          <CloudUpload className="size-5 text-accent-ink" strokeWidth={1.8} />
          <span className="flex-1">Загрузить книги</span>
          <ChevronRight className="size-4 text-faint" />
        </button>
      </nav>
    </div>
  );
}
