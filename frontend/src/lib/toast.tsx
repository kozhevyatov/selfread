import { useSyncExternalStore } from "react";
import { CircleCheck, TriangleAlert, X } from "@/components/icons";
import { cn } from "./utils";

type Toast = { id: number; kind: "success" | "error" | "info"; text: string };

let items: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function push(kind: Toast["kind"], text: string, ms = 3500) {
  const id = ++seq;
  items = [...items.slice(-3), { id, kind, text }];
  emit();
  window.setTimeout(() => dismiss(id), ms);
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (text: string) => push("success", text),
  error: (text: string) => push("error", text, 5500),
  info: (text: string) => push("info", text),
};

export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => items,
  );
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4 sm:top-5"
    >
      {list.map((t) => (
        <div
          key={t.id}
          className="animate-fade-in pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border bg-surface px-4 py-3 text-sm font-semibold shadow-pop"
        >
          {t.kind === "error" ? (
            <TriangleAlert className="mt-px size-5 shrink-0 text-danger" />
          ) : (
            <CircleCheck className={cn("mt-px size-5 shrink-0", t.kind === "success" ? "text-success" : "text-accent-ink")} />
          )}
          <span className="flex-1">{t.text}</span>
          <button aria-label="Закрыть" onClick={() => dismiss(t.id)} className="-mr-1 text-faint hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
