import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const StudyApp = lazy(() => import("@/components/study/StudyApp"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Study Hub — Offline Notes, PDF & Lecture Suite" },
      { name: "description", content: "Offline study app: capture question photos, build PDFs, highlight notes and watch lecture videos with attached notes." },
      { property: "og:title", content: "Study Hub — Offline Notes, PDF & Lecture Suite" },
      { property: "og:description", content: "Capture, organise and master your Physics, Chemistry and Maths notes and lectures — fully offline." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-secondary border-t-primary" />
    </div>
  );
}

function Index() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <StudyApp />
      </Suspense>
    </ClientOnly>
  );
}
