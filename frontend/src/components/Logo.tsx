import { cn } from "@/lib/utils";

/** Знак SelfRead: раскрытая книга. */
export function BookMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5.5C3 4.7 3.7 4 4.5 4H9c1.7 0 3 1.3 3 3v13c0-1.1-.9-2-2-2H3z" />
      <path d="M21 5.5c0-.8-.7-1.5-1.5-1.5H15c-1.7 0-3 1.3-3 3v13c0-1.1.9-2 2-2h7z" />
    </svg>
  );
}

export function LogoBadge({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-accent text-accent-fg",
        size === "sm" && "size-8 rounded-[9px]",
        size === "md" && "size-9 rounded-[10px]",
        size === "lg" && "size-14 rounded-[16px]",
        className,
      )}
    >
      <BookMark className={size === "lg" ? "size-8" : size === "sm" ? "size-5" : "size-[22px]"} />
    </span>
  );
}

export function Brand({ name = "SelfRead", className }: { name?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BookMark className="size-[30px] text-accent-ink" />
      <span className="title-display text-[22px] font-bold">{name}</span>
    </span>
  );
}
