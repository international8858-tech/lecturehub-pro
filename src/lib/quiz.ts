import { db, loadPdfJs, type Choice, type Question } from "./db";

/* ---------------------------------------------------------------------------
   Universal offline question-paper → Quiz engine.
   Works with any PDF layout (1 or 2 columns, "Q.1", "1.", "65.", "प्रश्न 1.")
   Crops each question tightly (white margins removed), crops every option
   separately so image-based options still work, reads the answer key when the
   paper has one, and captures the solution block when present.
--------------------------------------------------------------------------- */

const SCALE = 2;
export type QKind = "mcq" | "text";

/** Question marker at the very start of a text item. */
const MARK_RE =
  /^(?:q(?:ues(?:tion)?)?|प्र(?:श्न)?|प्रo)?\s*\.?\s*(\d{1,3})\s*[.)\]:\-–]?\s*(?=$|[\s(]|[A-Za-zअ-ह])/i;
/** Option marker e.g. (1) (A) A. a) */
const OPT_RE = /^[(\[]?\s*([1-4a-dA-D])\s*[)\].:]\s*/;
/** Answer key row e.g. "12. (3)" / "Q12 B" / "12 - C" */
const KEY_RE = /(?:q\s*\.?\s*)?(\d{1,3})\s*[.:)\-–]?\s*[([]?\s*([1-4A-Da-d])\s*[)\]]?(?=\s|$)/gi;

const toChoice = (s: string): Choice | null => {
  const u = s.toUpperCase();
  if ("ABCD".includes(u)) return u as Choice;
  const n = Number(u);
  return n >= 1 && n <= 4 ? (["A", "B", "C", "D"][n - 1] as Choice) : null;
};

type Item = { str: string; x: number; y: number; w: number; h: number };
type Box = { x0: number; y0: number; x1: number; y1: number };
type Seg = { key: string; page: number; box: Box };

/* ----------------------------- canvas helpers ----------------------------- */

function cropBox(src: HTMLCanvasElement, b: Box) {
  const x = Math.max(0, Math.round(b.x0));
  const y = Math.max(0, Math.round(b.y0));
  const w = Math.max(8, Math.min(src.width - x, Math.round(b.x1 - b.x0)));
  const h = Math.max(8, Math.min(src.height - y, Math.round(b.y1 - b.y0)));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
  return trim(c);
}

/** Remove blank margins so every crop is exactly the size of its content. */
function trim(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  let d: Uint8ClampedArray;
  try {
    d = ctx.getImageData(0, 0, c.width, c.height).data;
  } catch {
    return c;
  }
  let top = c.height,
    bottom = -1,
    left = c.width,
    right = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if ((d[i]! + d[i + 1]! + d[i + 2]!) / 3 < 243) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom < 0) return c;
  const pad = 8;
  const x = Math.max(0, left - pad);
  const y = Math.max(0, top - pad);
  const w = Math.min(c.width - x, right - left + pad * 2);
  const h = Math.min(c.height - y, bottom - top + pad * 2);
  if (w === c.width && h === c.height) return c;
  const o = document.createElement("canvas");
  o.width = w;
  o.height = h;
  const octx = o.getContext("2d")!;
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, w, h);
  octx.drawImage(c, x, y, w, h, 0, 0, w, h);
  return o;
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

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.86));

/* ------------------------------- page model ------------------------------- */

type Col = { x0: number; x1: number };

function columns(items: Item[], pageW: number): Col[] {
  const mid = pageW / 2;
  const band = pageW * 0.04;
  const left = items.filter((i) => i.x + i.w <= mid + band);
  const right = items.filter((i) => i.x >= mid - band);
  const crossing = items.filter((i) => i.x < mid - band && i.x + i.w > mid + band);
  const two = left.length > 8 && right.length > 8 && crossing.length < items.length * 0.08;
  const bounds = (list: Item[]): Col => ({
    x0: Math.max(0, Math.min(...list.map((i) => i.x)) - 6),
    x1: Math.min(pageW, Math.max(...list.map((i) => i.x + i.w)) + 6),
  });
  if (two) return [bounds(left), bounds(right)];
  return items.length ? [bounds(items)] : [{ x0: 0, x1: pageW }];
}

type PageInfo = {
  n: number;
  role: "q" | "key" | "sol";
  w: number;
  h: number;
  items: Item[];
  cols: Col[];
  text: string;
};

async function readPage(doc: any, n: number): Promise<PageInfo> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: Item[] = (tc.items as any[])
    .filter((i) => typeof i.str === "string" && i.str.trim())
    .map((i) => ({
      str: i.str as string,
      x: i.transform[4] as number,
      y: Math.max(0, vp.height - (i.transform[5] as number) - (i.height || 10)),
      w: (i.width as number) || 4,
      h: (i.height as number) || 10,
    }));
  const text = items.map((i) => i.str).join(" ");
  const role: PageInfo["role"] = /answer\s*key/i.test(text)
    ? "key"
    : /hints?\s*&?\s*solutions?|text\s*solution|solutions?\s*$/i.test(text)
      ? "sol"
      : "q";
  return { n, role, w: vp.width, h: vp.height, items, cols: columns(items, vp.width), text };
}

/** Question markers inside a column, validated as an ascending sequence. */
function markers(p: PageInfo, col: Col) {
  const colItems = p.items.filter((i) => i.x >= col.x0 - 2 && i.x < col.x1);
  const leftEdge = col.x0 + (col.x1 - col.x0) * 0.22;
  const found: { no: number; y: number }[] = [];
  for (const it of colItems) {
    if (it.x > leftEdge) continue;
    const m = MARK_RE.exec(it.str.trim());
    if (!m) continue;
    const no = Number(m[1]);
    if (!no || no > 300) continue;
    found.push({ no, y: Math.max(0, it.y - 4) });
  }
  found.sort((a, b) => a.y - b.y);
  // keep the ascending chain only (drops stray numbers from formulas)
  const out: { no: number; y: number }[] = [];
  for (const f of found) {
    const last = out[out.length - 1];
    if (last && f.no <= last.no) continue;
    if (last && f.y - last.y < 10) continue;
    out.push(f);
  }
  return out;
}

/** Option markers inside one question box (used for image options). */
function optionBoxes(p: PageInfo, box: Box): Box[] {
  const inside = p.items.filter((i) => i.y >= box.y0 && i.y <= box.y1 && i.x >= box.x0 - 2 && i.x < box.x1);
  const marks = inside
    .filter((i) => OPT_RE.test(i.str.trim()))
    .map((i) => ({ x: i.x, y: i.y, label: toChoice(OPT_RE.exec(i.str.trim())![1]!) }))
    .filter((m) => m.label) as { x: number; y: number; label: Choice }[];
  if (marks.length < 2) return [];
  // keep first occurrence of A,B,C,D in reading order
  marks.sort((a, b) => a.y - b.y || a.x - b.x);
  const seen = new Map<Choice, { x: number; y: number }>();
  for (const m of marks) if (!seen.has(m.label)) seen.set(m.label, { x: m.x, y: m.y });
  const order: Choice[] = ["A", "B", "C", "D"];
  const picked = order.filter((c) => seen.has(c)).map((c) => ({ c, ...seen.get(c)! }));
  if (picked.length < 2) return [];
  const rows = [...new Set(picked.map((p2) => Math.round(p2.y / 6)))].sort((a, b) => a - b);
  const boxes: Box[] = [];
  for (let i = 0; i < picked.length; i++) {
    const cur = picked[i]!;
    const next = picked[i + 1];
    const sameRow = next && Math.abs(next.y - cur.y) < 8;
    boxes.push({
      x0: cur.x - 4,
      y0: cur.y - 4,
      x1: sameRow ? next!.x - 2 : box.x1,
      y1: sameRow ? cur.y + cur.y * 0 + rowHeight(cur.y, rows, box.y1) : next ? next.y - 2 : box.y1,
    });
  }
  return boxes.filter((b) => b.x1 - b.x0 > 16 && b.y1 - b.y0 > 8);
}

function rowHeight(y: number, rows: number[], bottom: number) {
  const idx = rows.findIndex((r) => Math.abs(r * 6 - y) < 10);
  const nextRow = rows[idx + 1];
  return nextRow != null ? nextRow * 6 - 2 : bottom;
}

/* -------------------------------- parsing -------------------------------- */

interface Parsed {
  questions: { no: number; img: Blob; sol: Blob | null; opts: Blob[]; kind: QKind }[];
  answers: Map<number, Choice>;
}

export async function parsePdf(file: Blob, onStep?: (s: string) => void): Promise<Parsed> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

  const infos: PageInfo[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    onStep?.(`Reading page ${n} of ${doc.numPages}…`);
    infos.push(await readPage(doc, n));
  }

  // ---- answer key pages ----
  const answers = new Map<number, Choice>();
  for (const p of infos.filter((x) => x.role === "key")) {
    KEY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = KEY_RE.exec(p.text))) {
      const c = toChoice(m[2]!);
      if (c) answers.set(Number(m[1]), c);
    }
  }

  // ---- question / solution regions ----
  const segs: Seg[] = [];
  const optSegs: { key: string; page: number; box: Box; i: number }[] = [];
  const pool = infos.filter((p) => p.role !== "key");

  for (let pi = 0; pi < pool.length; pi++) {
    const p = pool[pi]!;
    const kind = p.role === "sol" ? "s" : "q";
    for (let ci = 0; ci < p.cols.length; ci++) {
      const col = p.cols[ci]!;
      const mk = markers(p, col);
      if (!mk.length) continue;
      const colBottom = p.h * 0.95;
      for (let j = 0; j < mk.length; j++) {
        const cur = mk[j]!;
        const next = mk[j + 1];
        const key = `${kind}${cur.no}`;
        const box: Box = { x0: col.x0, y0: cur.y, x1: col.x1, y1: next ? next.y - 2 : colBottom };
        segs.push({ key, page: p.n, box });
        if (kind === "q") optionBoxes(p, box).forEach((b, i) => optSegs.push({ key, page: p.n, box: b, i }));
        // continuation: next column of the same page, else top of next page
        if (!next) {
          const nextCol = p.cols[ci + 1];
          if (nextCol) {
            const nm = markers(p, nextCol);
            const top = p.h * 0.05;
            const end = nm[0] ? nm[0]!.y - 2 : colBottom;
            if (end - top > 26) segs.push({ key, page: p.n, box: { x0: nextCol.x0, y0: top, x1: nextCol.x1, y1: end } });
          } else {
            const nx = pool[pi + 1];
            if (nx && nx.role === p.role) {
              const c0 = nx.cols[0]!;
              const nm = markers(nx, c0);
              const top = nx.h * 0.05;
              const end = nm[0] ? nm[0].y - 2 : nx.h * 0.95;
              if (end - top > 26) segs.push({ key, page: nx.n, box: { x0: c0.x0, y0: top, x1: c0.x1, y1: end } });
            }
          }
        }
      }
    }
  }

  // ---- render needed pages once, crop everything ----
  const parts = new Map<string, HTMLCanvasElement[]>();
  const opts = new Map<string, HTMLCanvasElement[]>();
  const pagesNeeded = [...new Set([...segs.map((s) => s.page), ...optSegs.map((s) => s.page)])].sort((a, b) => a - b);
  for (const n of pagesNeeded) {
    onStep?.(`Capturing questions from page ${n}…`);
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: SCALE });
    const c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c }).promise;
    const sc = (b: Box): Box => ({ x0: b.x0 * SCALE, y0: b.y0 * SCALE, x1: b.x1 * SCALE, y1: b.y1 * SCALE });
    for (const s of segs.filter((x) => x.page === n)) {
      const list = parts.get(s.key) ?? [];
      list.push(cropBox(c, sc(s.box)));
      parts.set(s.key, list);
    }
    for (const s of optSegs.filter((x) => x.page === n)) {
      const list = opts.get(s.key) ?? [];
      list[s.i] = cropBox(c, sc(s.box));
      opts.set(s.key, list);
    }
    c.width = c.height = 0;
  }

  const numbers = [...new Set(segs.filter((s) => s.key.startsWith("q")).map((s) => Number(s.key.slice(1))))].sort((a, b) => a - b);
  const questions: Parsed["questions"] = [];
  for (const no of numbers) {
    const qp = parts.get(`q${no}`);
    if (!qp?.length) continue;
    const sp = parts.get(`s${no}`);
    const op = (opts.get(`q${no}`) ?? []).filter(Boolean);
    questions.push({
      no,
      img: await toBlob(stack(qp)),
      sol: sp?.length ? await toBlob(stack(sp)) : null,
      opts: op.length >= 2 ? await Promise.all(op.map(toBlob)) : [],
      kind: op.length >= 2 ? "mcq" : "mcq",
    });
  }
  return { questions, answers };
}

/* ------------------------------- quiz CRUD ------------------------------- */

export async function createQuizFromPdfs(folderId: number, name: string, files: Blob[], onStep?: (s: string) => void) {
  const quizId = await db.quizzes.add({ folderId, name, wallpaperBlob: null, count: 0, createdAt: Date.now() });
  let no = 0;
  const rows: Question[] = [];
  for (const f of files) {
    const { questions, answers } = await parsePdf(f, onStep);
    for (const q of questions) {
      no++;
      rows.push({
        quizId,
        no,
        imgBlob: q.img,
        solBlob: q.sol,
        optBlobs: q.opts,
        kind: q.kind,
        answer: answers.get(q.no) ?? null,
        answerText: null,
      });
    }
  }
  if (rows.length) await db.questions.bulkAdd(rows);
  await db.quizzes.update(quizId, { count: rows.length });
  return { quizId, count: rows.length };
}

/** Photos from a book — one photo per question, answer filled manually. */
export async function createQuizFromImages(folderId: number, name: string, files: Blob[]) {
  const quizId = await db.quizzes.add({ folderId, name, wallpaperBlob: null, count: files.length, createdAt: Date.now() });
  await db.questions.bulkAdd(
    files.map((f, i) => ({ quizId, no: i + 1, imgBlob: f, solBlob: null, optBlobs: [], kind: "mcq" as QKind, answer: null, answerText: null })),
  );
  return { quizId, count: files.length };
}

export async function appendToQuiz(quizId: number, files: Blob[], kind: "pdf" | "image", onStep?: (s: string) => void) {
  const existing = await db.questions.where("quizId").equals(quizId).count();
  let no = existing;
  const rows: Question[] = [];
  if (kind === "image") {
    for (const f of files)
      rows.push({ quizId, no: ++no, imgBlob: f, solBlob: null, optBlobs: [], kind: "mcq", answer: null, answerText: null });
  } else {
    for (const f of files) {
      const { questions, answers } = await parsePdf(f, onStep);
      for (const q of questions)
        rows.push({
          quizId,
          no: ++no,
          imgBlob: q.img,
          solBlob: q.sol,
          optBlobs: q.opts,
          kind: q.kind,
          answer: answers.get(q.no) ?? null,
          answerText: null,
        });
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
