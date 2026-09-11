import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  Check,
  X,
  Flag,
  Timer,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  FileText,
  Wallpaper,
  Trash2,
  History,
  Play,
  ListChecks,
  Eye,
} from "lucide-react";
import { db, type Attempt, type Choice, type Question, type Response } from "@/lib/db";
import { appendToQuiz } from "@/lib/quiz";
import { BlobImage, Btn, Modal, Ring, useObjectUrl } from "./ui";

const CHOICES: Choice[] = ["A", "B", "C", "D"];
const clock = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

export function QuizRunner({ quizId, onClose }: { quizId: number; onClose: () => void }) {
  const quiz = useLiveQuery(() => db.quizzes.get(quizId), [quizId]);
  const questions = useLiveQuery(() => db.questions.where("quizId").equals(quizId).sortBy("no"), [quizId]) ?? [];
  const attempts = useLiveQuery(() => db.attempts.where("quizId").equals(quizId).reverse().sortBy("finishedAt"), [quizId]) ?? [];
  const wallpaper = useObjectUrl(quiz?.wallpaperBlob);

  const [view, setView] = useState<"home" | "run" | "result">("home");
  const [keyOpen, setKeyOpen] = useState(false);
  const [mins, setMins] = useState(15);
  const [idx, setIdx] = useState(0);
  const [chosen, setChosen] = useState<Record<number, Choice>>({});
  const [marked, setMarked] = useState<number[]>([]);
  const [left, setLeft] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [palette, setPalette] = useState(false);
  const [result, setResult] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const wallRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const picRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<() => void>(() => {});

  const missing = questions.filter((q) => !q.answer).length;

  // ticking clock while attempting
  useEffect(() => {
    if (view !== "run") return;
    const id = window.setInterval(() => {
      setElapsed((e) => e + 1);
      setLeft((v) => {
        if (mins === 0) return 0;
        if (v <= 1) {
          submitRef.current();
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [view, mins]);

  const start = () => {
    setChosen({});
    setMarked([]);
    setIdx(0);
    setElapsed(0);
    setLeft(mins * 60);
    setResult(null);
    setView("run");
  };

  const submit = async () => {
    const responses: Response[] = questions.map((q) => ({
      no: q.no,
      chosen: chosen[q.no] ?? null,
      answer: q.answer,
      marked: marked.includes(q.no),
    }));
    const correct = responses.filter((r) => r.answer && r.chosen === r.answer).length;
    const wrong = responses.filter((r) => r.answer && r.chosen && r.chosen !== r.answer).length;
    const skipped = responses.filter((r) => !r.chosen).length;
    const attempt: Attempt = {
      quizId,
      quizName: quiz?.name ?? "Quiz",
      finishedAt: Date.now(),
      timeSec: elapsed,
      total: questions.length,
      correct,
      wrong,
      skipped,
      responses,
    };
    const id = await db.attempts.add(attempt);
    setResult({ ...attempt, id });
    setConfirmSubmit(false);
    setView("result");
  };
  submitRef.current = () => void submit();

  const setAnswer = (q: Question, c: Choice) => db.questions.update(q.id!, { answer: q.answer === c ? null : c });

  const addFiles = async (files: FileList | null, kind: "pdf" | "image") => {
    if (!files?.length) return;
    setBusy(kind === "pdf" ? "Reading PDF…" : "Adding photos…");
    await appendToQuiz(quizId, Array.from(files), kind, (s) => setBusy(s));
    setBusy(null);
  };

  if (!quiz) return null;

  /* ------------------------------- HOME ------------------------------- */
  if (view === "home")
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-background">
        <header className="flex items-center gap-2 border-b bg-card px-2 py-2">
          <button onClick={onClose} className="rounded-full p-2 hover:bg-secondary" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold">{quiz.name}</h2>
            <p className="text-[11px] text-muted-foreground">{questions.length} questions · {attempts.length} attempts</p>
          </div>
          <button onClick={() => wallRef.current?.click()} className="rounded-full p-2 hover:bg-secondary" aria-label="Change wallpaper">
            <Wallpaper className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-28">
          {busy && <div className="rounded-2xl bg-accent px-4 py-2 text-xs font-bold text-accent-foreground">{busy}</div>}

          <div className="relative overflow-hidden rounded-3xl bg-card p-5 shadow-card">
            {wallpaper && <img src={wallpaper} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />}
            <div className="relative">
              <p className="text-xs font-bold uppercase tracking-wider text-primary">Quiz Mode</p>
              <h3 className="mt-1 text-xl font-extrabold">{quiz.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {questions.length} captured questions · {questions.filter((q) => q.solBlob).length} with solutions
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[0, 10, 15, 30, 45, 60].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMins(m)}
                    className={`rounded-full px-3 py-1 text-xs font-bold ${mins === m ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
                  >
                    {m === 0 ? "No limit" : `${m}m`}
                  </button>
                ))}
              </div>
              <Btn className="mt-4 w-full" onClick={start} disabled={!questions.length}>
                <Play className="h-4 w-4" /> Start Test
              </Btn>
            </div>
          </div>

          {missing > 0 && (
            <button onClick={() => setKeyOpen(true)} className="press w-full rounded-2xl bg-destructive/10 p-3 text-left">
              <p className="text-sm font-bold text-destructive">{missing} answers missing</p>
              <p className="text-[11px] text-muted-foreground">Tap to fill the answer key manually so scoring stays perfect.</p>
            </button>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Btn variant="secondary" onClick={() => pdfRef.current?.click()}>
              <FileText className="h-4 w-4" /> PDF
            </Btn>
            <Btn variant="secondary" onClick={() => picRef.current?.click()}>
              <ImagePlus className="h-4 w-4" /> Photos
            </Btn>
            <Btn variant="secondary" onClick={() => setKeyOpen(true)}>
              <ListChecks className="h-4 w-4" /> Key
            </Btn>
          </div>

          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-bold">
              <History className="h-4 w-4 text-primary" /> Result History
            </h3>
            {attempts.length === 0 && <p className="text-xs text-muted-foreground">No attempts yet — your scores will appear here.</p>}
            {attempts.map((a) => {
              const pct = a.total ? Math.round((a.correct / a.total) * 100) : 0;
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    setResult(a);
                    setView("result");
                  }}
                  className="press flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left shadow-card"
                >
                  <div className="relative">
                    <Ring pct={pct} size={44} stroke={5} />
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-extrabold">{pct}%</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">
                      {a.correct}/{a.total} correct
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(a.finishedAt).toLocaleString()} · {clock(a.timeSec)}
                    </p>
                  </div>
                  <Eye className="h-4 w-4 text-muted-foreground" />
                </button>
              );
            })}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-bold">Captured Questions</h3>
            <div className="grid grid-cols-2 gap-2">
              {questions.map((q) => (
                <div key={q.id} className="overflow-hidden rounded-xl bg-card shadow-card">
                  <BlobImage blob={q.imgBlob} className="max-h-40 w-full object-cover object-top" alt={`Question ${q.no}`} />
                  <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold">
                    <span>Q{q.no}</span>
                    <span className={q.answer ? "text-success" : "text-destructive"}>{q.answer ?? "no key"}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <input ref={wallRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && db.quizzes.update(quizId, { wallpaperBlob: e.target.files[0]! })} />
        <input ref={pdfRef} type="file" accept="application/pdf" multiple hidden onChange={(e) => addFiles(e.target.files, "pdf")} />
        <input ref={picRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files, "image")} />

        <Modal open={keyOpen} onClose={() => setKeyOpen(false)} title="Answer key">
          <div className="max-h-[55vh] space-y-1.5 overflow-y-auto">
            {questions.map((q) => (
              <div key={q.id} className="flex items-center gap-2">
                <span className="w-9 shrink-0 text-xs font-bold">Q{q.no}</span>
                {CHOICES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setAnswer(q, c)}
                    className={`h-8 flex-1 rounded-xl text-xs font-bold ${q.answer === c ? "bg-success text-success-foreground" : "bg-secondary"}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <Btn className="mt-4 w-full" onClick={() => setKeyOpen(false)}>
            Done
          </Btn>
        </Modal>
      </div>
    );

  /* -------------------------------- RUN -------------------------------- */
  if (view === "run") {
    const q = questions[idx];
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-background">
        {wallpaper && <img src={wallpaper} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-10" />}
        <header className="relative flex items-center gap-2 border-b bg-card/95 px-2 py-2 backdrop-blur">
          <button onClick={() => setConfirmSubmit(true)} className="rounded-full p-2 hover:bg-secondary" aria-label="Finish">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold">
              Question {idx + 1} / {questions.length}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {Object.keys(chosen).length} answered · {marked.length} for review
            </p>
          </div>
          <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold tabular-nums ${mins > 0 && left < 60 ? "bg-destructive/15 text-destructive" : "bg-secondary"}`}>
            <Timer className="h-3.5 w-3.5" /> {mins === 0 ? clock(elapsed) : clock(left)}
          </span>
          <button onClick={() => setPalette(true)} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-bold">
            Grid
          </button>
        </header>

        <div className="relative flex-1 overflow-y-auto p-3">
          {q && <BlobImage blob={q.imgBlob} className="mx-auto w-full max-w-[900px] rounded-2xl bg-card shadow-card" alt={`Question ${q.no}`} />}
        </div>

        <div className="relative border-t bg-card px-3 pb-3 pt-2 safe-bottom">
          <div className="grid grid-cols-4 gap-2">
            {CHOICES.map((c) => {
              const on = q && chosen[q.no] === c;
              return (
                <button
                  key={c}
                  onClick={() => q && setChosen((s) => (s[q.no] === c ? Object.fromEntries(Object.entries(s).filter(([k]) => k !== String(q.no))) as Record<number, Choice> : { ...s, [q.no]: c }))}
                  className={`rounded-2xl py-3 text-base font-extrabold ${on ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Btn variant="secondary" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>
              <ChevronLeft className="h-4 w-4" />
            </Btn>
            <Btn
              variant="secondary"
              className="flex-1"
              onClick={() => q && setMarked((m) => (m.includes(q.no) ? m.filter((x) => x !== q.no) : [...m, q.no]))}
            >
              <Flag className={`h-4 w-4 ${q && marked.includes(q.no) ? "text-tint-purple" : ""}`} /> Review
            </Btn>
            {idx === questions.length - 1 ? (
              <Btn variant="success" className="flex-1" onClick={() => setConfirmSubmit(true)}>
                <Check className="h-4 w-4" /> Submit
              </Btn>
            ) : (
              <Btn className="flex-1" onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))}>
                Next <ChevronRight className="h-4 w-4" />
              </Btn>
            )}
          </div>
        </div>

        {palette && (
          <div className="absolute inset-0 z-50 flex items-end bg-overlay" onClick={() => setPalette(false)}>
            <div className="w-full rounded-t-3xl bg-card p-4 safe-bottom" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold">Question palette</h3>
                <button onClick={() => setPalette(false)} className="rounded-full bg-secondary p-1.5">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid max-h-[45vh] grid-cols-6 gap-2 overflow-y-auto">
                {questions.map((x, i) => {
                  const cls = marked.includes(x.no)
                    ? "bg-tint-purple text-primary-foreground"
                    : chosen[x.no]
                      ? "bg-success text-success-foreground"
                      : "bg-secondary";
                  return (
                    <button
                      key={x.id}
                      onClick={() => {
                        setIdx(i);
                        setPalette(false);
                      }}
                      className={`h-10 rounded-xl text-xs font-bold ${cls} ${i === idx ? "ring-2 ring-ring" : ""}`}
                    >
                      {x.no}
                    </button>
                  );
                })}
              </div>
              <Btn variant="success" className="mt-3 w-full" onClick={() => setConfirmSubmit(true)}>
                <Check className="h-4 w-4" /> Submit test
              </Btn>
            </div>
          </div>
        )}

        <Modal open={confirmSubmit} onClose={() => setConfirmSubmit(false)} title="Submit test?">
          <p className="text-sm text-muted-foreground">
            {Object.keys(chosen).length} answered, {questions.length - Object.keys(chosen).length} left.
            {missing > 0 && ` ${missing} question(s) have no answer key — fill it to score them.`}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setConfirmSubmit(false)}>
              Keep going
            </Btn>
            <Btn variant="success" onClick={submit}>
              Submit
            </Btn>
          </div>
        </Modal>
      </div>
    );
  }

  /* ------------------------------- RESULT ------------------------------- */
  return <ResultView attempt={result!} questions={questions} onBack={() => setView("home")} onRetry={start} />;
}

function ResultView({
  attempt,
  questions,
  onBack,
  onRetry,
}: {
  attempt: Attempt;
  questions: Question[];
  onBack: () => void;
  onRetry: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "correct" | "wrong" | "skipped">("all");
  const [open, setOpen] = useState<number[]>([]);
  const pct = attempt.total ? Math.round((attempt.correct / attempt.total) * 100) : 0;
  const byNo = useMemo(() => new Map(questions.map((q) => [q.no, q])), [questions]);
  const rows = attempt.responses.filter((r) =>
    filter === "all"
      ? true
      : filter === "correct"
        ? r.answer && r.chosen === r.answer
        : filter === "wrong"
          ? r.answer && r.chosen && r.chosen !== r.answer
          : !r.chosen,
  );

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <header className="flex items-center gap-2 border-b bg-card px-2 py-2">
        <button onClick={onBack} className="rounded-full p-2 hover:bg-secondary" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="flex-1 truncate text-sm font-bold">Result · {attempt.quizName}</h2>
        <Btn className="!px-3 !py-1.5" onClick={onRetry}>
          Retry
        </Btn>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-24">
        <div className="flex items-center gap-4 rounded-3xl bg-card p-5 shadow-card">
          <div className="relative">
            <Ring pct={pct} size={92} stroke={9} />
            <span className="absolute inset-0 flex items-center justify-center text-lg font-extrabold">{pct}%</span>
          </div>
          <div className="text-sm">
            <p className="text-base font-extrabold">
              {attempt.correct} / {attempt.total} correct
            </p>
            <p className="text-xs text-success">Correct {attempt.correct}</p>
            <p className="text-xs text-destructive">Wrong {attempt.wrong}</p>
            <p className="text-xs text-muted-foreground">Skipped {attempt.skipped} · Time {clock(attempt.timeSec)}</p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5 text-xs font-bold">
          {(["all", "correct", "wrong", "skipped"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full py-2 capitalize ${filter === f ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
              {f}
            </button>
          ))}
        </div>

        {rows.map((r) => {
          const q = byNo.get(r.no);
          const ok = r.answer && r.chosen === r.answer;
          const shown = open.includes(r.no);
          return (
            <div key={r.no} className="overflow-hidden rounded-2xl bg-card shadow-card">
              <div className="flex items-center justify-between px-3 py-2 text-xs font-bold">
                <span>Q{r.no}</span>
                <span className={ok ? "text-success" : r.chosen ? "text-destructive" : "text-muted-foreground"}>
                  You: {r.chosen ?? "—"} · Correct: {r.answer ?? "not set"}
                </span>
              </div>
              {q && <BlobImage blob={q.imgBlob} className="w-full" alt={`Question ${r.no}`} />}
              {q?.solBlob && (
                <>
                  <button
                    onClick={() => setOpen((o) => (o.includes(r.no) ? o.filter((x) => x !== r.no) : [...o, r.no]))}
                    className="w-full bg-secondary py-2 text-xs font-bold text-primary"
                  >
                    {shown ? "Hide solution" : "Show solution"}
                  </button>
                  {shown && <BlobImage blob={q.solBlob} className="w-full" alt={`Solution ${r.no}`} />}
                </>
              )}
              {!q?.solBlob && <p className="bg-secondary py-2 text-center text-[11px] text-muted-foreground">No solution in this paper</p>}
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-center text-xs text-muted-foreground">Nothing in this filter.</p>}
      </div>
    </div>
  );
}

export function QuizDeleteButton({ onDelete }: { onDelete: () => void }) {
  return (
    <button onClick={onDelete} className="rounded-full p-2 text-destructive hover:bg-secondary" aria-label="Delete quiz">
      <Trash2 className="h-5 w-5" />
    </button>
  );
}
