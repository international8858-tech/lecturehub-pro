import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Folder as FolderIcon,
  FolderPlus,
  Plus,
  Camera,
  Images,
  FileText,
  Video,
  ChevronRight,
  Home,
  BarChart3,
  Search,
  Pencil,
  Trash2,
  MoveRight,
  Download,
  Check,
  Play,
  WifiOff,
  Smartphone,
  X,
  FileStack,
  Clock,
  ListChecks,
} from "lucide-react";

import {
  db,
  seedDefaults,
  folderProgress,
  deleteFolderDeep,
  deletePdf,
  deleteVideo,
  addPdf,
  addVideo,
  buildPdf,
  loadPdfJs,
  type Folder,
  type ImageItem,
  type PdfItem,
  type VideoItem,
  type FolderColor,
  type Progress,
} from "@/lib/db";
import { BlobImage, Btn, LongPressable, Modal, Ring, Sheet, SheetItem, colors, difficulties, inputCls, tint, fmt } from "./ui";
import { ImageEditor } from "./ImageEditor";
import { PdfViewer } from "./PdfViewer";
import { VideoPlayer } from "./VideoPlayer";
import { QuizRunner } from "./QuizRunner";
import { createQuizFromImages, createQuizFromPdfs, deleteQuiz } from "@/lib/quiz";


type Mode = "notes" | "lecture";
type Tab = "home" | "stats" | "search";
type Target = { kind: "folder"; item: Folder } | { kind: "image"; item: ImageItem } | { kind: "pdf"; item: PdfItem } | { kind: "video"; item: VideoItem };
type Opened = { kind: "image"; id: number } | { kind: "pdf"; id: number } | { kind: "video"; id: number };

interface BIP extends Event {
  prompt: () => Promise<void>;
}

export default function StudyApp() {
  const [mode, setMode] = useState<Mode>("notes");
  const [tab, setTab] = useState<Tab>("home");
  const [folderId, setFolderId] = useState<number | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [dialog, setDialog] = useState<"newFolder" | "rename" | "move" | "delete" | "pdfName" | "quizName" | null>(null);
  const [text, setText] = useState("");
  const [color, setColor] = useState<FolderColor>("blue");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [installEvt, setInstallEvt] = useState<BIP | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [online, setOnline] = useState(true);
  const [query, setQuery] = useState("");
  const [progressMap, setProgressMap] = useState<Record<number, Progress>>({});
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    seedDefaults();
    // Register the offline service worker so the app opens with zero network.
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    setOnline(navigator.onLine);
    const bip = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BIP);
    };
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("beforeinstallprompt", bip);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("beforeinstallprompt", bip);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const allFolders = useLiveQuery(() => db.folders.orderBy("createdAt").toArray(), []) ?? [];
  const folders = allFolders.filter((f) => f.parentId === folderId);
  const current = allFolders.find((f) => f.id === folderId) ?? null;
  const images = useLiveQuery(() => (folderId == null ? [] : db.images.where("folderId").equals(folderId).sortBy("createdAt")), [folderId]) ?? [];
  const pdfs = useLiveQuery(() => (folderId == null ? [] : db.pdfs.where("folderId").equals(folderId).sortBy("createdAt")), [folderId]) ?? [];
  const videos = useLiveQuery(() => (folderId == null ? [] : db.videos.where("folderId").equals(folderId).sortBy("createdAt")), [folderId]) ?? [];
  const recent = useLiveQuery(async () => {
    const h = await db.history.orderBy("watchedAt").reverse().limit(30).toArray();
    const ids = [...new Set(h.map((x) => x.videoId))].slice(0, 6);
    const vids = await db.videos.bulkGet(ids);
    return vids.filter(Boolean) as VideoItem[];
  }, []) ?? [];
  const allPdfs = useLiveQuery(() => db.pdfs.toArray(), []) ?? [];
  const allVideos = useLiveQuery(() => db.videos.toArray(), []) ?? [];
  const imgCount = useLiveQuery(() => db.images.count(), []) ?? 0;
  const imgDone = useLiveQuery(() => db.images.filter((i) => i.isCompleted === 1).count(), []) ?? 0;

  // folder progress (recomputed whenever data changes)
  useEffect(() => {
    let alive = true;
    (async () => {
      const m: Record<number, Progress> = {};
      for (const f of allFolders) m[f.id!] = await folderProgress(f.id!);
      if (alive) setProgressMap(m);
    })();
    return () => {
      alive = false;
    };
  }, [allFolders, images, pdfs, videos, allPdfs, allVideos, imgCount, imgDone]);

  const path: Folder[] = [];
  for (let f = current; f; f = allFolders.find((x) => x.id === f!.parentId) ?? null) path.unshift(f);

  // ----- uploads (routed directly to active folder) -----
  const addImages = async (files: FileList | null) => {
    if (!files?.length || folderId == null) return;
    const now = Date.now();
    await db.images.bulkAdd(
      Array.from(files).map((f, i) => ({
        folderId,
        name: f.name.replace(/\.[^.]+$/, "") || `Photo ${i + 1}`,
        blob: f,
        tags: [],
        difficulty: "L1" as const,
        isCompleted: 0 as const,
        createdAt: now + i,
      })),
    );
    setAddOpen(false);
  };
  const uploadPdf = async (files: FileList | null) => {
    if (!files?.length || folderId == null) return;
    setBusy("Importing PDF…");
    for (const f of Array.from(files)) {
      let pages = 0;
      try {
        const pdfjs = await loadPdfJs();
        pages = (await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise).numPages;
      } catch {}
      await addPdf(folderId, f.name.replace(/\.pdf$/i, ""), f, pages);
    }
    setBusy(null);
    setAddOpen(false);
  };
  const uploadVideo = async (files: FileList | null) => {
    if (!files?.length || folderId == null) return;
    setBusy("Saving video…");
    for (const f of Array.from(files)) await addVideo(folderId, f);
    setBusy(null);
    setAddOpen(false);
  };
  const compilePdf = async () => {
    if (folderId == null || !selected.length) return;
    setBusy("Compiling PDF…");
    const imgs = (await db.images.bulkGet(selected)).filter(Boolean) as ImageItem[];
    const { blob, pages } = await buildPdf(imgs.map((i) => i.blob));
    await addPdf(folderId, text.trim() || `${current?.name ?? "Notes"} compilation`, blob, pages);
    setBusy(null);
    setSelecting(false);
    setSelected([]);
    setDialog(null);
  };

  // ----- long-press actions -----
  const openDialog = (d: typeof dialog) => {
    if (target) setText("name" in target.item ? target.item.name : "");
    setDialog(d);
  };
  const doRename = async () => {
    if (!target || !text.trim()) return;
    const n = text.trim();
    if (target.kind === "folder") await db.folders.update(target.item.id!, { name: n });
    if (target.kind === "image") await db.images.update(target.item.id!, { name: n });
    if (target.kind === "pdf") await db.pdfs.update(target.item.id!, { name: n });
    if (target.kind === "video") await db.videos.update(target.item.id!, { name: n });
    setDialog(null);
    setTarget(null);
  };
  const doMove = async (dest: number | null) => {
    if (!target) return;
    if (target.kind === "folder") await db.folders.update(target.item.id!, { parentId: dest });
    else if (dest != null) {
      if (target.kind === "image") await db.images.update(target.item.id!, { folderId: dest });
      if (target.kind === "pdf") await db.pdfs.update(target.item.id!, { folderId: dest });
      if (target.kind === "video") await db.videos.update(target.item.id!, { folderId: dest });
    }
    setDialog(null);
    setTarget(null);
  };
  const doDelete = async () => {
    if (!target) return;
    if (target.kind === "folder") await deleteFolderDeep(target.item.id!);
    if (target.kind === "image") await db.images.delete(target.item.id!);
    if (target.kind === "pdf") await deletePdf(target.item.id!);
    if (target.kind === "video") await deleteVideo(target.item.id!);
    setDialog(null);
    setTarget(null);
  };
  const createFolder = async () => {
    if (!text.trim()) return;
    await db.folders.add({ name: text.trim(), parentId: folderId, color, createdAt: Date.now() });
    setDialog(null);
    setAddOpen(false);
  };

  // ----- overlays -----
  if (opened?.kind === "image") {
    const img = images.find((i) => i.id === opened.id);
    if (img) return <ImageEditor image={img} onClose={() => setOpened(null)} />;
  }
  if (opened?.kind === "pdf") return <PdfViewer pdfId={opened.id} onClose={() => setOpened(null)} />;
  if (opened?.kind === "video") return <VideoPlayer videoId={opened.id} onClose={() => setOpened(null)} />;

  const folderCard = (f: Folder) => {
    const p = progressMap[f.id!];
    const t = tint[f.color];
    return (
      <LongPressable key={f.id} onLongPress={() => setTarget({ kind: "folder", item: f })} onTap={() => setFolderId(f.id!)}>
        <div className={`press flex items-center gap-3 rounded-2xl p-3 ${t.bg}`}>
          <div className={`rounded-xl p-2.5 text-primary-foreground ${t.solid}`}>
            <FolderIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <p className="truncate text-sm font-bold">{f.name}</p>
              {p && p.total > 0 && <span className={`rounded-full bg-card px-2 py-0.5 text-[10px] font-bold ${t.fg}`}>{p.pct}% Mastered</span>}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {p ? `${p.images} photos · ${p.pdfs} PDFs · ${p.videos} videos` : "…"}
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-card">
              <div className={`h-full rounded-full ${t.solid}`} style={{ width: `${p?.pct ?? 0}%` }} />
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </LongPressable>
    );
  };

  const videoCard = (v: VideoItem) => (
    <LongPressable key={v.id} onLongPress={() => setTarget({ kind: "video", item: v })} onTap={() => setOpened({ kind: "video", id: v.id! })}>
      <div className="press flex items-center gap-3 rounded-2xl bg-card p-2 shadow-card">
        <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-xl bg-player">
          <BlobImage blob={v.thumbnailBlob} className="h-full w-full object-cover" />
          <Play className="absolute inset-0 m-auto h-5 w-5 text-player-foreground drop-shadow" />
          {v.duration > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-player-foreground/30">
              <div className="h-full bg-primary" style={{ width: `${(v.lastPosition / v.duration) * 100}%` }} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{v.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {fmt(v.lastPosition)} / {fmt(v.duration)} {v.attachedPdfId ? "· Notes attached" : ""}
          </p>
        </div>
        {v.isCompleted ? (
          <span className="rounded-full bg-success p-1 text-success-foreground">
            <Check className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
    </LongPressable>
  );

  const q = query.trim().toLowerCase();
  const searchResults = q
    ? [
        ...allFolders.filter((f) => f.name.toLowerCase().includes(q)).map((f) => ({ kind: "folder" as const, item: f })),
        ...allPdfs.filter((p) => p.name.toLowerCase().includes(q)).map((p) => ({ kind: "pdf" as const, item: p })),
        ...allVideos.filter((v) => v.name.toLowerCase().includes(q)).map((v) => ({ kind: "video" as const, item: v })),
      ]
    : [];

  const roots = allFolders.filter((f) => f.parentId === null);
  const totalUnits = imgCount + allPdfs.reduce((a, p) => a + p.pageCount, 0) + allVideos.length;
  const doneUnits = imgDone + allPdfs.reduce((a, p) => a + p.completedPages.length, 0) + allVideos.filter((v) => v.isCompleted).length;
  const overall = totalUnits ? Math.round((doneUnits / totalUnits) * 100) : 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-background">
      {/* header */}
      <header className="sticky top-0 z-20 bg-background/90 px-4 pb-2 pt-4 backdrop-blur">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">LocalHost</p>
            <h1 className="text-2xl font-extrabold leading-tight">Study Hub</h1>
          </div>
          <div className="flex items-center gap-1.5">
            {installEvt && (
              <button
                onClick={async () => {
                  await installEvt.prompt();
                  setInstallEvt(null);
                }}
                className="press flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
              >
                <Download className="h-3.5 w-3.5" /> Install
              </button>
            )}
            <span className="flex items-center gap-1 rounded-full bg-success/15 px-2 py-1 text-[10px] font-bold text-success">
              {standalone ? <Smartphone className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {standalone ? "Installed · Offline" : "Works offline"}
            </span>
          </div>
        </div>
        {/* dual-mode toggle */}
        <div className="mt-3 grid grid-cols-2 rounded-2xl bg-secondary p-1 text-xs font-bold">
          {(["notes", "lecture"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex items-center justify-center gap-1.5 rounded-xl py-2 transition-colors ${mode === m ? "bg-card shadow-card text-primary" : "text-muted-foreground"}`}
            >
              {m === "notes" ? <FileText className="h-4 w-4" /> : <Video className="h-4 w-4" />}
              {m === "notes" ? "Notes & PDF" : "Lecture Video"}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 pb-32">
        {tab === "home" && (
          <>
            {/* breadcrumbs */}
            <nav className="no-scrollbar flex items-center gap-1 overflow-x-auto text-xs font-semibold text-muted-foreground">
              <button onClick={() => setFolderId(null)} className={`shrink-0 rounded-full px-2 py-1 ${folderId == null ? "bg-accent text-accent-foreground" : ""}`}>
                Home
              </button>
              {path.map((f) => (
                <span key={f.id} className="flex shrink-0 items-center gap-1">
                  <ChevronRight className="h-3 w-3" />
                  <button onClick={() => setFolderId(f.id!)} className={`rounded-full px-2 py-1 ${f.id === folderId ? "bg-accent text-accent-foreground" : ""}`}>
                    {f.name}
                  </button>
                </span>
              ))}
            </nav>

            {busy && <div className="rounded-2xl bg-accent px-4 py-2 text-xs font-bold text-accent-foreground">{busy}</div>}

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold">{folderId == null ? "Subjects" : "Chapters"}</h2>
                <button onClick={() => { setText(""); setDialog("newFolder"); }} className="flex items-center gap-1 text-xs font-bold text-primary">
                  <FolderPlus className="h-4 w-4" /> {folderId == null ? "Add Folder" : "Add Sub-folder"}
                </button>
              </div>
              {folders.length ? folders.map(folderCard) : <p className="rounded-2xl border border-dashed p-4 text-center text-xs text-muted-foreground">No folders yet</p>}
            </section>

            {folderId != null && mode === "notes" && (
              <>
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold">PDFs</h2>
                  </div>
                  {pdfs.length === 0 && <p className="text-xs text-muted-foreground">No PDFs in this chapter.</p>}
                  {pdfs.map((p) => (
                    <LongPressable key={p.id} onLongPress={() => setTarget({ kind: "pdf", item: p })} onTap={() => setOpened({ kind: "pdf", id: p.id! })}>
                      <div className="press flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card">
                        <div className="rounded-xl bg-destructive/10 p-2.5 text-destructive">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{p.name}</p>
                          <p className="text-[11px] text-muted-foreground">{p.pageCount} pages · {p.annotations.length} highlights</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.completedPercentage === 100 ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}`}>
                          {p.completedPercentage}%
                        </span>
                      </div>
                    </LongPressable>
                  ))}
                </section>

                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold">Questions & Photos</h2>
                    {images.length > 0 && (
                      <button
                        onClick={() => {
                          setSelecting((v) => !v);
                          setSelected([]);
                        }}
                        className="text-xs font-bold text-primary"
                      >
                        {selecting ? "Cancel" : "Select"}
                      </button>
                    )}
                  </div>
                  {images.length === 0 && <p className="text-xs text-muted-foreground">Tap + to capture or upload question photos.</p>}
                  <div className="grid grid-cols-3 gap-2">
                    {images.map((im) => {
                      const d = difficulties.find((x) => x.key === im.difficulty)!;
                      const sel = selected.includes(im.id!);
                      return (
                        <LongPressable
                          key={im.id}
                          onLongPress={() => setTarget({ kind: "image", item: im })}
                          onTap={() =>
                            selecting ? setSelected((s) => (sel ? s.filter((x) => x !== im.id) : [...s, im.id!])) : setOpened({ kind: "image", id: im.id! })
                          }
                        >
                          <div className={`press relative aspect-[3/4] overflow-hidden rounded-xl bg-card shadow-card ${sel ? "ring-2 ring-primary" : ""}`}>
                            <BlobImage blob={im.blob} className="h-full w-full object-cover" alt={im.name} />
                            <span className={`absolute left-1 top-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold backdrop-blur ${d.cls}`}>{d.label}</span>
                            {im.isCompleted ? (
                              <span className="absolute bottom-1 right-1 rounded-full bg-success p-0.5 text-success-foreground">
                                <Check className="h-3 w-3" />
                              </span>
                            ) : null}
                            {selecting && (
                              <span className={`absolute right-1 top-1 h-5 w-5 rounded-full border-2 border-card ${sel ? "bg-primary" : "bg-overlay"}`} />
                            )}
                          </div>
                        </LongPressable>
                      );
                    })}
                  </div>
                </section>
              </>
            )}

            {folderId != null && mode === "lecture" && (
              <section className="space-y-2">
                <h2 className="text-sm font-bold">Lectures</h2>
                {videos.length === 0 && <p className="text-xs text-muted-foreground">Tap + to add lecture videos to this chapter.</p>}
                {videos.map(videoCard)}
              </section>
            )}

            {folderId == null && mode === "lecture" && recent.length > 0 && (
              <section className="space-y-2">
                <h2 className="flex items-center gap-1.5 text-sm font-bold">
                  <Clock className="h-4 w-4 text-primary" /> Recently Watched
                </h2>
                {recent.map(videoCard)}
              </section>
            )}
          </>
        )}

        {tab === "stats" && (
          <section className="space-y-4">
            <div className="flex items-center gap-4 rounded-3xl bg-card p-5 shadow-card">
              <div className="relative">
                <Ring pct={overall} size={92} stroke={9} />
                <span className="absolute inset-0 flex items-center justify-center text-lg font-extrabold">{overall}%</span>
              </div>
              <div>
                <p className="text-base font-extrabold">Total Progress</p>
                <p className="text-xs text-muted-foreground">
                  {doneUnits} of {totalUnits} items completed
                </p>
              </div>
            </div>
            <h2 className="text-sm font-bold">Subject-wise</h2>
            <div className="grid grid-cols-2 gap-3">
              {roots.map((f) => {
                const p = progressMap[f.id!];
                return (
                  <div key={f.id} className="flex flex-col items-center gap-2 rounded-3xl bg-card p-4 shadow-card">
                    <div className="relative">
                      <Ring pct={p?.pct ?? 0} size={80} stroke={8} color={tint[f.color].fg} />
                      <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold">{p?.pct ?? 0}%</span>
                    </div>
                    <p className="text-sm font-bold">{f.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {p?.done ?? 0}/{p?.total ?? 0} done
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {tab === "search" && (
          <section className="space-y-3">
            <div className="flex items-center gap-2 rounded-2xl bg-secondary px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input autoFocus className="w-full bg-transparent py-3 text-sm outline-none" placeholder="Search folders, PDFs, videos…" value={query} onChange={(e) => setQuery(e.target.value)} />
              {query && <X className="h-4 w-4" onClick={() => setQuery("")} />}
            </div>
            {searchResults.map((r) =>
              r.kind === "folder" ? (
                <div key={`f${r.item.id}`} onClick={() => { setFolderId(r.item.id!); setTab("home"); }}>{folderCard(r.item)}</div>
              ) : r.kind === "video" ? (
                videoCard(r.item)
              ) : (
                <button key={`p${r.item.id}`} onClick={() => setOpened({ kind: "pdf", id: r.item.id! })} className="press flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left shadow-card">
                  <FileText className="h-5 w-5 text-destructive" />
                  <span className="truncate text-sm font-bold">{r.item.name}</span>
                </button>
              ),
            )}
            {q && searchResults.length === 0 && <p className="text-center text-xs text-muted-foreground">Nothing found</p>}
          </section>
        )}
      </main>

      {/* compile bar */}
      {selecting && selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-30 mx-auto flex max-w-md items-center justify-between gap-2 px-4">
          <Btn className="flex-1 shadow-fab" onClick={() => { setText(""); setDialog("pdfName"); }}>
            <FileStack className="h-4 w-4" /> Make PDF from {selected.length} photo{selected.length > 1 ? "s" : ""}
          </Btn>
        </div>
      )}

      {/* FAB */}
      {tab === "home" && !selecting && (
        <button onClick={() => setAddOpen(true)} className="press fixed bottom-20 right-5 z-30 rounded-full bg-foreground p-4 text-background shadow-fab" aria-label="Add">
          <Plus className="h-6 w-6" />
        </button>
      )}

      {/* bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-md grid-cols-3 border-t bg-card/95 backdrop-blur safe-bottom">
        {(
          [
            ["home", Home, "Home"],
            ["stats", BarChart3, "Progress"],
            ["search", Search, "Search"],
          ] as const
        ).map(([k, Icon, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-bold ${tab === k ? "text-primary" : "text-muted-foreground"}`}>
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </nav>

      {/* hidden inputs */}
      <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => addImages(e.target.files)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addImages(e.target.files)} />
      <input ref={pdfRef} type="file" accept="application/pdf" multiple hidden onChange={(e) => uploadPdf(e.target.files)} />
      <input ref={videoRef} type="file" accept="video/*" multiple hidden onChange={(e) => uploadVideo(e.target.files)} />

      {/* add sheet */}
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={current ? `Add to ${current.name}` : "Add"}>
        <div className="space-y-1">
          <SheetItem icon={<FolderPlus className="h-4 w-4" />} label={folderId == null ? "New subject folder" : "New sub-folder"} onClick={() => { setText(""); setDialog("newFolder"); }} />
          {folderId != null && mode === "notes" && (
            <>
              <SheetItem icon={<Camera className="h-4 w-4" />} label="Capture with camera" onClick={() => cameraRef.current?.click()} />
              <SheetItem icon={<Images className="h-4 w-4" />} label="Upload photos from gallery" onClick={() => galleryRef.current?.click()} />
              <SheetItem icon={<FileText className="h-4 w-4" />} label="Upload PDF" onClick={() => pdfRef.current?.click()} />
            </>
          )}
          {folderId != null && mode === "lecture" && <SheetItem icon={<Video className="h-4 w-4" />} label="Upload lecture video" onClick={() => videoRef.current?.click()} />}
          {folderId == null && <p className="px-3 pt-2 text-xs text-muted-foreground">Open a subject or chapter to upload photos, PDFs or videos into it.</p>}
        </div>
      </Sheet>

      {/* long-press action sheet */}
      <Sheet open={!!target && !dialog} onClose={() => setTarget(null)} title={target ? ("name" in target.item ? target.item.name : "") : ""}>
        <div className="space-y-1">
          {target?.kind === "image" && <SheetItem icon={<Pencil className="h-4 w-4" />} label="Edit photo" onClick={() => { setOpened({ kind: "image", id: target.item.id! }); setTarget(null); }} />}
          <SheetItem icon={<Pencil className="h-4 w-4" />} label="Rename" onClick={() => openDialog("rename")} />
          <SheetItem icon={<MoveRight className="h-4 w-4" />} label="Re-route to another folder" onClick={() => openDialog("move")} />
          <SheetItem icon={<Trash2 className="h-4 w-4" />} label="Delete" danger onClick={() => openDialog("delete")} />
        </div>
      </Sheet>

      {/* dialogs */}
      <Modal open={dialog === "newFolder"} onClose={() => setDialog(null)} title={folderId == null ? "New subject" : `New chapter in ${current?.name}`}>
        <input autoFocus className={inputCls} placeholder="e.g. Kinematics" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createFolder()} />
        <div className="mt-3 flex gap-2">
          {colors.map((c) => (
            <button key={c} onClick={() => setColor(c)} className={`h-8 w-8 rounded-full ${tint[c].solid} ${color === c ? "ring-2 ring-ring ring-offset-2" : ""}`} aria-label={c} />
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="secondary" onClick={() => setDialog(null)}>Cancel</Btn>
          <Btn onClick={createFolder}>Create</Btn>
        </div>
      </Modal>

      <Modal open={dialog === "rename"} onClose={() => setDialog(null)} title="Rename">
        <input autoFocus className={inputCls} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doRename()} />
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="secondary" onClick={() => setDialog(null)}>Cancel</Btn>
          <Btn onClick={doRename}>Save</Btn>
        </div>
      </Modal>

      <Modal open={dialog === "pdfName"} onClose={() => setDialog(null)} title="Name your PDF">
        <input autoFocus className={inputCls} placeholder={`${current?.name ?? "Notes"} compilation`} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="secondary" onClick={() => setDialog(null)}>Cancel</Btn>
          <Btn onClick={compilePdf}>Compile</Btn>
        </div>
      </Modal>

      <Modal open={dialog === "move"} onClose={() => setDialog(null)} title="Move to…">
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {target?.kind === "folder" && <SheetItem icon={<Home className="h-4 w-4" />} label="Top level" onClick={() => doMove(null)} />}
          {allFolders
            .filter((f) => !(target?.kind === "folder" && f.id === target.item.id))
            .map((f) => (
              <SheetItem key={f.id} icon={<FolderIcon className={`h-4 w-4 ${tint[f.color].fg}`} />} label={f.parentId == null ? f.name : `↳ ${f.name}`} onClick={() => doMove(f.id!)} />
            ))}
        </div>
      </Modal>

      <Modal open={dialog === "delete"} onClose={() => setDialog(null)} title="Delete?">
        <p className="text-sm text-muted-foreground">
          {target?.kind === "folder" ? "This folder and everything inside it will be permanently deleted." : "This item will be permanently deleted from your device."}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="secondary" onClick={() => setDialog(null)}>Cancel</Btn>
          <Btn variant="danger" onClick={doDelete}>
            <Trash2 className="h-4 w-4" /> Delete
          </Btn>
        </div>
      </Modal>
    </div>
  );
}
