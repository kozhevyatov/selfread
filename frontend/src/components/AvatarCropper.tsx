import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Minus, Plus } from "./icons";

const OUT = 512; // сторона итоговой картинки
const MAX_ZOOM = 5;

type Img = { src: string; bitmap: ImageBitmap | HTMLImageElement; w: number; h: number };

async function loadImage(file: File): Promise<Img> {
  const src = URL.createObjectURL(file);
  try {
    // учитывает поворот из EXIF (фото с телефона)
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { src, bitmap, w: bitmap.width, h: bitmap.height };
  } catch {
    const img = new Image();
    img.src = src;
    await img.decode();
    return { src, bitmap: img, w: img.naturalWidth, h: img.naturalHeight };
  }
}

/** Окно обрезки аватарки в квадрат: перетаскивание, масштаб колесом, щипком и ползунком. */
export function AvatarCropper({
  file,
  onCancel,
  onDone,
}: {
  file: File | null;
  onCancel: () => void;
  onDone: (blob: Blob) => Promise<void> | void;
}) {
  const [img, setImg] = useState<Img | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(300);
  const box = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setImg(null);
    setError(null);
    loadImage(file)
      .then((i) => {
        if (cancelled) return;
        setImg(i);
        setZoom(1);
      })
      .catch(() => setError("Не удалось открыть картинку"));
    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => () => (img ? URL.revokeObjectURL(img.src) : undefined), [img]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [img]);

  const base = img ? Math.max(view / img.w, view / img.h) : 1;
  const scale = base * zoom;

  const clamp = useCallback(
    (x: number, y: number, s = scale) => {
      if (!img) return { x, y };
      return {
        x: Math.min(0, Math.max(view - img.w * s, x)),
        y: Math.min(0, Math.max(view - img.h * s, y)),
      };
    },
    [img, view, scale],
  );

  // при новой картинке — по центру
  useEffect(() => {
    if (!img) return;
    const s = Math.max(view / img.w, view / img.h);
    setPos({ x: (view - img.w * s) / 2, y: (view - img.h * s) / 2 });
  }, [img, view]);

  /** Масштаб с сохранением точки под курсором (или центра) */
  const zoomTo = (next: number, ax = view / 2, ay = view / 2) => {
    if (!img) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const s2 = base * z;
    const px = (ax - pos.x) / scale;
    const py = (ay - pos.y) / scale;
    setZoom(z);
    setPos(clamp(ax - px * s2, ay - py * s2, s2));
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const rect = e.currentTarget.getBoundingClientRect();
      zoomTo(
        (pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.dist,
        (a.x + b.x) / 2 - rect.left,
        (a.y + b.y) / 2 - rect.top,
      );
      return;
    }
    setPos((p) => clamp(p.x + e.clientX - prev.x, p.y + e.clientY - prev.y));
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - rect.left, e.clientY - rect.top);
  };

  const save = async () => {
    if (!img) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = OUT;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      const side = view / scale;
      ctx.drawImage(img.bitmap, -pos.x / scale, -pos.y / scale, side, side, 0, 0, OUT, OUT);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
      if (!blob) throw new Error("Не удалось подготовить картинку");
      await onDone(blob);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={file !== null}
      onClose={onCancel}
      title="Аватарка"
      description="Перетащите фото и приблизьте нужную часть. Сохранится квадрат — в приложении он показывается кругом."
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
          <Button onClick={save} disabled={!img || busy} >
            {busy ? "Сохраняю…" : "Сохранить"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div
          ref={box}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          className="relative aspect-square w-full max-w-[320px] cursor-grab touch-none overflow-hidden rounded-2xl bg-surface-2 select-none active:cursor-grabbing"
        >
          {img && (
            <img
              src={img.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
              style={{ width: img.w, height: img.h, transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }}
            />
          )}
          {/* затемнение вокруг круга: так аватарка будет выглядеть в приложении */}
          <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] ring-2 ring-white/70" />
          {!img && !error && <div className="absolute inset-0 flex items-center justify-center text-sm text-faint">Загрузка…</div>}
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex w-full max-w-[320px] items-center gap-3">
          <button
            type="button"
            aria-label="Отдалить"
            onClick={() => zoomTo(zoom / 1.25)}
            className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
          >
            <Minus className="size-4" />
          </button>
          <input
            type="range"
            aria-label="Масштаб"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => zoomTo(Number(e.target.value))}
            className="flex-1 accent-[var(--accent)]"
          />
          <button
            type="button"
            aria-label="Приблизить"
            onClick={() => zoomTo(zoom * 1.25)}
            className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>
    </Dialog>
  );
}
