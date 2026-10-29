import type { ReactNode } from "react";
import { Brand } from "./Logo";

/** Страницы входа, регистрации и установки: форма на карточке поверх спокойного фона. */
export function AuthShell({
  siteName,
  title,
  subtitle,
  children,
  wide = false,
  top,
}: {
  siteName?: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  top?: ReactNode;
}) {
  return (
    <div className="relative isolate flex min-h-svh flex-col items-center px-4 py-8 sm:py-14">
      <ShelfBackdrop />
      <Brand name={siteName} />
      <div className={`card mt-8 w-full p-6 sm:p-10 ${wide ? "max-w-[720px]" : "max-w-[460px]"}`}>
        {top}
        <h1 className="title-display text-[30px] sm:text-[34px]">{title}</h1>
        {subtitle && <p className="mt-2 leading-relaxed text-muted">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

/** Фон: полка с корешками книг внизу экрана (цвета — из палитры). */
function ShelfBackdrop() {
  const spines = [
    [18, 86, 1], [24, 74, 2], [14, 92, 3], [20, 66, 4], [26, 80, 5], [16, 70, 6], [22, 88, 1], [18, 60, 3],
    [28, 78, 2], [14, 84, 5], [20, 72, 4], [24, 90, 6], [16, 64, 1], [22, 82, 3], [18, 76, 2], [26, 68, 5],
  ] as const;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 overflow-hidden opacity-[0.22]">
      <div className="flex items-end justify-center gap-1.5 px-4">
        {Array.from({ length: 3 }).flatMap((_, r) =>
          spines.map(([w, h, c], i) => (
            <span key={`${r}-${i}`} className="shrink-0 rounded-t-[3px]" style={{ width: w, height: h, background: `var(--cover-${c})` }} />
          )),
        )}
      </div>
      <div className="h-2.5 bg-[var(--cover-6)]" />
    </div>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol aria-label="Шаги установки" className="mb-8 grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((label, i) => (
        <li key={label} aria-current={i === current ? "step" : undefined} className="flex flex-col gap-2.5">
          <span className={`h-1 rounded-full ${i <= current ? "bg-accent" : "bg-surface-3"}`} />
          <span className={`text-[12px] font-bold sm:text-[13px] ${i === current ? "text-fg" : "text-faint"}`}>
            {i + 1}. {label}
          </span>
        </li>
      ))}
    </ol>
  );
}
