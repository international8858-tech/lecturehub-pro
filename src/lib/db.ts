import Dexie, { type Table } from "dexie";

export type Difficulty = "L1" | "L2" | "Hard" | "Exam";
export type FolderColor = "blue" | "orange" | "green" | "purple" | "pink";

export interface Folder {
  id?: number;
  name: string;
  parentId: number | null;
  color: FolderColor;
  createdAt: number;
}
export interface ImageItem {
  id?: number;
  folderId: number;
  name: string;
  blob: Blob;
  tags: string[];
  difficulty: Difficulty;
  isCompleted: 0 | 1;
  createdAt: number;
}
export interface Highlight {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
}
export interface PdfItem {
  id?: number;
  folderId: number;
  name: string;
  blobId: number;
  pageCount: number;
  completedPages: number[];
  completedPercentage: number;
  annotations: Highlight[];
  createdAt: number;
}
export interface VideoItem {
  id?: number;
  folderId: number;
  name: string;
  blobId: number;
  thumbnailBlob: Blob | null;
  attachedPdfId: number | null;
  lastPosition: number;
  duration: number;
  isCompleted: 0 | 1;
  createdAt: number;
}
export interface HistoryItem {
  id?: number;
  videoId: number;
  watchedAt: number;
}
export interface BlobRow {
  id?: number;
  blob: Blob;
}

class StudyDB extends Dexie {
  folders!: Table<Folder, number>;
  images!: Table<ImageItem, number>;
  pdfs!: Table<PdfItem, number>;
  videos!: Table<VideoItem, number>;
  history!: Table<HistoryItem, number>;
  blobs!: Table<BlobRow, number>;
  constructor() {
    super("studyhub");
    this.version(1).stores({
      folders: "++id, parentId, createdAt",
      images: "++id, folderId, [folderId+isCompleted], createdAt",
      pdfs: "++id, folderId, createdAt",
      videos: "++id, folderId, createdAt",
      history: "++id, videoId, watchedAt",
      blobs: "++id",
    });
  }
}

export const db = new StudyDB();

let seeding: Promise<void> | null = null;

export function seedDefaults(): Promise<void> {
  // Single-flight + transactional guard so React's double-invoked effects
  // (and any re-mount) can never create duplicate starter folders.
  seeding ??= db
    .transaction("rw", db.folders, async () => {
      if ((await db.folders.count()) > 0) return;
      const now = Date.now();
      await db.folders.bulkAdd([
        { name: "Physics", parentId: null, color: "blue", createdAt: now },
        { name: "Chemistry", parentId: null, color: "orange", createdAt: now + 1 },
        { name: "Mathematics", parentId: null, color: "green", createdAt: now + 2 },
      ]);
    })
    .then(() => dedupeEmptyRoots())
    .catch(() => {});
  return seeding;
}

/** One-time repair: drop duplicate top-level folders that are completely empty. */
async function dedupeEmptyRoots() {
  const all = await db.folders.toArray();
  const roots = all.filter((f) => f.parentId === null);
  const seen = new Set<string>();
  for (const f of roots.sort((a, b) => a.createdAt - b.createdAt)) {
    const key = f.name.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    const id = f.id!;
    const empty =
      all.every((x) => x.parentId !== id) &&
      (await db.images.where("folderId").equals(id).count()) === 0 &&
      (await db.pdfs.where("folderId").equals(id).count()) === 0 &&
      (await db.videos.where("folderId").equals(id).count()) === 0;
    if (empty) await db.folders.delete(id);
  }
}

export async function subtreeIds(id: number): Promise<number[]> {
  const ids = [id];
  let frontier = [id];
  while (frontier.length) {
    const kids = (await db.folders.where("parentId").anyOf(frontier).primaryKeys()) as number[];
    frontier = kids;
    ids.push(...kids);
  }
  return ids;
}

export interface Progress {
  total: number;
  done: number;
  pct: number;
  images: number;
  pdfs: number;
  videos: number;
}

export async function folderProgress(id: number): Promise<Progress> {
  const ids = await subtreeIds(id);
  const images = await db.images.where("folderId").anyOf(ids).count();
  const doneImages = await db.images
    .where("[folderId+isCompleted]")
    .anyOf(ids.map((i) => [i, 1]))
    .count();
  const pdfs = await db.pdfs.where("folderId").anyOf(ids).toArray();
  const videos = await db.videos.where("folderId").anyOf(ids).toArray();
  const pages = pdfs.reduce((a, p) => a + p.pageCount, 0);
  const donePages = pdfs.reduce((a, p) => a + p.completedPages.length, 0);
  const doneVideos = videos.filter((v) => v.isCompleted).length;
  const total = images + pages + videos.length;
  const done = doneImages + donePages + doneVideos;
  return {
    total,
    done,
    pct: total ? Math.round((done / total) * 100) : 0,
    images,
    pdfs: pdfs.length,
    videos: videos.length,
  };
}

export async function deleteFolderDeep(id: number) {
  const ids = await subtreeIds(id);
  await db.transaction("rw", [db.folders, db.images, db.pdfs, db.videos, db.blobs, db.history], async () => {
    const pdfs = await db.pdfs.where("folderId").anyOf(ids).toArray();
    const vids = await db.videos.where("folderId").anyOf(ids).toArray();
    await db.blobs.bulkDelete([...pdfs.map((p) => p.blobId), ...vids.map((v) => v.blobId)]);
    await db.history.where("videoId").anyOf(vids.map((v) => v.id!)).delete();
    await db.pdfs.bulkDelete(pdfs.map((p) => p.id!));
    await db.videos.bulkDelete(vids.map((v) => v.id!));
    await db.images.where("folderId").anyOf(ids).delete();
    await db.folders.bulkDelete(ids);
  });
}

export async function deletePdf(id: number) {
  const p = await db.pdfs.get(id);
  if (!p) return;
  await db.blobs.delete(p.blobId);
  await db.videos.where("folderId").above(-1).modify((v) => {
    if (v.attachedPdfId === id) v.attachedPdfId = null;
  });
  await db.pdfs.delete(id);
}

export async function deleteVideo(id: number) {
  const v = await db.videos.get(id);
  if (!v) return;
  await db.blobs.delete(v.blobId);
  await db.history.where("videoId").equals(id).delete();
  await db.videos.delete(id);
}

export async function addPdf(folderId: number, name: string, blob: Blob, pageCount: number) {
  const blobId = await db.blobs.add({ blob });
  return db.pdfs.add({
    folderId,
    name,
    blobId,
    pageCount,
    completedPages: [],
    completedPercentage: 0,
    annotations: [],
    createdAt: Date.now(),
  });
}

export async function makeThumbnail(file: Blob): Promise<{ thumb: Blob | null; duration: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.src = url;
    const finish = (thumb: Blob | null) => {
      URL.revokeObjectURL(url);
      resolve({ thumb, duration: v.duration || 0 });
    };
    v.onerror = () => finish(null);
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
    };
    v.onseeked = () => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = Math.round((320 * v.videoHeight) / v.videoWidth) || 180;
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => finish(b), "image/jpeg", 0.7);
    };
  });
}

export async function addVideo(folderId: number, file: File) {
  const { thumb, duration } = await makeThumbnail(file);
  const blobId = await db.blobs.add({ blob: file });
  return db.videos.add({
    folderId,
    name: file.name.replace(/\.[^.]+$/, ""),
    blobId,
    thumbnailBlob: thumb,
    attachedPdfId: null,
    lastPosition: 0,
    duration,
    isCompleted: 0,
    createdAt: Date.now(),
  });
}

export async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  return pdfjs;
}

async function blobToDataUrl(b: Blob) {
  return new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.readAsDataURL(b);
  });
}

async function compressImage(b: Blob, max = 1600): Promise<string> {
  const url = URL.createObjectURL(b);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * s);
    c.height = Math.round(img.height * s);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Build a PDF from images; optionally prepend the pages of an existing PDF. */
export async function buildPdf(images: Blob[], existing?: Blob): Promise<{ blob: Blob; pages: number }> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  let first = true;
  const place = (dataUrl: string, w: number, h: number) => {
    if (!first) doc.addPage();
    first = false;
    const s = Math.min((W - 40) / w, (H - 40) / h);
    doc.addImage(dataUrl, "JPEG", (W - w * s) / 2, (H - h * s) / 2, w * s, h * s);
  };
  if (existing) {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: await existing.arrayBuffer() }).promise;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1.5 });
      const c = document.createElement("canvas");
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c }).promise;
      place(c.toDataURL("image/jpeg", 0.8), c.width, c.height);
    }
  }
  for (const b of images) {
    const dataUrl = await compressImage(b);
    const img = await new Promise<HTMLImageElement>((res) => {
      const i = new Image();
      i.onload = () => res(i);
      i.src = dataUrl;
    });
    place(dataUrl, img.width, img.height);
  }
  void blobToDataUrl;
  return { blob: doc.output("blob"), pages: doc.getNumberOfPages() };
}
