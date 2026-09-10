# Study Companion

Main tumko UI banaya is format banana Jo Mera plan uske according Khali reference ke liye de raha hun acche se design mein 10 credit ke andar banana hai ki jyada Na hoga use hisab se mehnat karna 



================================================================================

SUPER-MASTER PROMPT: ALL-IN-ALL OFFLINE PWA STUDY & LECTURE SUITE

================================================================================

CRITICAL DIRECTIVE FOR CODE GENERATION:

I have a STRICT BUDGET OF ONLY 10 CREDITS REMAINING. You MUST generate 100% complete, fully implemented, production-ready React + Tailwind CSS + Dexie.js code in a single output. DO NOT write incomplete snippets, "TODO" comments, placeholder functions, or truncated code. Every state, database call, gesture, and component MUST be fully coded.

--------------------------------------------------------------------------------

1. AI CODE MISTAKE PREVENTION RULES (STRICT SAFEGUARDS)

--------------------------------------------------------------------------------

To prevent app freezing, memory crashes, and logical bugs, strictly follow these technical rules:

1. NO BASE64 ENCODING: Store all videos (GBs) and high-res photos as binary Blobs in Dexie.js (IndexedDB). Base64 strings will crash the browser tab.

2. MEMORY CLEANUP: Always call `URL.revokeObjectURL(url)` in React `useEffect` cleanups when unmounting image, PDF, or video components.

3. NO IFRAME FOR PDF: Do NOT render PDFs inside HTML `<iframe>` or `<embed>`. Use `pdfjs-dist` rendered directly on an HTML5 `<canvas>` so it stays 100% offline and in-app.

4. GESTURE CONFLICT HANDLING: Separate single-tap (play/pause) and double-tap (10s seek) on the video player using a debounce/timer logic so double-tapping doesn't trigger play/pause.

5. RESUME PLAYBACK SAFETY: Throttle video `currentTime` saving to IndexedDB every 1 second. On load, seek to this time automatically—NEVER reset video to 0:00.

--------------------------------------------------------------------------------

2. CORE ARCHITECTURE & OFFLINE PWA SETUP

--------------------------------------------------------------------------------

- Tech Stack: React (Vite) + Tailwind CSS + Lucide Icons + Dexie.js + jsPDF + PDF.js.

- PWA & Installation Logic:

  * Complete `manifest.json` for "Add to Home Screen".

  * Capture the `beforeinstallprompt` browser event to provide a custom "Install App" button in the top bar.

  * Show an "App Installed / Standalone Mode" indicator when running as an installed PWA.

  * Full Service Worker (`sw.js`) caching all static assets and libraries for 100% offline functionality.

--------------------------------------------------------------------------------

3. UI/UX, NAVIGATION & FOLDER HIERARCHY

--------------------------------------------------------------------------------

- Dual Mode Header: Toggle switch at the top between "Notes & PDF Mode" and "Lecture Video Mode".

- Root & Sub-Folders:

  * Default root folders pre-created: "Physics", "Chemistry", and "Mathematics".

  * Unlimited sub-folders inside roots (e.g., Physics -> Chapter 1: Kinematics).

  * Direct Upload Routing: Upload buttons inside folders automatically attach new files/PDFs directly to that active chapter.

  * Direct In-App Opening: Files open instantly within the app without redirecting to system galleries or external PDF apps.

- Gestures: Long-press any folder, file, or video to open a bottom modal menu (Rename, Re-route, Edit, Delete with confirmation).

--------------------------------------------------------------------------------

4. MODULE 1: IMAGE CAPTURE, CUSTOMIZATION & B&W DOCUMENT FILTER

--------------------------------------------------------------------------------

- Multi-Source Import: Support multi-photo upload from Gallery AND direct live Camera capture.

- Image Editor (Canvas-Based):

  * Crop & Aspect Ratio: Custom drag handles to adjust image length, width, and dimensions, plus 90° rotation.

  * Automatic B&W Document Filter (Thresholding):

    Render image to Canvas, loop pixel array, calculate Luminance ($L = 0.299R + 0.587G + 0.114B$). Provide an adjustable threshold slider (0-255) so users can remove background shadows/colors completely, leaving ONLY pure dark handwritten/printed question text on a clean white background.

- Question Leveling & Tagging:

  * Difficulty Badges: Level 1, Level 2, Hard Question, Exam Special.

  * Completion Tick: Checkbox toggle to mark individual questions/photos as "Completed".

--------------------------------------------------------------------------------

5. MODULE 2: PDF ENGINE, IN-APP CANVAS VIEWER & ANNOTATOR

--------------------------------------------------------------------------------

- Compilation & Editing:

  * Compress processed images and compile them into a named PDF.

  * Append/Edit Feature: Open an existing PDF and insert newly captured images/pages directly into it.

- In-App Viewer & Highlighter:

  * Canvas-based rendering (`pdfjs-dist`) with full-screen distraction-free reader mode.

  * Interactive Highlighter: Semi-transparent yellow highlight tool allowing students to drag over text points (save highlight overlay coordinates in Dexie.js).

- Mastery Analytics:

  * Calculate completion percentage based on checked questions within the PDF/chapter.

  * Display a visual badge (e.g., "80% Mastered") on folder cards.

--------------------------------------------------------------------------------

6. MODULE 3: LECTURE VIDEO PLAYER & SPLIT PDF ATTACHMENT

--------------------------------------------------------------------------------

- Video Management: Upload local video files of any size (MBs to GBs) into specific chapter folders. Auto-generate a first-frame thumbnail preview on video cards.

- Smart Player Controls:

  * Auto-Resume: Saves exact timestamp continuously and auto-seeks when re-opened.

  * Double-Tap Skip: Double-tap right side = +10s forward; Double-tap left side = -10s backward.

  * Speed Control: 0.5x, 0.75x, 1.0x, 1.25x, 1.5x, 2.0x.

  * History & Completion: "Recently Watched" list + green tick badge when playback reaches >= 95%.

  * Full-Screen Stability: Full-screen video mode that maintains phone orientation and fills screen without clipping.

- Split-Screen Attached PDF Engine:

  * Option to attach a PDF document to a video lecture.

  * Portrait Mode: Video on top 50%, scrollable PDF preview on bottom 50%.

  * Landscape Full-Screen Mode: Floating 3-dot overlay menu button that slides in a semi-transparent side drawer showing the attached PDF notes WITHOUT pausing or interrupting video playback.

--------------------------------------------------------------------------------

7. DEXIE.JS DATABASE SCHEMA

--------------------------------------------------------------------------------

Implement these Dexie tables:

- `folders`: `id, name, parentId, createdAt`

- `images`: `id, folderId, blob, tags, difficulty, isCompleted, createdAt`

- `pdfs`: `id, folderId, name, pdfBlob, completedPercentage, annotations, createdAt`

- `videos`: `id, folderId, name, videoBlob, thumbnailBlob, attachedPdfId, lastPosition, isCompleted, createdAt`

- `history`: `id, videoId, watchedAt`

--------------------------------------------------------------------------------

8. REQUIRED OUTPUT FORMAT

--------------------------------------------------------------------------------

Output fully coded, production-ready React components:

1. `db.js` (Dexie DB configuration and CRUD helper functions).

2. `App.jsx` (Main shell, Mode Switcher, PWA installer, Breadcrumbs, Folder navigation).

3. `ImageEditor.jsx` (Canvas cropping, B&W threshold filter with slider, tagging).

4. `PdfViewer.jsx` (Canvas-based PDF reader, full-screen toggle, highlighter overlay).

5. `VideoPlayer.jsx` (Custom player with auto-resume, double-tap 10s seek, speed controls, and attached PDF side-drawer).

================================================================================

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://lecturehub-pro.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/dceba327-d62b-45cf-b628-76cf3f8836cf).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
