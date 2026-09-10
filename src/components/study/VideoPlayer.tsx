import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Maximize,
  Minimize,
  MoreVertical,
  FileText,
  Check,
  X,
  Paperclip,
  Timer,
  Upload,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, addPdf, loadPdfJs } from "@/lib/db";
import { PdfViewer } from "./PdfViewer";
import { Sheet, SheetItem, StudyTimer, fmt } from "./ui";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function VideoPlayer({ videoId, onClose }: { videoId: number; onClose: () => void }) {
  const video = useLiveQuery(() => db.videos.get(videoId), [videoId]);
  const blobRow = useLiveQuery(() => (video ? db.blobs.get(video.blobId) : undefined), [video?.blobId]);
  const pdfs = useLiveQuery(() => db.pdfs.toArray(), []);
  const vRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [full, setFull] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [attachSheet, setAttachSheet] = useState(false);
  const [showTimer, setShowTimer] = useState(false);
  const [importing, setImporting] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [controls, setControls] = useState(true);
  const [flash, setFlash] = useState<"l" | "r" | null>(null);
  const tapTimer = useRef<number | null>(null);
  const lastSave = useRef(0);
  const resumed = useRef(false);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!blobRow) return;
    const u = URL.createObjectURL(blobRow.blob);
    setUrl(u);
    db.history.add({ videoId, watchedAt: Date.now() });
    return () => URL.revokeObjectURL(u);
  }, [blobRow, videoId]);

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const bumpControls = () => {
    setControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControls(false), 3000);
  };

  const onLoaded = () => {
    const v = vRef.current;
    if (!v || !video) return;
    setDur(v.duration);
    if (!resumed.current && video.lastPosition > 0 && video.lastPosition < v.duration - 2) {
      v.currentTime = video.lastPosition; // auto-resume, never reset to 0
    }
    resumed.current = true;
    v.playbackRate = speed;
  };

  const onTime = () => {
    const v = vRef.current;
    if (!v) return;
    setTime(v.currentTime);
    const now = Date.now();
    if (now - lastSave.current >= 1000) {
      lastSave.current = now;
      const patch: Partial<typeof video> = { lastPosition: v.currentTime, duration: v.duration };
      if (v.duration && v.currentTime / v.duration >= 0.95 && video && !video.isCompleted) patch.isCompleted = 1;
      db.videos.update(videoId, patch);
    }
  };

  const toggle = () => {
    const v = vRef.current;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  };
  const seek = (d: number) => {
    const v = vRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + d));
    setFlash(d < 0 ? "l" : "r");
    window.setTimeout(() => setFlash(null), 500);
  };

  // single tap → toggle controls/play, double tap → ±10s (debounced so they don't conflict)
  const onTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const right = e.clientX - rect.left > rect.width / 2;
    if (tapTimer.current) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
      seek(right ? 10 : -10);
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      if (controls) toggle();
      bumpControls();
    }, 260);
  };

  const toggleFull = async () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      await el.requestFullscreen().catch(() => {});
      try {
        await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.("landscape");
      } catch {}
    }
  };

  const changeSpeed = (s: number) => {
    setSpeed(s);
    if (vRef.current) vRef.current.playbackRate = s;
  };

  if (!video) return null;
  const pct = dur ? (time / dur) * 100 : 0;
  const attached = video.attachedPdfId;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      {!full && (
        <header className="flex items-center gap-2 bg-card px-2 py-2 border-b">
          <button onClick={onClose} className="rounded-full p-2 hover:bg-secondary" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold">{video.name}</h2>
            {video.isCompleted ? (
              <p className="flex items-center gap-1 text-[11px] font-bold text-success">
                <Check className="h-3 w-3" /> Completed
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">Resumes automatically</p>
            )}
          </div>
          <button
            onClick={() => setShowTimer((v) => !v)}
            className={`rounded-full p-2 ${showTimer ? "bg-accent text-accent-foreground" : "hover:bg-secondary"}`}
            aria-label="Study timer"
          >
            <Timer className="h-5 w-5" />
          </button>
          <button onClick={() => setAttachSheet(true)} className="rounded-full p-2 hover:bg-secondary" aria-label="Attach PDF">
            <Paperclip className="h-5 w-5" />
          </button>
        </header>
      )}

      {/* player */}
      <div ref={wrapRef} className={`relative bg-player text-player-foreground ${full ? "h-full" : attached ? "h-1/2" : "aspect-video"} shrink-0`}>
        <div className="absolute inset-0" onClick={onTap}>
          {url && (
            <video
              ref={vRef}
              src={url}
              playsInline
              className="h-full w-full object-contain"
              onLoadedMetadata={onLoaded}
              onTimeUpdate={onTime}
              onPlay={() => {
                setPlaying(true);
                bumpControls();
              }}
              onPause={() => setPlaying(false)}
            />
          )}
          {flash && (
            <div className={`pointer-events-none absolute inset-y-0 ${flash === "l" ? "left-0" : "right-0"} flex w-1/2 items-center justify-center bg-player-foreground/10`}>
              <div className="flex flex-col items-center text-sm font-bold">
                {flash === "l" ? <RotateCcw className="h-8 w-8" /> : <RotateCw className="h-8 w-8" />}10s
              </div>
            </div>
          )}
        </div>

        {/* controls overlay */}
        <div className={`pointer-events-none absolute inset-0 flex flex-col justify-between transition-opacity ${controls ? "opacity-100" : "opacity-0"}`}>
          <div className="flex justify-end p-2">
            {full && attached && (
              <button onClick={() => setDrawer((v) => !v)} className="pointer-events-auto rounded-full bg-player/60 p-2" aria-label="Notes">
                <MoreVertical className="h-5 w-5" />
              </button>
            )}
          </div>
          <div className="pointer-events-auto flex items-center justify-center gap-8">
            <button onClick={() => seek(-10)} aria-label="Back 10s" className="rounded-full bg-player/50 p-2">
              <RotateCcw className="h-6 w-6" />
            </button>
            <button onClick={toggle} aria-label="Play/Pause" className="rounded-full bg-player-foreground/20 p-4 backdrop-blur">
              {playing ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7" />}
            </button>
            <button onClick={() => seek(10)} aria-label="Forward 10s" className="rounded-full bg-player/50 p-2">
              <RotateCw className="h-6 w-6" />
            </button>
          </div>
          <div className="pointer-events-auto space-y-1 bg-gradient-to-t from-player/80 to-transparent px-3 pb-2 pt-6">
            <input
              type="range"
              min={0}
              max={dur || 0}
              step={0.1}
              value={time}
              onChange={(e) => {
                if (vRef.current) vRef.current.currentTime = +e.target.value;
              }}
              className="h-1 w-full"
              aria-label="Seek"
            />
            <div className="flex items-center justify-between text-[11px] font-semibold">
              <span>
                {fmt(time)} / {fmt(dur)}
              </span>
              <div className="flex items-center gap-1">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => changeSpeed(s)}
                    className={`rounded-md px-1.5 py-0.5 ${speed === s ? "bg-primary text-primary-foreground" : "bg-player-foreground/15"}`}
                  >
                    {s}x
                  </button>
                ))}
                <button onClick={toggleFull} className="ml-1 rounded-md bg-player-foreground/15 p-1" aria-label="Fullscreen">
                  {full ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-player-foreground/20">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* landscape side drawer with attached notes — video keeps playing */}
        {full && attached && (
          <div
            className={`absolute inset-y-0 right-0 z-10 w-[45%] max-w-md bg-card/90 text-foreground backdrop-blur transition-transform ${
              drawer ? "translate-x-0" : "translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs font-bold">
              <span className="flex items-center gap-1">
                <FileText className="h-4 w-4" /> Attached notes
              </span>
              <button onClick={() => setDrawer(false)} aria-label="Close notes">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="h-[calc(100%-2rem)]">{drawer && <PdfViewer pdfId={attached} embedded />}</div>
          </div>
        )}
      </div>

      {/* portrait split view: PDF bottom 50% */}
      {!full && attached && (
        <div className="min-h-0 flex-1">
          <PdfViewer pdfId={attached} embedded />
        </div>
      )}
      {!full && !attached && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="rounded-2xl bg-accent p-4 text-accent-foreground">
            <FileText className="h-8 w-8" />
          </div>
          <p className="text-sm font-bold">No notes attached</p>
          <p className="text-xs text-muted-foreground">Attach a PDF to read it below the video, or in a side drawer while in full screen.</p>
          <button onClick={() => setAttachSheet(true)} className="press rounded-2xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
            Attach Notes
          </button>
        </div>
      )}

      <Sheet open={attachSheet} onClose={() => setAttachSheet(false)} title="Attach PDF notes">
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {attached && (
            <SheetItem icon={<X className="h-4 w-4" />} label="Remove attached PDF" danger onClick={async () => {
              await db.videos.update(videoId, { attachedPdfId: null });
              setAttachSheet(false);
            }} />
          )}
          {pdfs?.length ? (
            pdfs.map((p) => (
              <SheetItem
                key={p.id}
                icon={<FileText className="h-4 w-4" />}
                label={p.name}
                onClick={async () => {
                  await db.videos.update(videoId, { attachedPdfId: p.id! });
                  setAttachSheet(false);
                }}
              />
            ))
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">No PDFs yet. Create one in Notes mode.</p>
          )}
        </div>
      </Sheet>
    </div>
  );
}
