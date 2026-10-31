/** Закладки и цитаты книги: загрузка (с ещё не отправленными), создание, правка, удаление. */
import { api, type Annotation, type AnnotationColor, type AnnotationInput } from "./api";
import { invalidate, setQueryData, useQuery } from "./query";
import { createAnnotation, dropPendingAnnotation, pendingAnnotations, useOutboxSize } from "./sync";

export const COLORS: { id: AnnotationColor; label: string; value: string }[] = [
  { id: "yellow", label: "Жёлтый", value: "#f2c94c" },
  { id: "green", label: "Зелёный", value: "#6fcf97" },
  { id: "blue", label: "Голубой", value: "#56b4f0" },
  { id: "pink", label: "Розовый", value: "#f28bb5" },
  { id: "purple", label: "Сиреневый", value: "#b48cf2" },
];

export const colorValue = (c: AnnotationColor | string) => COLORS.find((x) => x.id === c)?.value ?? COLORS[0].value;

export function useAnnotations(bookId: number, enabled = true) {
  const q = useQuery(["annotations", bookId], () => api.annotations.forBook(bookId), { enabled: enabled && bookId > 0 });
  useOutboxSize(); // перерисовать, когда очередь отправилась
  const pending = enabled ? pendingAnnotations(bookId) : [];
  const list = [...(q.data ?? []), ...pending];
  return { ...q, list };
}

function refresh(bookId: number) {
  invalidate(["annotations", bookId], ["annotations-all"]);
}

export async function addAnnotation(bookId: number, data: AnnotationInput): Promise<Annotation> {
  const a = await createAnnotation(bookId, data);
  if (!a.pending) setQueryData(["annotations", bookId], (list: Annotation[] | undefined) => (list ? [...list, a] : list));
  refresh(bookId);
  return a;
}

export async function updateAnnotation(a: Annotation, patch: Partial<Pick<Annotation, "note" | "color">>): Promise<Annotation> {
  if (a.pending) return { ...a, ...patch };
  const next = await api.annotations.update(a.id, patch);
  setQueryData(["annotations", a.book_id], (list: Annotation[] | undefined) => list?.map((x) => (x.id === a.id ? next : x)));
  refresh(a.book_id);
  return next;
}

export async function removeAnnotation(a: Annotation) {
  if (a.pending) dropPendingAnnotation(a.id);
  else {
    await api.annotations.remove(a.id);
    setQueryData(["annotations", a.book_id], (list: Annotation[] | undefined) => list?.filter((x) => x.id !== a.id));
  }
  refresh(a.book_id);
}

/** «Глава 3 · 42%» */
export function whereLabel(a: Pick<Annotation, "chapter" | "progress">) {
  const pct = `${Math.round((a.progress || 0) * 100)}%`;
  return a.chapter ? `${a.chapter} · ${pct}` : pct;
}
