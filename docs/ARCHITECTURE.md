# HirePilot — Architecture & Build Plan

## 1. The hard problems (read this first)

| Area | Constraint | How we handle it |
|---|---|---|
| **MV3 service worker** | Chrome kills the background worker after ~30s idle. A long agent loop running there dies mid-task. | The agent loop runs in the **side panel** (a normal page that lives while it's open). "You stay in control" already means the panel is open. Background worker stays thin: panel wiring, later Gmail OAuth. |
| **Reading pages** | Content can only be read with host permission. `activeTab` is temporary and resets on navigation, which breaks multi-step work. | Request site access the first time you ask HirePilot to read a page (optional host permission), not at install. Pages are only read when you ask. |
| **Restricted pages** | `chrome://`, Chrome Web Store, built-in PDF viewer, and some sandboxed iframes cannot be scripted. | Detect and say so plainly. PDFs: upload the file instead (later slice). |
| **React / dynamic forms** | Setting `input.value = x` does not update React state; the form "forgets" it on submit. Custom dropdowns (react-select, Workday) aren't `<select>`s. | Use the native value setter + dispatch `input`/`change`/`blur`. Per-ATS adapters (Greenhouse, Lever, Ashby first, Workday last) before any generic AI-driven clicking. Re-read the field after setting it to **verify**. |
| **Iframes** | Many company career pages embed Greenhouse/Lever in an iframe on another origin. | Inject with `allFrames` + host permission for the ATS origin. |
| **File upload** | Extensions can't read files from disk by path. | Store resumes in IndexedDB as Blobs, build a `File`, assign via `DataTransfer` to the `<input type=file>`, fire `change`, verify the filename shows. Fails on some drag-and-drop widgets → fall back to "please attach manually". |
| **Voice** | Web Speech API sends audio to Google; the mic permission prompt can't appear inside a side panel. | One-time "grant microphone" tab, then the panel can use it. Later: Whisper-style transcription via the server if accuracy/privacy matters. |
| **LinkedIn / X** | ToS forbid automation; class names are obfuscated and change often; bulk actions risk account restriction. | Only act on the page you have open, one user-triggered action at a time. Drafting is free; liking/saving/sending needs your click-to-confirm. No scraping loops, no CAPTCHA bypass. |
| **Gmail** | Compose URL needs no API but can't attach files. Gmail API needs OAuth (`gmail.compose` is a sensitive scope). | Phase 4a: compose URL. Phase 4b: `chrome.identity` + Gmail API drafts (fine for personal use in "testing" mode). |
| **Prompt injection** | Job descriptions are untrusted text and can contain "ignore previous instructions…". | Page text is always wrapped as data. **Safety is enforced in code, not the prompt**: the model can only call registered tools; any externally visible tool (submit, send, post, DM) requires a confirmation click in the UI that the model cannot bypass. |
| **API keys** | Anything in the extension bundle is public. | Keys live only in the server. The extension holds a token for *your* server, never a provider key. |
| **Cost** | Sending whole pages to a big model on every message adds up. | Deterministic extraction first (schema.org `JobPosting` JSON-LD, ATS DOM). Truncate page text. Cheap model for extraction/classification, stronger one only for writing. |

## 2. Modules

```
┌──────────────── Chrome extension ────────────────┐        ┌──── Local server (Node) ────┐
│ Side panel UI (React)                            │        │ HTTP API (Hono, 127.0.0.1)  │
│   └─ Agent orchestration (later: plan/act loop)  │ HTTPS  │   ├─ Auth (bearer token)    │
│        ├─ Tool registry (typed, zod-validated)   │ ─────▶ │   ├─ Prompt builder         │
│        └─ Confirmation gate (human approval)     │        │   ├─ LLM provider interface │
│ Browser layer: page snapshot, form fill, tabs    │        │   └─ Doc generation (PDF)   │
│ Storage: profile, resumes, jobs (local)          │        └─────────────────────────────┘
│ Background worker: panel wiring, OAuth           │
└──────────────────────────────────────────────────┘
          packages/shared: zod schemas = the API contract between the two
```

Rules that keep this sane:
- **Browser layer is deterministic.** It never calls the LLM. It returns structured data (snapshot, detected fields) and verified results ("set field X, read back Y").
- **The LLM decides, tools act.** The model proposes tool calls; the orchestrator validates them with zod, checks the tool's risk level, and asks you before anything externally visible.
- **Verified facts vs suggestions.** Profile entries you typed/confirmed are `verified`. AI-drafted text is `suggested` until you accept it. Only verified facts are given to the model as "facts about the user".

## 3. Folder structure

```
hirepilot/
├── packages/shared/     # zod schemas + types shared by extension and server
├── server/              # local Node server: LLM calls, (later) PDF generation
│   └── src/
│       ├── llm/         # LLMProvider interface + implementations
│       ├── agent/       # prompt building (later: tool schemas for the model)
│       ├── app.ts       # routes (testable without a network)
│       └── index.ts     # starts the server
├── extension/
│   ├── public/manifest.json
│   ├── sidepanel.html
│   └── src/
│       ├── sidepanel/   # React UI
│       ├── browser/     # page snapshot, (later) forms, tabs, uploads
│       ├── lib/         # API client, settings storage
│       └── background/  # service worker
└── docs/
```
Folders for `profile/`, `jobs/`, `agent/`, `tools/` get added in the slice that needs them — not before.

## 4. Local vs backend

| Works entirely in the browser | Needs the server / external API |
|---|---|
| Page reading, JSON-LD extraction | Any LLM call (key must stay hidden) |
| Form detection & filling, resume attach | Tailored resume/cover letter writing |
| Profile, resumes, job tracker (IndexedDB / storage) | PDF rendering (could be client-side later) |
| Voice capture (Web Speech, via Google) | Gmail API (OAuth is browser-side, but SaaS needs a backend) |
| Gmail compose-URL drafts | SaaS: user accounts, billing, quotas, sync |

For personal use the "server" is a process on your laptop. For SaaS it becomes a hosted service with user auth — the extension code barely changes because it only talks to `packages/shared` contracts.

## 5. Slice plan (each one is testable on a real site)

1. **Slice 1 — Talk to the page** *(done)*: side panel chat → local server → LLM; "include this page" reads the current tab (with JSON-LD JobPosting detection).
2. **Slice 2 — Profile & resumes** *(done)*: verified profile editor, multiple resume upload (IndexedDB), reusable Q&A answers; profile sent to the model as verified facts.
3. **Slice 3 — Voice** *(done)*: push-to-talk with Web Speech API + mic-permission page.
4. **Slice 4 — Job understanding**: structured JD extraction + fit analysis against verified profile; save job to tracker.
5. **Slice 5 — Autofill (the MVP)**: detect form fields on Greenhouse/Lever/Ashby, map from profile deterministically, LLM only for unmapped/custom questions, attach resume, show a review table, **never click submit**.
6. Then: tailored resume/cover letter + PDF, agent loop with tools across tabs, Gmail, X/LinkedIn drafting, tracker queries.

**Smallest real-world MVP = end of Slice 5**: open a Greenhouse job, say "fill this from my profile and stop before submitting", review the filled form, click submit yourself.
