import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type MenuItem =
  | { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string }
  | { separator: true };

/** Выпадающее меню, привязанное к кнопке. Закрывается по клику вне, Esc и прокрутке. */
export function Menu({
  trigger,
  items,
  align = "end",
  label,
  className,
}: {
  trigger: (props: { onClick: (e: ReactMouseEvent) => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  label: string;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const close = () => setAnchor(null);

  useLayoutEffect(() => {
    if (!anchor || !menuRef.current) return;
    const m = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = align === "end" ? anchor.right - m.width : anchor.left;
    left = Math.max(8, Math.min(left, vw - m.width - 8));
    let top = anchor.bottom + 6;
    if (top + m.height > vh - 8) top = Math.max(8, anchor.top - m.height - 6);
    setPos({ top, left });
    menuRef.current.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus();
  }, [anchor, align]);

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const all = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
        const i = all.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "ArrowDown" ? all[(i + 1) % all.length] : all[(i - 1 + all.length) % all.length];
        next?.focus();
      }
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [anchor]);

  return (
    <>
      {trigger({
        onClick: (e) => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPos(null);
          setAnchor((a) => (a ? null : rect));
        },
        "aria-expanded": Boolean(anchor),
        "aria-haspopup": "menu",
      })}
      {anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
            className={cn(
              "fixed z-[90] min-w-56 max-w-80 rounded-2xl border bg-surface p-1.5 shadow-pop",
              pos && "animate-fade-in",
              className,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {items.map((item, i) =>
              "separator" in item ? (
                <div key={i} className="my-1.5 h-px bg-line" />
              ) : (
                <button
                  key={i}
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-semibold outline-none disabled:opacity-40",
                    "hover:bg-surface-2 focus-visible:bg-surface-2 [&_svg]:size-[18px] [&_svg]:shrink-0",
                    item.danger ? "text-danger" : "text-fg [&_svg]:text-muted",
                  )}
                >
                  {item.icon}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="text-xs text-faint">{item.hint}</span>}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
