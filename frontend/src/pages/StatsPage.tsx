/**
 * Статистика чтения: время сегодня/за неделю/за год, серия дней подряд, цель на год,
 * календарь чтения (как у GitHub), время по месяцам (книги и аудио), прочитанное и «больше всего времени».
 */
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BookCover, BookGrid } from "@/components/books";
import { Check, Flame, Pencil, Target, Trophy } from "@/components/icons";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBox, PageLoader } from "@/components/ui/misc";
import { api, updateCurrentUser, type Stats } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { invalidate, useQuery } from "@/lib/query";
import { Link } from "@/lib/router";
import { toast } from "@/lib/toast";
import { cn, countLabel } from "@/lib/utils";

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** «меньше минуты», «42 мин», «5 ч 20 мин», «152 ч» */
export function hours(seconds: number) {
  const m = Math.round(seconds / 60);
  if (seconds > 0 && m < 1) return "меньше минуты";
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  return h < 24 && m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`;
}

function Tile({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col gap-1 p-5">
      <span className="label-caps flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className="num text-[28px] leading-tight font-bold">{value}</span>
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </div>
  );
}

function GoalCard({ stats, current }: { stats: Stats; current: boolean }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(stats.goal || 24));
  const done = stats.finished.length;
  const goal = stats.goal;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = Math.max(0, Math.min(1000, parseInt(value, 10) || 0));
    try {
      const u = await api.me.update({ reading_goal: n });
      updateCurrentUser(u);
      invalidate(["stats"]);
      setEditing(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (!current) {
    return <Tile label={`Прочитано в ${stats.year}`} value={countLabel(done, "книга", "книги", "книг")} icon={<Trophy className="size-3.5" />} />;
  }
  const pct = goal ? Math.min(100, Math.round((done / goal) * 100)) : 0;
  // сколько должно быть прочитано к сегодняшнему дню, чтобы успеть
  const now = new Date(stats.today);
  const dayOfYear = Math.floor((now.getTime() - new Date(stats.year, 0, 1).getTime()) / 86400000) + 1;
  const expected = goal ? Math.round((goal * dayOfYear) / 365) : 0;
  return (
    <div className="card flex flex-col gap-3 p-5 sm:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <span className="label-caps flex items-center gap-1.5">
          <Target className="size-3.5" /> Цель на {stats.year}
        </span>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline">
            <Pencil className="size-3.5" /> {goal ? "Изменить" : "Поставить цель"}
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <span>Прочитать</span>
          <Input aria-label="Книг за год" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 4))} className="h-10 w-20 text-center" autoFocus />
          <span>книг за год</span>
          <Button type="submit" size="sm">
            <Check className="size-4" /> Сохранить
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Отмена
          </Button>
          {user && goal > 0 && <span className="w-full text-[13px] text-muted">0 — без цели</span>}
        </form>
      ) : goal ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="num text-[28px] leading-tight font-bold">{done}</span>
            <span className="text-muted">из {countLabel(goal, "книги", "книг", "книг")}</span>
            <span className="num ml-auto text-sm font-semibold">{pct}%</span>
          </div>
          <span className="relative block h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={goal}>
            <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            {expected > 0 && expected < goal && <span className="absolute inset-y-0 w-0.5 bg-fg/40" style={{ left: `${(expected / goal) * 100}%` }} title={`К сегодняшнему дню по плану — ${expected}`} />}
          </span>
          <span className="text-sm text-muted">
            {done >= goal
              ? "Цель выполнена 🎉"
              : done >= expected
                ? `Идёте с опережением: по плану к сегодняшнему дню — ${expected}`
                : `Чтобы успеть, нужно ещё ${goal - done} — по плану к сегодняшнему дню ${expected}`}
          </span>
        </>
      ) : (
        <span className="text-sm text-muted">Поставьте цель — сколько книг хотите прочитать в этом году. Прочитанные отмечаются статусом «Прочитано».</span>
      )}
    </div>
  );
}

/** Календарь чтения: неделя — столбец, день — клетка, чем дольше читали, тем насыщеннее. */
function Heatmap({ stats }: { stats: Stats }) {
  const [hover, setHover] = useState<{ day: string; secs: number; x: number; y: number } | null>(null);
  const { weeks, monthStarts, max } = useMemo(() => {
    const first = new Date(stats.year, 0, 1);
    const offset = (first.getDay() + 6) % 7; // понедельник — первая строка
    const start = new Date(stats.year, 0, 1 - offset);
    const weeks: { day: string; secs: number; inYear: boolean }[][] = [];
    const monthStarts: { col: number; label: string }[] = [];
    const d = new Date(start);
    const p = (n: number) => String(n).padStart(2, "0");
    while (d.getFullYear() <= stats.year) {
      const week: { day: string; secs: number; inYear: boolean }[] = [];
      for (let i = 0; i < 7; i++) {
        const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        const inYear = d.getFullYear() === stats.year;
        if (inYear && d.getDate() === 1) monthStarts.push({ col: weeks.length, label: MONTHS_SHORT[d.getMonth()] });
        week.push({ day: key, secs: stats.days[key] ?? 0, inYear });
        d.setDate(d.getDate() + 1);
      }
      weeks.push(week);
      if (d.getFullYear() > stats.year) break;
    }
    const max = Math.max(1, ...Object.values(stats.days));
    return { weeks, monthStarts, max };
  }, [stats]);

  // 4 ступени одного цвета: доля от самого «читающего» дня (но час и больше — всегда самая тёмная)
  const level = (secs: number) => {
    if (secs < 60) return 0;
    const top = Math.min(max, 3600);
    const r = secs / top;
    return r >= 1 ? 4 : r >= 0.6 ? 3 : r >= 0.3 ? 2 : 1;
  };
  const fill = ["var(--surface-3)", "color-mix(in srgb, var(--chart-ebook) 30%, var(--surface))", "color-mix(in srgb, var(--chart-ebook) 55%, var(--surface))", "color-mix(in srgb, var(--chart-ebook) 78%, var(--surface))", "var(--chart-ebook)"];
  const label = (day: string) => new Date(day).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" });

  return (
    <div className="card relative flex flex-col gap-3 p-5">
      <div className="overflow-x-auto pb-1">
        <div className="relative inline-flex flex-col gap-1.5">
          <div className="relative h-4 text-[11px] text-muted" style={{ width: weeks.length * 15 }}>
            {monthStarts.map((m) => (
              <span key={m.label} className="absolute" style={{ left: m.col * 15 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="flex gap-[3px]" role="img" aria-label={`Календарь чтения за ${stats.year}: ${Object.keys(stats.days).length} дней с чтением`} onMouseLeave={() => setHover(null)}>
            {weeks.map((w, i) => (
              <div key={i} className="flex flex-col gap-[3px]">
                {w.map((c) => (
                  <span
                    key={c.day}
                    className={cn("block size-3 rounded-[3px]", !c.inYear && "invisible")}
                    style={{ background: fill[level(c.secs)] }}
                    onMouseEnter={(e) => {
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const host = (e.currentTarget.closest(".card") as HTMLElement).getBoundingClientRect();
                      setHover({ day: c.day, secs: c.secs, x: r.left - host.left + 6, y: r.top - host.top });
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted">
        <span>
          {countLabel(stats.active_days, "день", "дня", "дней")} с чтением{stats.active_days ? ` · в среднем ${hours(stats.avg_per_active_day)} в такой день` : ""}
        </span>
        <span className="flex items-center gap-1">
          меньше
          {fill.map((f, i) => (
            <span key={i} className="block size-3 rounded-[3px]" style={{ background: f }} />
          ))}
          больше
        </span>
      </div>
      {hover && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border bg-surface px-2.5 py-1.5 text-[12px] shadow-pop" style={{ left: hover.x, top: hover.y - 6 }}>
          <div className="font-semibold">{label(hover.day)}</div>
          <div className="text-muted">{hover.secs ? hours(hover.secs) : "не читали"}</div>
        </div>
      )}
    </div>
  );
}

/** Время по месяцам: столбик = книги + аудио, сверху — сколько прочитано книг. */
function MonthBars({ stats }: { stats: Stats }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(60, ...stats.months.map((m) => m.ebook + m.audio));
  const H = 160;
  const hasAudio = stats.months.some((m) => m.audio > 0);
  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="block size-3 rounded-[3px]" style={{ background: "var(--chart-ebook)" }} /> Чтение · {hours(stats.seconds.ebook)}
        </span>
        {hasAudio && (
          <span className="flex items-center gap-1.5">
            <span className="block size-3 rounded-[3px]" style={{ background: "var(--chart-audio)" }} /> Аудио · {hours(stats.seconds.audio)}
          </span>
        )}
      </div>
      <div className="relative">
        <div className="grid grid-cols-12 items-end gap-1.5 sm:gap-3" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          {stats.months.map((m, i) => {
            const eh = (m.ebook / max) * H;
            const ah = (m.audio / max) * H;
            return (
              <button
                key={m.month}
                type="button"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${MONTHS[i]}: чтение ${hours(m.ebook)}, аудио ${hours(m.audio)}, прочитано ${m.finished}`}
                className="flex h-full flex-col items-stretch justify-end gap-[2px] rounded-md px-0.5 hover:bg-surface-2"
              >
                {ah > 0 && <span className="block rounded-t-[4px]" style={{ height: Math.max(2, ah), background: "var(--chart-audio)" }} />}
                {eh > 0 && <span className={cn("block", ah > 0 ? "" : "rounded-t-[4px]")} style={{ height: Math.max(2, eh), background: "var(--chart-ebook)" }} />}
              </button>
            );
          })}
        </div>
        <div className="mt-1 h-px bg-line" />
        <div className="mt-1.5 grid grid-cols-12 gap-1.5 text-center text-[11px] text-muted sm:gap-3">
          {MONTHS_SHORT.map((m, i) => (
            <span key={m} className={cn(hover === i && "font-semibold text-fg")}>
              {m}
            </span>
          ))}
        </div>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border bg-surface px-3 py-2 text-[12px] shadow-pop"
            style={{ left: `${((hover + 0.5) / 12) * 100}%` }}
          >
            <div className="font-semibold capitalize">{MONTHS[hover]}</div>
            <div>Чтение: {hours(stats.months[hover].ebook)}</div>
            {hasAudio && <div>Аудио: {hours(stats.months[hover].audio)}</div>}
            <div className="text-muted">Прочитано книг: {stats.months[hover].finished}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function StatsPage() {
  const [year, setYear] = useState<number | undefined>(undefined);
  const stats = useQuery(["stats", year ?? "current"], () => api.stats.get(year));
  if (stats.isLoading) return <PageLoader />;
  if (stats.error) return <ErrorBox error={stats.error} />;
  const s = stats.data!;
  const current = s.year === new Date(s.today).getFullYear();
  const empty = !s.seconds.year && !s.finished.length;

  return (
    <div className="flex flex-col gap-9">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Время считается, пока книга открыта и вы её листаете, или пока играет аудиокнига</p>
          <h1 className="title-display mt-1 text-[30px] sm:text-[34px]">Статистика</h1>
        </div>
        {s.years.length > 1 && (
          <div role="radiogroup" aria-label="Год" className="flex gap-1 rounded-xl bg-surface-2 p-1">
            {s.years.map((y) => (
              <button
                key={y}
                type="button"
                role="radio"
                aria-checked={s.year === y}
                onClick={() => setYear(y)}
                className={cn("num h-9 rounded-lg px-3 text-sm font-semibold", s.year === y ? "bg-surface shadow-sm" : "text-muted hover:text-fg")}
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {current && <Tile label="Сегодня" value={hours(s.seconds.today)} hint={`за неделю — ${hours(s.seconds.week)}`} />}
        <Tile label={current ? "За год" : `За ${s.year}`} value={hours(s.seconds.year)} hint={current ? `за 30 дней — ${hours(s.seconds.month)}` : undefined} />
        {current && (
          <Tile
            label="Дней подряд"
            icon={<Flame className="size-3.5" />}
            value={s.streak}
            hint={s.best_streak > s.streak ? `рекорд — ${countLabel(s.best_streak, "день", "дня", "дней")}` : s.streak ? "это ваш рекорд" : "почитайте сегодня хотя бы минуту"}
          />
        )}
        <GoalCard stats={s} current={current} />
      </div>

      {empty ? (
        <p className="card px-5 py-4 text-sm text-muted">
          Пока пусто. Откройте книгу в читалке или включите аудиокнигу — время начнёт считаться, а календарь заполнится.{" "}
          <Link to="/books" className="font-semibold text-accent-ink hover:underline">
            К книгам
          </Link>
        </p>
      ) : (
        <>
          <Section title="Календарь чтения">
            <Heatmap stats={s} />
          </Section>
          <Section title="По месяцам">
            <MonthBars stats={s} />
          </Section>
        </>
      )}

      {s.top.length > 0 && (
        <Section title="Больше всего времени">
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {s.top.map(({ book, seconds }, i) => (
              <li key={book.id}>
                <Link to={`/books/${book.id}`} className="card flex items-center gap-3 p-3 transition hover:-translate-y-0.5">
                  <span className="num w-5 shrink-0 text-center text-sm font-bold text-faint">{i + 1}</span>
                  <div className="w-12 shrink-0">
                    <BookCover book={book} size="sm" />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 font-semibold leading-snug">{book.title}</span>
                    <span className="num text-sm text-muted">{hours(seconds)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title={`Прочитано в ${s.year} · ${s.finished.length}`}>
        {s.finished.length ? (
          <BookGrid books={s.finished} />
        ) : (
          <p className="card px-5 py-4 text-sm text-muted">Здесь появятся книги, отмеченные «Прочитано» в этом году.</p>
        )}
      </Section>
    </div>
  );
}
