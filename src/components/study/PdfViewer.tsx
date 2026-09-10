import { memo, useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowLeft, Highlighter, Maximize2, Minimize2, Check, ImagePlus, Eraser, Timer } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, loadPdfJs, buildPdf, type Highlight } from "@/lib/db";
import { Btn, StudyTimer } from "./ui";

interface Props {
  pdfId: number;
  onClose?: () => void;
  embedded?: boolean; // used inside video split-view / drawer
}

export const HL_COLORS = ["#fde047", "#86efac", "#93c5fd", "#f9a8d4", "#fdba74"];

export const PdfViewer = memo(function PdfViewer({ pdfId, onClose, embedded }: Props) {
  const pdf = useLiveQuery(() => db.pdfs.get(pdfId), [pdfId]);
  const blobRow = useLiveQuery(() => (pdf ? db.blobs.get(pdf.blobId) : undefined), [pdf?.blobId]);
  const [pages, setPages] = useState<{ n: number; url: string; w: number; h: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [full, setFull] = useState(false);
  const [hl, setHl] = useState(false);
  const [color, setColor] = useState(HL_COLORS[0]!);
  const [showTimer, setShowTimer] = useState(false);
  const [draft, setDraft] = useState<Highlight | null>(null);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const start = useRef<{ page: number; x: number; y: number } | null>(null);

  // render pages → JPEG object URLs (canvas-based via pdf.js, never iframe)
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      if (!blobRow) return;
      setLoading(true);
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: await blobRow.blob.arrayBuffer() }).promise;
      const width = Math.min(containerRef.current?.clientWidth ?? 390, 900);
      const out: typeof pages = [];
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = (width / base.width) * Math.min(2, window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale });
        const c = document.createElement("canvas");
        c.width = vp.width;
        c.height = vp.height;
        await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c }).promise;
        const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.85));
        const url = URL.createObjectURL(blob);
        urls.push(url);
        out.push({ n, url, w: base.width, h: base.height });
        if (!cancelled) setPages([...out]);
      }
      if (!cancelled) {
        setLoading(false);
        if (pdf && pdf.pageCount !== doc.numPages) db.pdfs.update(pdfId, { pageCount: doc.numPages });
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blobRow]);

  const norm = (e: PointerEvent, el: HTMLElement) => {
    const b = el.getBoundingClientRect();
    return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
  };
  const down = (page: number) => (e: PointerEvent<HTMLDivElement>) => {
    if (!hl) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = norm(e, e.currentTarget);
    start.current = { page, ...p };
    setDraft({ page, x: p.x, y: p.y, w: 0, h: 0, color });
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!hl || !start.current) return;
    const p = norm(e, e.currentTarget);
    const s = start.current;
    setDraft({ page: s.page, x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y), color });
  };
  const up = async () => {
    if (!hl || !draft || !pdf) return;
    start.current = null;
    if (draft.w > 0.01 && draft.h > 0.005) {
      await db.pdfs.update(pdfId, { annotations: [...pdf.annotations, draft] });
    }
    setDraft(null);
  };
  const removeHighlight = async (idx: number) => {
    if (!pdf) return;
    await db.pdfs.update(pdfId, { annotations: pdf.annotations.filter((_, i) => i !== idx) });
  };
  const togglePage = async (n: number) => {
    if (!pdf) return;
    const set = new Set(pdf.completedPages);
    set.has(n) ? set.delete(n) : set.add(n);
    const completedPages = [...set].sort((a, b) => a - b);
    await db.pdfs.update(pdfId, {
      completedPages,
      completedPercentage: pdf.pageCount ? Math.round((completedPages.length / pdf.pageCount) * 100) : 0,
    });
  };
  const appendImages = async (files: FileList | null) => {
    if (!files?.length || !pdf || !blobRow) return;
    setBusy(true);
    const { blob, pages: count } = await buildPdf(Array.from(files), blobRow.blob);
    await db.blobs.update(pdf.blobId, { blob });
    await db.pdfs.update(pdfId, {
      pageCount: count,
      completedPercentage: Math.round((pdf.completedPages.length / count) * 100),
    });
    setBusy(false);
  };

  if (!pdf) return null;
  const pct = pdf.completedPercentage;

  return (
    <div className={`${embedded && !full ? "relative h-full" : "fixed inset-0 z-40"} flex flex-col bg-background`}>
      {(!embedded || full) && (
        <header className="flex items-center gap-1 border-b bg-card px-2 py-2">
          {onClose && !full && (
            <button onClick={onClose} className="rounded-full p-2 hover:bg-secondary" aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0 flex-1 px-1">
            <h2 className="truncate text-sm font-bold">{pdf.name}</h2>
            <p className="text-[11px] text-muted-foreground">
              {pdf.pageCount} pages · <span className="font-bold text-success">{pct}% Mastered</span>
            </p>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => appendImages(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} className="rounded-full p-2 hover:bg-secondary" aria-label="Append pages" disabled={busy}>
            <ImagePlus className="h-5 w-5" />
          </button>
          <button
            onClick={() => setHl((v) => !v)}
            className={`rounded-full p-2 ${hl ? "bg-highlight text-foreground" : "hover:bg-secondary"}`}
            aria-label="Highlighter"
          >
            <Highlighter className="h-5 w-5" />
          </button>
          <button onClick={() => setFull((v) => !v)} className="rounded-full p-2 hover:bg-secondary" aria-label="Fullscreen">
            {full ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </button>
        </header>
      )}
      {embedded && !full && (
        <div className="flex items-center justify-between border-b bg-card px-3 py-1.5 text-xs">
          <span className="truncate font-bold">{pdf.name}</span>
          <div className="flex gap-1">
            <button onClick={() => setHl((v) => !v)} className={`rounded-full p-1.5 ${hl ? "bg-highlight" : ""}`} aria-label="Highlighter">
              <Highlighter className="h-4 w-4" />
            </button>
            <button onClick={() => setFull(true)} className="rounded-full p-1.5" aria-label="Fullscreen">
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div ref={containerRef} className={`flex-1 overflow-y-auto ${full ? "bg-player" : "bg-secondary"} p-2`} style={{ touchAction: hl ? "none" : "auto" }}>
        {(loading || busy) && (
          <p className="py-3 text-center text-xs font-semibold text-muted-foreground">{busy ? "Adding pages…" : "Rendering pages…"}</p>
        )}
        {pages.map((p) => {
          const done = pdf.completedPages.includes(p.n);
          return (
            <div key={p.n} className="mx-auto mb-3 max-w-[900px]">
              <div
                className="relative overflow-hidden rounded-lg bg-card shadow-card"
                style={{ aspectRatio: `${p.w} / ${p.h}` }}
                onPointerDown={down(p.n)}
                onPointerMove={move}
                onPointerUp={up}
              >
                <img src={p.url} alt={`Page ${p.n}`} className="block h-full w-full" draggable={false} />
                {pdf.annotations.map((a, i) =>
                  a.page === p.n ? (
                    <div
                      key={i}
                      onClick={() => hl && removeHighlight(i)}
                      className="absolute bg-highlight/50 mix-blend-multiply"
                      style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` }}
                    />
                  ) : null,
                )}
                {draft && draft.page === p.n && (
                  <div
                    className="absolute bg-highlight/50"
                    style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }}
                  />
                )}
              </div>
              <div className="mt-1 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
                <span>Page {p.n}</span>
                <button
                  onClick={() => togglePage(p.n)}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${done ? "bg-success/15 text-success" : "bg-card"}`}
                >
                  <Check className="h-3 w-3" /> {done ? "Done" : "Mark done"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {hl && (
        <div className="flex items-center justify-between border-t bg-card px-4 py-2 text-xs">
          <span className="font-semibold">Drag over text to highlight · tap a highlight to erase</span>
          <Btn variant="secondary" className="!py-1 !px-3" onClick={() => setHl(false)}>
            <Eraser className="h-3.5 w-3.5" /> Done
          </Btn>
        </div>
      )}
    </div>
  );
}
