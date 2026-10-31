/**
 * Откуда читалка берёт книгу.
 * - EPUB, FB2, FBZ, MOBI, AZW, AZW3, PDF, CBZ — открывает движок foliate-js;
 * - TXT и HTML — превращаем в «книгу» сами (разбиваем на главы и страницы);
 * - DjVu — сервер отдаёт страницы картинками, читалка показывает их как комикс;
 * - DOCX, ODT, RTF, CHM — сервер один раз конвертирует в EPUB, CBR и CB7 — в CBZ.
 */
import { fileUrl, viewUrl, type BookDetail } from "./api";

/** Форматы, которые умеет открыть читалка, — в порядке предпочтения. */
export const READABLE = ["epub", "fb2", "fbz", "azw3", "mobi", "azw", "pdf", "cbz", "djvu", "txt", "html", "htm"];
/** Конвертирует сервер: исходный формат → формат для читалки */
export const CONVERT: Record<string, "epub" | "cbz"> = { docx: "epub", odt: "epub", rtf: "epub", chm: "epub", cbr: "cbz", cb7: "cbz" };

export function pickFormat(book: Pick<BookDetail, "formats" | "kind">): string | null {
  if (book.kind !== "ebook") return null;
  return READABLE.find((f) => book.formats.includes(f)) ?? Object.keys(CONVERT).find((f) => book.formats.includes(f)) ?? null;
}

/** Ширина картинок страниц DjVu для этого экрана (одинаковая — чтобы скачанное офлайн совпадало) */
export function djvuPageWidth() {
  return Math.min(2400, Math.round(Math.max(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight) * Math.min(2, window.devicePixelRatio || 1)));
}

export function canRead(book: Pick<BookDetail, "formats" | "kind">) {
  return pickFormat(book) !== null;
}

/** Книга в формате, который понимает foliate-js (минимальный набор полей). */
export type FoliateBook = {
  sections: { id: string | number; load: () => string | Promise<string>; unload?: () => void; size: number; linear?: string }[];
  toc?: { label: string; href: string; subitems?: unknown[] }[];
  metadata?: { title?: string; author?: string; language?: string };
  rendition?: { layout?: string };
  dir?: string;
  resolveHref: (href: string) => { index: number; anchor?: (doc: Document) => Element | null } | null;
  splitTOCHref?: (href: string) => [string | number, string | null];
  getTOCFragment?: (doc: Document, id: string | null) => Node | null;
  getCover?: () => Promise<Blob | null>;
  destroy?: () => void;
};

async function download(url: string, onProgress?: (loaded: number, total: number) => void): Promise<Blob> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).detail;
    } catch {
      /* не JSON */
    }
    throw new Error(detail || (res.status === 404 ? "Файл книги не найден на сервере" : `Не удалось загрузить книгу (${res.status})`));
  }
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !onProgress) return res.blob();
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  return new Blob(chunks);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Текст в UTF-8, иначе — Windows-1251 (старые русские TXT). */
function decodeText(buf: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1251").decode(buf);
  }
}

// \b в JS не работает с кириллицей — граница слова задана явно
const CHAPTER = /^\s*((глава|часть|книга|пролог|эпилог|chapter|part|prologue|epilogue)(?=[\s.:,]|$).{0,80}|[IVXLC]{1,7}\.?|\d{1,3}\.?)\s*$/iu;

function htmlPage(body: string, lang = "ru") {
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title></title></head><body>${body}</body></html>`;
}

/** TXT → книга: абзацы, главы по строкам «Глава 1», «Часть II», «IV», разбиение на секции ~60 КБ. */
function makeTextBook(text: string, title: string, author: string): FoliateBook {
  text = text.replace(/\r\n?/g, "\n");
  // абзацы: пустая строка, а если пустых нет — каждая строка
  const blocks = /\n\s*\n/.test(text) ? text.split(/\n\s*\n+/) : text.split("\n");
  type Sec = { html: string[]; size: number; chapters: { id: string; label: string }[] };
  const sections: Sec[] = [{ html: [], size: 0, chapters: [] }];
  let n = 0;
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    let cur = sections[sections.length - 1];
    const isChapter = block.length < 90 && !block.includes("\n") && CHAPTER.test(block);
    if ((isChapter && cur.size > 4000) || cur.size > 60000) {
      cur = { html: [], size: 0, chapters: [] };
      sections.push(cur);
    }
    if (isChapter) {
      const id = `c${++n}`;
      cur.chapters.push({ id, label: block });
      cur.html.push(`<h2 id="${id}">${escapeHtml(block)}</h2>`);
    } else {
      cur.html.push(`<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`);
    }
    cur.size += block.length;
  }
  const urls = new Map<number, string>();
  const book: FoliateBook = {
    metadata: { title, author, language: "ru" },
    dir: "ltr",
    sections: sections.map((s, i) => ({
      id: i,
      size: s.size,
      linear: "yes",
      load: () => {
        if (!urls.has(i)) {
          const head = i === 0 ? `<h1>${escapeHtml(title)}</h1>${author ? `<p style="text-align:center"><i>${escapeHtml(author)}</i></p>` : ""}` : "";
          urls.set(i, URL.createObjectURL(new Blob([htmlPage(head + s.html.join("\n"))], { type: "text/html" })));
        }
        return urls.get(i)!;
      },
      unload: () => {
        const u = urls.get(i);
        if (u) URL.revokeObjectURL(u);
        urls.delete(i);
      },
    })),
    toc: sections.flatMap((s, i) => s.chapters.map((c) => ({ label: c.label, href: `${i}#${c.id}` }))),
    resolveHref: (href) => {
      const [sec, frag] = href.split("#");
      const index = Number(sec);
      if (!Number.isFinite(index)) return null;
      return { index, anchor: (doc) => (frag ? doc.getElementById(frag) : null) };
    },
    splitTOCHref: (href) => {
      const [sec, frag] = href.split("#");
      return [Number(sec), frag ?? null];
    },
    getTOCFragment: (doc, id) => (id ? doc.getElementById(id) : doc.documentElement),
    destroy: () => urls.forEach((u) => URL.revokeObjectURL(u)),
  };
  return book;
}

/** HTML-книга: одной секцией (скрипты внутри не выполнятся — их режет политика безопасности). */
function makeHtmlBook(html: string, title: string): FoliateBook {
  let url: string | null = null;
  return {
    metadata: { title },
    sections: [
      {
        id: 0,
        size: html.length,
        load: () => (url ??= URL.createObjectURL(new Blob([html], { type: "text/html" }))),
      },
    ],
    toc: [],
    resolveHref: () => ({ index: 0 }),
    destroy: () => url && URL.revokeObjectURL(url),
  };
}

/** DjVu: страницы рендерит сервер, читалка показывает их по одной, как комикс. */
function makeDjvuBook(book: BookDetail): FoliateBook {
  const count = Math.max(1, book.pages ?? 1);
  const width = djvuPageWidth();
  // по две ссылки на страницу: картинка и HTML-обёртка (blob: — относительные пути внутри не работают)
  const urls = new Map<number, string[]>();
  const free = (i: number) => {
    urls.get(i)?.forEach((u) => URL.revokeObjectURL(u));
    urls.delete(i);
  };
  const loadPage = async (i: number) => {
    const cached = urls.get(i);
    if (cached) return cached[1];
    const res = await fetch(`${window.location.origin}/api/books/${book.id}/page/${i + 1}?w=${width}`, { credentials: "same-origin" });
    if (!res.ok) {
      let msg = `Страница ${i + 1}: ошибка ${res.status}`;
      try {
        msg = (await res.json()).detail || msg;
      } catch {
        /* не JSON */
      }
      const html = htmlPage(`<p style="font:16px sans-serif;padding:40px;text-align:center">${escapeHtml(msg)}</p>`);
      const u = URL.createObjectURL(new Blob([html.replace("<head>", '<head><meta name="viewport" content="width=600, height=800">')], { type: "text/html" }));
      urls.set(i, [u, u]);
      return u;
    }
    const img = await res.blob();
    // размер страницы — для раскладки фиксированного макета
    let w = 1000;
    let h = 1400;
    try {
      const bmp = await createImageBitmap(img);
      w = bmp.width;
      h = bmp.height;
      bmp.close();
    } catch {
      /* оставим примерный размер */
    }
    const imgUrl = URL.createObjectURL(img);
    const html = htmlPage(`<img src="${imgUrl}" alt="" style="display:block;width:100%;height:100%">`)
      .replace("<head>", `<head><meta name="viewport" content="width=${w}, height=${h}">`)
      .replace("<body>", '<body style="margin:0">');
    const pageUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    urls.set(i, [imgUrl, pageUrl]);
    return pageUrl;
  };
  return {
    metadata: { title: book.title },
    rendition: { layout: "pre-paginated" },
    sections: Array.from({ length: count }, (_, i) => ({
      id: i,
      size: 1500,
      load: () => loadPage(i),
      unload: () => free(i),
    })),
    toc: [],
    resolveHref: (href) => ({ index: Number(href) || 0 }),
    splitTOCHref: (href) => [Number(href), null],
    getTOCFragment: (doc) => doc.documentElement,
    destroy: () => [...urls.keys()].forEach(free),
  };
}

/** Загрузить книгу для читалки: File для foliate-js или готовый объект книги. */
export async function loadBookSource(book: BookDetail, fmt: string, onProgress?: (loaded: number, total: number) => void): Promise<File | FoliateBook> {
  const author = book.authors.join(", ");
  if (fmt === "djvu") return makeDjvuBook(book);
  const target = CONVERT[fmt];
  if (target) {
    const blob = await download(viewUrl(book.id, fmt), onProgress);
    return new File([blob], `book.${target}`, { type: blob.type });
  }
  const blob = await download(fileUrl(book.id, fmt), onProgress);
  if (fmt === "txt") return makeTextBook(decodeText(await blob.arrayBuffer()), book.title, author);
  if (fmt === "html" || fmt === "htm") return makeHtmlBook(decodeText(await blob.arrayBuffer()), book.title);
  const name = fmt === "fbz" ? "book.fb2.zip" : `book.${fmt}`;
  return new File([blob], name, { type: blob.type });
}
