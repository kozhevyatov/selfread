import { useSyncExternalStore } from "react";
import type { BookDetail } from "./api";

export type DialogState =
  | { kind: "none" }
  | { kind: "shelf"; bookIds: number[] }
  | { kind: "upload"; libraryId?: number }
  | { kind: "editBook"; book: BookDetail }
  | { kind: "confirm"; title: string; text: string; action: string; danger?: boolean; resolve: (ok: boolean) => void };

let state: DialogState = { kind: "none" };
const listeners = new Set<() => void>();

function set(next: DialogState) {
  state = next;
  listeners.forEach((l) => l());
}

export const dialogs = {
  /** «Добавить на полку» для одной или нескольких книг */
  addToShelf: (bookIds: number[]) => set({ kind: "shelf", bookIds }),
  /** Загрузка книг: можно сразу указать медиатеку */
  upload: (libraryId?: number) => set({ kind: "upload", libraryId }),
  /** Правка карточки книги */
  editBook: (book: BookDetail) => set({ kind: "editBook", book }),
  confirm: (opts: { title: string; text: string; action: string; danger?: boolean }) =>
    new Promise<boolean>((resolve) => set({ kind: "confirm", ...opts, resolve })),
  close: () => {
    if (state.kind === "confirm") state.resolve(false);
    set({ kind: "none" });
  },
  closeQuiet: () => set({ kind: "none" }),
};

export function useDialogState() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
  );
}
