import type { ReactNode } from "react";
import { LoaderCircle } from "@/components/icons";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("size-5 animate-spin text-faint", className)} />;
}

export function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

export function Empty({
  icon,
  title,
  text,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  text?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-16 text-center", className)}>
      {icon && <div className="mb-1 flex size-16 items-center justify-center rounded-2xl border bg-surface text-accent-ink shadow-card [&_svg]:size-7">{icon}</div>}
      <h3 className="title-display text-xl">{title}</h3>
      {text && <p className="max-w-sm text-sm leading-relaxed text-muted">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: Error | null }) {
  if (!error) return null;
  return <Empty title="Не удалось загрузить" text={error.message} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("card p-5 sm:p-6", className)}>{children}</div>;
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-line px-1.5 py-0.5 text-[11px] font-bold tracking-wide whitespace-nowrap text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-surface-3", className)}>
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
