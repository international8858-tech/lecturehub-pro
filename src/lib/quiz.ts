import { db, loadPdfJs, type Choice, type Question } from "./db";

/* ---------------------------------------------------------------------------
   Offline DPP → Quiz engine.
   Reads a question paper PDF fully on-device (pdf.js), locates every "Qn"
   marker, crops that exact region (question + its options) into an image,
   reads the Answer Key page, and crops each "Qn Text Solution" block.
--------------------------------------------------------------------------- */

const SCALE = 2;
const Q_RE = /^Q\s*\.?\s*(\d+)\b/;
const KEY_RE = /Q\s*\.?\s*(\d+)\s*[.:)\-–]?\s*\(?\s*([ABCD])\s*\)?/g;

type Seg = { key: string; page: number; y0: number; y1: number };

function cropCanvas(src: HTMLCanvasElement, y0: number, y1: number) {
  const h = Math.max(4, Math.round(y1 - y0));
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, Math.round(y0), src.width, h, 0, 0, c.width, h);
  return c;
}

function stack(parts: HTMLCanvasElement[]) {
  if (parts.length === 1) return parts[0]!;
  const w = Math.max(...parts.map((p) => p.width));
  const h = parts.reduce((a, p) => a + p.height, 0);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  let y = 0;
  for (const p of parts) {
    ctx.drawImage(p, 0, y);
    y += p.height;
  }
  return c;
}

const toBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.86));

interface Parsed {
  questions: { no: number; img: Blob; sol: Blob | null }[];
  answers: Map<number, Choice>;
}

export async function parsePdf(file: Blob, onStep?: (s: string) => void): Promise<Parsed> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

  type PageInfo = { n: number; role: "q" | "key" | "sol"; height: number; marks: { no: number; y: number }[]; text: string };
  const infos: PageInfo[] = [];

  for (let n = 1; n <= doc.numPages; n++) {
    onStep?.(`Reading page ${n} of ${doc.numPages}…`);
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items as { str: string; transform: number[]; height: number }[];
    const text = items.map((i) => i.str).join(" ");
    const role: PageInfo["role"] = /Answer\s*Key/i.test(text)
      ? "key"
      : /Hints?\s*&?\s*Solutions?|Text\s*Solution/i.test(text)
        ? "sol"
        : "q";
    const seen = new Map<number, number>();
    for (const it of items) {
      const m = Q_RE.exec(it.str.trim());
      if (!m) continue;
      const no = Number(m[1]);
      if (!no || no > 300) continue;
      const y = Math.max(0, vp.height - (it.transform[5] ?? 0) - (it.height || 10) - 4);
      const prev = seen.get(no);
      if (prev == null || y < prev) seen.set(no, y);
    }
    const marks = [...seen.entries()].map(([no, y]) => ({ no, y })).sort((a, b) => a.y - b.y);
    infos.push({ n, role, height: vp.height, marks, text });
  }

  // ---- answer key ----
  const answers = new Map<number, Choice>();
  for (const p of infos.filter((x) => x.role === "key")) {
    KEY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = KEY_RE.exec(p.text))) answers.set(Number(m[1]), m[2] as Choice);
  }

  // ---- crop regions (questions + solutions), continuing across pages ----
  const segs: Seg[] = [];
  const pool = infos.filter((p) => p.role !== "key");
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i]!;
    if (!p.marks.length) continue;
    const kind = p.role === "sol" ? "s" : "q";
    const bottom = p.height * 0.94; // trim page footer
    for (let j = 0; j < p.marks.length; j++) {
      const mk = p.marks[j]!;
      const next = p.marks[j + 1];
      const key = `${kind}${mk.no}`;
      segs.push({ key, page: p.n, y0: mk.y, y1: next ? next.y : bottom });
      // last block on the page → continue on top of the following page
      if (!next) {
        const nx = pool[i + 1];
        if (nx && nx.role === p.role) {
          const firstY = nx.marks[0]?.y ?? nx.height * 0.94;
          const top = nx.height * 0.06;
          if (firstY - top > 24) segs.push({ key, page: nx.n, y0: top, y1: firstY });
        }
      }
    }
  }

  // ---- render each needed page once and crop ----
  const parts = new Map<string, HTMLCanvasElement[]>();
  const pagesNeeded = [...new Set(segs.map((s) => s.page))].sort((a, b) => a - b);
  for (const n of pagesNeeded) {
    onStep?.(`Capturing questions from page ${n}…`);
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: SCALE });
    const c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c }).promise;
    for (const s of segs.filter((x) => x.page === n)) {
      const list = parts.get(s.key) ?? [];
      list.push(cropCanvas(c, s.y0 * SCALE, s.y1 * SCALE));
      parts.set(s.key, list);
    }
    c.width = c.height = 0;
  }

  const numbers = [...new Set(segs.filter((s) => s.key.startsWith("q")).map((s) => Number(s.key.slice(1))))].sort((a, b) => a - b);
  const questions: Parsed["questions"] = [];
  for (const no of numbers) {
    const qp = parts.get(`q${no}`);
    if (!qp?.length) continue;
    const sp = parts.get(`s${no}`);
    questions.push({
      no,
      img: await toBlob(stack(qp)),
      sol: sp?.length ? await toBlob(stack(sp)) : null,
    });
  }
  return { questions, answers };
}

/** Build a quiz from one or more question-paper PDFs (fully offline). */
export async function createQuizFromPdfs(folderId: number, name: string, files: Blob[], onStep?: (s: string) => void) {
  const quizId = await db.quizzes.add({ folderId, name, wallpaperBlob: null, count: 0, createdAt: Date.now() });
  let no = 0;
  const rows: Question[] = [];
  for (const f of files) {
    const { questions, answers } = await parsePdf(f, onStep);
    for (const q of questions) {
      no++;
      rows.push({ quizId, no, imgBlob: q.img, solBlob: q.sol, answer: answers.get(q.no) ?? null });
    }
  }
  if (rows.length) await db.questions.bulkAdd(rows);
  await db.quizzes.update(quizId, { count: rows.length });
  return { quizId, count: rows.length };
}

/** Build a quiz from photos — one captured photo per question. */
export async function createQuizFromImages(folderId: number, name: string, files: Blob[]) {
  const quizId = await db.quizzes.add({ folderId, name, wallpaperBlob: null, count: files.length, createdAt: Date.now() });
  await db.questions.bulkAdd(files.map((f, i) => ({ quizId, no: i + 1, imgBlob: f, solBlob: null, answer: null })));
  return { quizId, count: files.length };
}

/** Add more PDFs / photos to an existing quiz. */
export async function appendToQuiz(quizId: number, files: Blob[], kind: "pdf" | "image", onStep?: (s: string) => void) {
  const existing = await db.questions.where("quizId").equals(quizId).count();
  let no = existing;
  const rows: Question[] = [];
  if (kind === "image") {
    for (const f of files) rows.push({ quizId, no: ++no, imgBlob: f, solBlob: null, answer: null });
  } else {
    for (const f of files) {
      const { questions, answers } = await parsePdf(f, onStep);
      for (const q of questions) rows.push({ quizId, no: ++no, imgBlob: q.img, solBlob: q.sol, answer: answers.get(q.no) ?? null });
    }
  }
  if (rows.length) await db.questions.bulkAdd(rows);
  await db.quizzes.update(quizId, { count: no });
  return rows.length;
}

export async function deleteQuiz(id: number) {
  await db.questions.where("quizId").equals(id).delete();
  await db.attempts.where("quizId").equals(id).delete();
  await db.quizzes.delete(id);
}
