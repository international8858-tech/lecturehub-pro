import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowLeft, Check, Crop, RotateCw, Save } from "lucide-react";
import { db, type ImageItem, type Difficulty } from "@/lib/db";
import { Btn, difficulties, inputCls } from "./ui";

type Rect = { x: number; y: number; w: number; h: number }; // normalized 0..1

export function ImageEditor({ image, onClose }: { image: ImageItem; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<HTMLImageElement | null>(null);
  const [rotation, setRotation] = useState(0);
  
  const [cropMode, setCropMode] = useState(false);
  const [crop, setCrop] = useState<Rect>({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  const [difficulty, setDifficulty] = useState<Difficulty>(image.difficulty);
  const [done, setDone] = useState(!!image.isCompleted);
  const [tags, setTags] = useState(image.tags.join(", "));
  const [name, setName] = useState(image.name);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ corner: string; start: Rect; px: number; py: number } | null>(null);

  // load blob → HTMLImageElement, revoke URL after decode
  useEffect(() => {
    const url = URL.createObjectURL(image.blob);
    const img = new Image();
    img.onload = () => {
      setSrc(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [image.blob]);

  // draw preview with rotation + threshold
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !src) return;
    const rot = rotation % 180 !== 0;
    const maxW = 1400;
    const s = Math.min(1, maxW / Math.max(src.width, src.height));
    const w = Math.round(src.width * s);
    const h = Math.round(src.height * s);
    c.width = rot ? h : w;
    c.height = rot ? w : h;
    const ctx = c.getContext("2d")!;
    ctx.save();
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
    ctx.restore();
  }, [src, rotation]);

  const onHandleDown = (corner: string) => (e: PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { corner, start: crop, px: e.clientX, py: e.clientY };
  };
  const onHandleMove = (e: PointerEvent) => {
    if (!drag.current || !boxRef.current) return;
    const b = boxRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.current.px) / b.width;
    const dy = (e.clientY - drag.current.py) / b.height;
    const s = drag.current.start;
    const c = drag.current.corner;
    let { x, y, w, h } = s;
    if (c.includes("l")) {
      x = s.x + dx;
      w = s.w - dx;
    }
    if (c.includes("r")) w = s.w + dx;
    if (c.includes("t")) {
      y = s.y + dy;
      h = s.h - dy;
    }
    if (c.includes("b")) h = s.h + dy;
    if (c === "move") {
      x = s.x + dx;
      y = s.y + dy;
    }
    x = Math.max(0, Math.min(x, 1 - 0.05));
    y = Math.max(0, Math.min(y, 1 - 0.05));
    w = Math.max(0.05, Math.min(w, 1 - x));
    h = Math.max(0.05, Math.min(h, 1 - y));
    setCrop({ x, y, w, h });
  };
  const onHandleUp = () => (drag.current = null);

  const save = async () => {
    const c = canvasRef.current;
    if (!c) return;
    setSaving(true);
    let out = c;
    if (cropMode) {
      const oc = document.createElement("canvas");
      oc.width = Math.round(crop.w * c.width);
      oc.height = Math.round(crop.h * c.height);
      oc.getContext("2d")!.drawImage(c, crop.x * c.width, crop.y * c.height, oc.width, oc.height, 0, 0, oc.width, oc.height);
      out = oc;
    }
    const blob = await new Promise<Blob>((res) => out.toBlob((b) => res(b!), "image/jpeg", 0.88));
    await db.images.update(image.id!, {
      blob,
      name,
      difficulty,
      isCompleted: done ? 1 : 0,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    setSaving(false);
    onClose();
  };

  const handles = ["tl", "tr", "bl", "br"];
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <header className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <button onClick={onClose} className="rounded-full p-2 hover:bg-secondary" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="flex-1 truncate text-sm font-bold">Photo Editor</h2>
        <Btn onClick={save} disabled={saving || !src} className="!py-1.5">
          <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
        </Btn>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="bg-player p-3">
          <div ref={boxRef} className="relative mx-auto w-fit max-w-full">
            <canvas ref={canvasRef} className="max-h-[52vh] max-w-full rounded-lg" />
            {cropMode && (
              <div
                className="absolute border-2 border-primary shadow-[0_0_0_9999px_var(--overlay)]"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.w * 100}%`,
                  height: `${crop.h * 100}%`,
                  touchAction: "none",
                }}
                onPointerDown={onHandleDown("move")}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
              >
                {handles.map((hd) => (
                  <div
                    key={hd}
                    onPointerDown={onHandleDown(hd)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    className="absolute h-6 w-6 rounded-full border-2 border-card bg-primary"
                    style={{
                      left: hd.includes("l") ? -12 : undefined,
                      right: hd.includes("r") ? -12 : undefined,
                      top: hd.includes("t") ? -12 : undefined,
                      bottom: hd.includes("b") ? -12 : undefined,
                      touchAction: "none",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 p-4">
          <div className="flex gap-2">
            <Btn variant={cropMode ? "primary" : "secondary"} onClick={() => setCropMode((v) => !v)} className="flex-1">
              <Crop className="h-4 w-4" /> Crop
            </Btn>
            <Btn variant="secondary" onClick={() => setRotation((r) => (r + 90) % 360)} className="flex-1">
              <RotateCw className="h-4 w-4" /> Rotate
            </Btn>
          </div>


          <div className="rounded-2xl bg-card p-4 shadow-card">
            <p className="mb-2 text-sm font-bold">Question Level</p>
            <div className="flex flex-wrap gap-2">
              {difficulties.map((d) => (
                <button
                  key={d.key}
                  onClick={() => setDifficulty(d.key)}
                  className={`press rounded-full px-3 py-1.5 text-xs font-bold ${d.cls} ${difficulty === d.key ? "ring-2 ring-ring" : "opacity-70"}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <label className="mt-4 flex items-center gap-3 text-sm font-semibold">
              <button
                onClick={() => setDone((v) => !v)}
                className={`flex h-6 w-6 items-center justify-center rounded-md border-2 ${done ? "border-success bg-success text-success-foreground" : "border-border"}`}
                aria-label="Toggle completed"
              >
                {done && <Check className="h-4 w-4" />}
              </button>
              Question completed
            </label>
          </div>

          <div className="rounded-2xl bg-card p-4 shadow-card space-y-3">
            <div>
              <p className="mb-1 text-xs font-bold text-muted-foreground">Name</p>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <p className="mb-1 text-xs font-bold text-muted-foreground">Tags (comma separated)</p>
              <input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="projectile, numericals" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
