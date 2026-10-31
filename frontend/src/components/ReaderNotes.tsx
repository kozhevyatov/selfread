/** Части читалки для закладок и цитат: панель выделения, карточка цитаты, список «Закладки и цитаты». */
import { useEffect, useState } from "react";
import type { Annotation, AnnotationColor } from "@/lib/api";
import { COLORS, colorValue, whereLabel } from "@/lib/annotations";
import { cn } from "@/lib/utils";
import { Bookmark, Check, Copy, NotebookPen, Quote, Trash, X } from "./icons";

export function ColorDots({ value, onPick, size = "md" }: { value?: AnnotationColor; onPick: (c: AnnotationColor) => void; size?: "md" | "lg" }) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Цвет выделения">
      {COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          aria-label={c.label}
          onClick={() => onPick(c.id)}
          className={cn("flex items-center justify-center rounded-full transition hover:scale-110", size === "lg" ? "size-9" : "size-8")}
        >
          <span
            className={cn("block rounded-full", size === "lg" ? "size-7" : "size-6", value === c.id && "ring-2 ring-[var(--reader-fg)] ring-offset-2 ring-offset-[var(--reader-bg)]")}
            style={{ background: c.value }}
          />
        </button>
      ))}
    </div>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Панель над нижней строкой, пока в книге выделен текст. */
export function SelectionBar({
  text,
  onHighlight,
  onNote,
  onClose,
}: {
  text: string;
  onHighlight: (c: AnnotationColor) => void;
  onNote: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="animate-fade-in absolute inset-x-2 bottom-[max(3.8rem,calc(env(safe-area-inset-bottom)+3.4rem))] z-40 mx-auto flex max-w-xl flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl px-3 py-2 shadow-xl"
      style={{ background: "var(--reader-bg)", border: "1px solid color-mix(in srgb, var(--reader-fg) 14%, transparent)" }}
      role="toolbar"
      aria-label="Выделенный текст"
    >
      <ColorDots onPick={onHighlight} />
      <span className="h-6 w-px opacity-20" style={{ background: "var(--reader-fg)" }} />
      <button type="button" onClick={onNote} className="reader-btn h-10 gap-1.5 px-2.5 text-sm font-semibold">
        <NotebookPen className="size-4" /> Заметка
      </button>
      <button
        type="button"
        onClick={async () => {
          if (await copy(text)) {
            setCopied(true);
            window.setTimeout(onClose, 600);
          }
        }}
        className="reader-btn h-10 gap-1.5 px-2.5 text-sm font-semibold"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Скопировано" : "Копировать"}
      </button>
      <button type="button" onClick={onClose} aria-label="Снять выделение" className="reader-btn size-10">
        <X className="size-4" />
      </button>
    </div>
  );
}

/** Карточка цитаты: текст, заметка, цвет, удалить. Для новой цитаты — сразу с полем заметки. */
export function AnnotationSheet({
  annotation,
  onSave,
  onDelete,
  onClose,
}: {
  annotation: Pick<Annotation, "kind" | "text" | "note" | "color" | "chapter" | "progress"> & { id?: number };
  onSave: (patch: { note: string; color: AnnotationColor }) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(annotation.note);
  const [color, setColor] = useState<AnnotationColor>(annotation.color);
  useEffect(() => {
    setNote(annotation.note);
    setColor(annotation.color);
  }, [annotation.id, annotation.note, annotation.color]);
  const dirty = note !== annotation.note || color !== annotation.color || annotation.id === undefined;
  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={annotation.kind === "bookmark" ? "Закладка" : "Цитата"}
        className="animate-fade-in relative flex max-h-[85svh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl"
        style={{ background: "var(--reader-bg)", color: "var(--reader-fg)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-[12px] font-bold tracking-wide uppercase opacity-60">{whereLabel(annotation)}</span>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="reader-btn -mt-2 -mr-2 size-10">
            <X className="size-5" />
          </button>
        </div>
        {annotation.text && (
          <blockquote className="border-l-4 pl-4 text-[17px] leading-relaxed" style={{ borderColor: colorValue(color), fontFamily: "Literata, Georgia, serif" }}>
            {annotation.text.length > 1200 ? `${annotation.text.slice(0, 1200)}…` : annotation.text}
          </blockquote>
        )}
        {annotation.kind === "quote" && <ColorDots value={color} onPick={setColor} size="lg" />}
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold tracking-wide uppercase opacity-60">Заметка</span>
          <textarea
            autoFocus={annotation.id === undefined}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Мысль, вопрос, ассоциация…"
            className="min-h-24 resize-y rounded-xl border bg-transparent px-3 py-2 text-[15px] outline-none focus:border-[var(--reader-link)]"
            style={{ borderColor: "color-mix(in srgb, var(--reader-fg) 18%, transparent)" }}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {onDelete && (
            <button type="button" onClick={onDelete} className="reader-btn h-11 gap-1.5 px-3 text-sm font-semibold text-[#d0453b]">
              <Trash className="size-4" /> Удалить
            </button>
          )}
          {annotation.text && (
            <button type="button" onClick={() => void copy(annotation.text + (note ? `\n\n${note}` : ""))} className="reader-btn h-11 gap-1.5 px-3 text-sm font-semibold">
              <Copy className="size-4" /> Копировать
            </button>
          )}
          <button
            type="button"
            disabled={!dirty}
            onClick={() => onSave({ note: note.trim(), color })}
            className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: "var(--reader-link)" }}
          >
            <Check className="size-4" /> Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

/** Список закладок и цитат книги в боковой панели читалки. */
export function NotesPanel({
  items,
  onGo,
  onOpen,
}: {
  items: Annotation[];
  onGo: (a: Annotation) => void;
  onOpen: (a: Annotation) => void;
}) {
  const [tab, setTab] = useState<"all" | "quote" | "bookmark">("all");
  const shown = items.filter((a) => tab === "all" || a.kind === tab);
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="mx-2 flex gap-1 rounded-xl bg-black/5 p-1 dark:bg-white/8">
        {(
          [
            ["all", "Все"],
            ["quote", "Цитаты"],
            ["bookmark", "Закладки"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn("h-9 flex-1 rounded-lg text-[13px] font-semibold transition", tab === id ? "bg-[var(--reader-bg)] shadow" : "opacity-70")}
          >
            {label}
          </button>
        ))}
      </div>
      {shown.length === 0 && (
        <p className="px-3 text-sm leading-relaxed opacity-60">
          {tab === "bookmark"
            ? "Закладок нет. Значок закладки вверху отмечает текущую страницу."
            : "Цитат нет. Выделите текст в книге — появится панель: цвет, заметка, копировать."}
        </p>
      )}
      <ul className="flex flex-col">
        {shown.map((a) => (
          <li key={a.id} className="group flex items-start gap-1">
            <button type="button" onClick={() => onGo(a)} className="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5">
              <span className="mb-1 flex items-center gap-1.5 text-[12px] opacity-60">
                {a.kind === "bookmark" ? <Bookmark className="size-3.5" /> : <Quote className="size-3.5" style={{ color: colorValue(a.color) }} />}
                <span className="truncate">{whereLabel(a)}</span>
                {a.pending && <span>· не отправлено</span>}
              </span>
              {a.text && (
                <span
                  className={cn("line-clamp-4 block text-[14px] leading-snug", a.kind === "quote" && "border-l-[3px] pl-2")}
                  style={a.kind === "quote" ? { borderColor: colorValue(a.color) } : undefined}
                >
                  {a.text}
                </span>
              )}
              {a.note && <span className="mt-1 block text-[13px] italic opacity-75">{a.note}</span>}
            </button>
            <button type="button" onClick={() => onOpen(a)} aria-label="Изменить" className="reader-btn mt-1 size-9 shrink-0 opacity-60 group-hover:opacity-100">
              <NotebookPen className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
