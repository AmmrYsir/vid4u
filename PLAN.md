# vid4u — v1 implementation plan

**Status:** implemented — see [README.md](README.md) for setup, API and deployment. The app is backed by a Fastify/yt-dlp service; 44 tests pass, and real public Facebook, Instagram, YouTube and TikTok links were verified end-to-end.
**Baseline verified:** `pnpm build` passes on the current tree (Vue 3.5, Vite 8.3, TypeScript 6, pnpm 12, Node 26).

---

## 1. Where the project stands

Today vid4u is a single-page Vue landing screen with a polished, responsive UI and **no download functionality**:

- `src/App.vue` holds the whole page plus the form state.
- `prepareLink()` only validates that the input is an `http(s)` URL. It never contacts a server.
- The “result panel” is fake: hard-coded `00:24`, gradient thumbnail, “link ready”, and a static `<select>` of formats.
- Platform detection uses substring matching (`url.includes('youtube')`), so hosts like `notyoutube.com` would pass.
- There is no router, store, API client, backend, tests, or environment configuration.
- `dist/` is a static build only; it cannot download from Facebook/Instagram by itself.

The UI is good enough to keep. The plan below preserves the design and replaces the placeholder behaviour with a real pipeline.

---

## 2. The unavoidable constraint: a backend is required

A browser-only Vue app **cannot** reliably download Facebook/Instagram videos. This is not a missing library; it is how the platforms work:

| Blocker | What happens in a pure frontend |
| --- | --- |
| CORS | `fetch()` to Facebook/Instagram HTML or CDN URLs is blocked; the browser will not expose the response. |
| Signed media URLs | CDN URLs are short-lived and usually require a matching `User-Agent`/`Referer`; a plain `<a download>` often gets 403. |
| Login-gated content | Instagram serves “login required” for most Reels/feed videos without a session cookie. |
| Extraction | Facebook/Instagram pages need HTML/GraphQL parsing and regular updates; this cannot live in the bundle safely. |
| Merging/transcoding | 1080p often ships as separate video+audio streams; producing one MP4 (or MP3) needs FFmpeg. |

**Options considered**

| Option | How it works | Verdict |
| --- | --- | --- |
| **A. Self-hosted Node API + yt-dlp** | Fastify service shells out to `yt-dlp`, streams the finished file back | **Recommended.** Supports thousands of sites, actively maintained, handles FB/IG/YouTube/TikTok, full control over errors and limits. |
| B. Third-party downloader API (cobalt, RapidAPI, etc.) | Frontend calls someone else’s API | No backend to run, but rate limits, outages, keys, unclear retention, and the same IG login problem. Not suitable for a dependable product. |
| C. Browser-only | Third-party CORS proxy + direct CDN links | Fragile, unsafe (proxies see every URL), and fails for most FB/IG content. **Not viable.** |

The rest of this plan assumes **Option A**.

---

## 3. Recommended architecture

```
┌──────────────────────────────┐
│ Browser (Vue 3 + Vite)       │
│  DownloadCard / ResultPanel  │
│  api.ts + useDownloader.ts   │
└──────────────┬───────────────┘
               │ same-origin /api (Vite proxy in dev, Fastify static in prod)
┌──────────────▼───────────────┐
│ Fastify API (Node 22+)       │
│  /api/resolve                │  yt-dlp --dump-single-json
│  /api/jobs + /file           │  queue → download → FFmpeg → temp file
│  /api/health                 │  binary/version checks
│  static dist/ (production)   │
└──────────────┬───────────────┘
               │ child_process.spawn (argument array, never a shell string)
┌──────────────▼───────────────┐
│ yt-dlp binary (pinned)       │
│ FFmpeg (static or system)    │
│ optional cookies.txt         │
│ temp dir, deleted after job  │
└──────────────────────────────┘
```

**Why these choices**

- **One repo, two processes.** Keep the Vue app at the root; add `server/`. Avoid a disruptive monorepo migration.
- **Fastify 5** is small, fast, TypeScript-friendly, and has good static/rate-limit plugins.
- **yt-dlp CLI, not an npm wrapper.** npm wrappers pin old binaries; yt-dlp ships fixes weekly and Facebook/Instagram break often. We download and verify a pinned release, with a one-command updater.
- **Presets, not raw format lists.** Users pick “MP4 · 1080p” or “MP3 · Audio”; the server maps that to a yt-dlp selector. This hides dozens of video-only/audio-only streams and prevents invalid combinations.
- **Job API + polling.** Merging a 1080p video can take tens of seconds. A job id lets the UI show real progress and keeps downloads resumable from the UI’s point of view. Polling every second is simpler and more proxy-safe than SSE/WebSockets.
- **No database.** Jobs live in memory and expire; temp files are deleted. A DB adds nothing for v1.
- **No router.** The page stays a one-pager; privacy/legal copy opens in a native `<dialog>`.

---

## 4. Proposed repository layout

```text
vid4u/
├─ index.html
├─ package.json                  # web + server scripts (one install)
├─ vite.config.ts                # /api proxy → 127.0.0.1:8787
├─ PLAN.md
├─ .env.example
├─ scripts/
│  ├─ fetch-ytdlp.mjs            # download + SHA-256 verify pinned binary → server/bin/
│  └─ smoke.mjs                  # optional real-link smoke test
├─ server/
│  ├─ bin/                       # gitignored: yt-dlp(.exe)
│  ├─ src/
│  │  ├─ index.ts                # bootstrap + graceful shutdown
│  │  ├─ app.ts                  # Fastify factory (injectable deps for tests)
│  │  ├─ config.ts               # env parsing/validation
│  │  ├─ routes/
│  │  │  ├─ resolve.ts
│  │  │  ├─ jobs.ts
│  │  │  └─ health.ts
│  │  ├─ services/
│  │  │  ├─ ytdlp.ts             # spawn, metadata, version, error mapping
│  │  │  ├─ jobs.ts              # queue, progress, temp files, cleanup
│  │  │  ├─ presets.ts           # format selectors and available heights
│  │  │  ├─ security.ts          # URL/host validation, HMAC tokens
│  │  │  └─ errors.ts            # AppError + user-facing messages
│  │  └─ types.ts
│  └─ tsconfig.json
└─ src/
   ├─ App.vue                    # page shell + static sections
   ├─ main.ts
   ├─ style.css                  # existing design tokens + new state styles
   ├─ components/
   │  ├─ DownloadCard.vue        # form + result, owns the state machine
   │  ├─ ResultPanel.vue         # metadata, presets, progress, error
   │  └─ LegalDialog.vue         # privacy + acceptable-use copy
   ├─ composables/
   │  └─ useDownloader.ts        # resolve → start job → poll → save
   ├─ lib/
   │  ├─ api.ts                  # typed fetch client + ApiError
   │  └─ platforms.ts            # hostname-based detection/labels
   └─ types/api.ts               # shared request/response types
```

The static “How it works”, “Supported sites”, header, hero copy, and footer can stay in `App.vue` for v1; only the interactive card is extracted.

---

## 5. Backend API contract

All responses are JSON except `/file`. Errors use one envelope:

```json
{ "error": { "code": "login_required", "message": "This video needs a logged-in session.", "hint": "…" } }
```

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | API + yt-dlp + FFmpeg availability/version; used by smoke tests and deployment checks |
| `POST` | `/api/resolve` | Validate URL, extract metadata, return available presets + short-lived token |
| `POST` | `/api/jobs` | Start a download for `{ token, presetId }` |
| `GET` | `/api/jobs/:id` | Poll status/progress/stage |
| `GET` | `/api/jobs/:id/file` | Stream the finished file with a safe filename; 409 until ready |
| `DELETE` | `/api/jobs/:id` | Cancel and clean up |

### 5.1 Resolve

`POST /api/resolve` → `{ "url": "https://www.facebook.com/reel/…" }`

```json
{
  "video": {
    "platform": "facebook",
    "platformLabel": "Facebook",
    "id": "123456789",
    "title": "Video title",
    "uploader": "Page or account name",
    "duration": 24,
    "thumbnail": "https://…",
    "webpageUrl": "https://www.facebook.com/reel/…"
  },
  "presets": [
    { "id": "video:720", "label": "MP4 · 720p", "kind": "video", "height": 720, "ext": "mp4" },
    { "id": "audio:mp3", "label": "MP3 · Audio", "kind": "audio", "ext": "mp3" }
  ],
  "token": "base64url…",
  "expiresAt": "2026-11-22T15:20:00.000Z"
}
```

- Extraction command: `yt-dlp --dump-single-json --skip-download --no-playlist --no-warnings --socket-timeout 15 --extractor-retries 2 <url>` with a hard 30 s timeout.
- Normalise: strip tracking-only params where safe, keep the canonical `webpageUrl` for display.
- Reject live streams, playlists, over-long videos, and missing/unsupported extractors **before** creating a job.
- Token = HMAC-SHA256 over `{ url, exp }` with a server secret, TTL 15 minutes. `/api/jobs` accepts only a signed token, so it can never be used as an open download proxy.

### 5.2 Presets

Presets are derived from the **actual formats** returned by yt-dlp, not from a fixed marketing list:

- Collect distinct `height` values from formats with a video stream (`vcodec !== "none"`).
- Offer the available heights, highest first, plus a `best` option. Do not offer resolutions the source does not have — downscaling requires a full transcode and is out of scope.
- Always offer `audio:mp3` when any audio stream exists (requires FFmpeg).
- Map a video preset to a selector such as:
  `bv*[height<=H][ext=mp4]+ba[ext=m4a]/b[height<=H][ext=mp4]/bv*[height<=H]+ba/b[height<=H]`
  with `--merge-output-format mp4`.
- Map audio to `ba/b -x --audio-format mp3 --audio-quality 0`.
- If a platform only exposes one progressive MP4 (common on Facebook), the dropdown shows that single quality plus audio. That is expected, not a bug.

### 5.3 Download jobs

`POST /api/jobs` → `202 { "id": "…", "status": "queued" }`

Statuses: `queued → downloading → processing → ready`, or `error` / `canceled`.

```json
{
  "id": "j_…",
  "status": "downloading",
  "stage": "Downloading video",
  "progress": 42,
  "title": "Video title",
  "expiresAt": "2026-11-22T15:40:00.000Z"
}
```

When ready:

```json
{
  "id": "j_…",
  "status": "ready",
  "progress": 100,
  "filename": "Video title [123456789].mp4",
  "sizeBytes": 18432109,
  "fileUrl": "/api/jobs/j_…/file"
}
```

Implementation notes:

- In-process queue with `p-queue` (concurrency 2, bounded queue of 20; `429 busy` when full).
- Use a **fixed output basename** (`media.%(ext)s`) inside a per-job temp directory; the human filename is applied only in `Content-Disposition`. This avoids path/traversal issues with platform titles.
- Parse yt-dlp progress with `--newline` (the `[download] …%` line, or compute from downloaded/total bytes); map the download phase to 0–95% and reserve 95–100% for merge/convert.
- Kill the whole process tree on cancel/timeout (FFmpeg is a child on Windows).
- Job TTL 30 minutes; delete the temp directory on download completion, cancel, expiry, and process exit.
- Thumbnails are rendered directly with `referrerpolicy="no-referrer"` and a gradient fallback; no image proxy in v1.

### 5.4 Error mapping

| Code | HTTP | When | UI message direction |
| --- | --- | --- | --- |
| `invalid_url` | 400 | Bad scheme/host/credentials/port | “That doesn’t look like a video link.” |
| `unsupported` | 422 | No yt-dlp extractor | “This site isn’t supported yet.” |
| `login_required` | 422 | “Sign in”, “login required”, cookies needed | Platform-specific hint (see §7) |
| `private` | 422 | Private/deleted/members-only | “This video is private or unavailable.” |
| `live_unsupported` | 422 | `is_live` | “Live streams aren’t supported.” |
| `too_long` | 422 | Duration > cap | “Videos longer than 30 minutes aren’t supported.” |
| `format_unavailable` | 422 | Requested preset no longer exists | “That quality is no longer available.” |
| `rate_limited` | 429 | Per-IP limit or platform 429 | “Too many requests. Try again in a minute.” |
| `busy` | 429 | Queue full | “The server is busy. Try again shortly.” |
| `extractor_failed` | 502 | Anything else from yt-dlp | “The platform didn’t return a video.” |
| `timeout` | 504 | Resolve/download exceeded limit | “The platform took too long.” |
| `tools_missing` | 503 | yt-dlp/FFmpeg not installed | “Server setup is incomplete.” |

Raw yt-dlp stderr is logged server-side (redacted) and **never** returned to the client.

---

## 6. Frontend changes

### 6.1 State machine

```text
idle → resolving → resolved → starting → queued/downloading/processing → ready
  └──────────────┴────────────── error (message + hint + retry)
                                  canceled
```

`useDownloader.ts` owns: aborting stale resolves, starting a job, 1 s polling, cancel, reset, and cleanup on unmount. No Pinia needed.

### 6.2 What changes in the UI

- **Input/form:** disable while resolving; button shows a spinner + “Finding video…”; `AbortController` cancels a stale request when the user edits/resubmits.
- **Platform detection:** hostname allowlist (suffix match) instead of `includes()`; labels for Facebook, Instagram, YouTube, TikTok, X, Vimeo, Reddit, etc.
- **Result panel (real data):** actual thumbnail (fallback gradient), platform label, title, uploader · duration, input URL; dynamic preset `<select>`; new **“Save video”** button.
- **Progress:** compact bar + stage text (“Downloading 42%”, “Merging audio…”) inside the result panel; “Cancel” action.
- **Ready state:** “Your file is ready” + `Save` button pointing at `fileUrl` (explicit click avoids blocked auto-downloads); show file size.
- **Error state:** inline panel with friendly message, hint, and “Try again”; keep the URL intact.
- **Accessibility:** `aria-live="polite"` status, `role="progressbar"` with `aria-valuenow`, focus the result heading after resolve, keyboard-operable format select and cancel, visible focus states, respect `prefers-reduced-motion` (already present).
- **Copy accuracy:** the current “PRIVATE” badge and “never stored” footnote are not true once a server is involved. Replace with accurate wording such as “No account · No history” and “Your link is used only to prepare this download and is deleted afterwards.” The full privacy/legal text goes in `LegalDialog`.
- **Mobile:** the result panel must not collapse the action row; media query at 600 px gets a full-width Save button and stacked metadata.

The visual language (Manrope/DM Sans, green palette, spacing, card, orbs) stays unchanged; only new states and one secondary action are added.

---

## 7. Platform reality check (important)

These are product constraints, not implementation details:

| Platform | Anonymous (no cookies) | Notes |
| --- | --- | --- |
| **Facebook** (public video/Reel/Watch) | Usually works | Some regional/login-gated videos still need cookies. |
| **Instagram** (public Reel/feed) | **Mixed** — many public Reels work; others need login | A public Reel was verified anonymously during development, but IG is inconsistent by post/IP. `cookies.txt` is the reliable workaround. |
| **YouTube** | Works from a residential IP | Datacenter/cloud IPs frequently get “Sign in to confirm you’re not a bot”. Downloading also conflicts with YouTube’s ToS. |
| **TikTok** | Usually works | yt-dlp’s bundled impersonation support is used where needed. |
| **X / Twitter** | Usually works | Some sensitive/login-gated posts need cookies. |
| **Vimeo, Reddit, Twitch clips, others** | Varies | yt-dlp supports 1,800+ sites; allowlist controls what the API accepts. |

**Instagram decision is the biggest product fork.** Three viable v1 paths:

1. **Public-only, best effort (recommended for a public site).** Ship without cookies; Instagram often returns a clear `login_required` error with a hint. Facebook, TikTok, X, etc. carry the demo.
2. **Optional server-side cookies (local/personal/demo).** Operator supplies a `cookies.txt` from a **burner** account via env var. Instagram starts working, but: the cookie grants account access, can be revoked, must never be committed, and one account’s limits are shared by all users. Not appropriate for a multi-user public service.
3. **Per-user cookie upload.** Would make IG work per visitor, but means storing sensitive session credentials: encryption, deletion, liability, and abuse handling. **Out of scope for v1.**

The plan assumes **1 by default**, with **2 available behind `COOKIES_FILE`** if you accept the trade-off. Do not ship operator cookies to a public deployment.

---

## 8. What is required

### 8.1 Decisions from you

1. **Hosting:** local/personal only, or public? (See §9; this changes security, legal copy, and IG cookie policy.)
2. **Instagram:** public-only with honest errors, or optional burner cookies for your own use?
3. **v1 scope:** full UX (real metadata, dynamic presets, progress, cancel, MP3) or lean MVP (metadata + MP4 only)?
4. **Sample links:** 1–2 public Facebook and Instagram URLs to verify against. Platform access varies by region/IP; without real samples I can only test YouTube/TikTok-style public links.

### 8.2 On this machine

Already present:

- Node 26.13 (Vite 8 needs ≥ 20.19 / 22.12), pnpm 12.21, Git, Python 3.12.
- Clean tree, passing build, remote `AmmrYsir/vid4u`.

To add (automatic, no global installs):

- **yt-dlp** standalone binary (~24 MB on Windows), pinned and SHA-256 verified, in `server/bin/` (gitignored). A `pnpm update:ytdlp` command refreshes it.
- **FFmpeg** via `ffmpeg-static` (~70 MB) for merging and MP3; falls back to a system `ffmpeg` if the package cannot install. If pnpm blocks the install script, one `pnpm approve-builds` is needed.
- New dependencies: `fastify`, `@fastify/static`, `@fastify/rate-limit`, `p-queue`, `ffmpeg-static`, `tsx`, `concurrently`, `vitest`, `tree-kill` (or equivalent).
- Disk space for temp downloads (a 30-minute 1080p video can be hundreds of MB); cleanup is automatic but concurrent jobs need headroom.

### 8.3 Configuration (`.env`, gitignored)

```ini
PORT=8787
HOST=127.0.0.1
PUBLIC_ORIGIN=http://localhost:5173
SIGNING_SECRET=generate-a-long-random-value
YTDLP_PATH=server/bin/yt-dlp.exe
FFMPEG_PATH=                       # blank → ffmpeg-static
COOKIES_FILE=                      # optional Netscape cookies.txt
PROXY_URL=                         # optional, for geo/blocked IPs
ALLOWED_HOSTS=facebook.com,fb.watch,instagram.com,youtube.com,youtu.be,tiktok.com,x.com,twitter.com,vimeo.com,reddit.com
MAX_DURATION_SECONDS=1800
MAX_FILESIZE_MB=500
MAX_CONCURRENT_JOBS=2
JOB_TTL_MINUTES=30
RATE_LIMIT_RESOLVE_PER_MIN=10
RATE_LIMIT_JOBS_PER_MIN=5
```

`SIGNING_SECRET` is required in production; in development it can be generated at boot with a warning.

### 8.4 For a public deployment

- A **long-running** host with FFmpeg, outbound HTTPS, and temp disk: small VPS, Railway/Render/Fly, or Docker. **Not** static Netlify/Vercel hosting, and not serverless functions (10–60 s limits, ephemeral disk, no FFmpeg).
- HTTPS reverse proxy (Caddy/Nginx) and a process supervisor (systemd/Docker/Restart policy).
- Rate limits, queue caps, and log retention reviewed. In-memory jobs mean **one instance** unless Redis is added.
- A real privacy policy + acceptable-use/legal disclaimer. Keep the UI honest about copyright and platform terms.
- Weekly yt-dlp updates (cron or deploy hook), because extractors break.
- IP reputation plan: YouTube bot checks and Instagram rate limits are common on cloud IPs. A residential proxy is possible but costly and may itself violate platform terms.

### 8.5 Security requirements built in

- Hostname allowlist (suffix match), reject IP literals, credentials, non-80/443 ports, non-HTTP(S).
- Signed, expiring tokens; `/api/jobs` cannot be used with an arbitrary URL.
- `spawn` with an argument array; never a shell string. `--ignore-config` prevents local config files from injecting options.
- Fixed temp filenames; sanitised `Content-Disposition` (RFC 5987); no path traversal.
- Per-IP rate limits, bounded queue, duration/size caps, hard timeouts, process-tree kill.
- No full URLs in logs (host + job id only); no cookies accepted from clients; temp cleanup on exit.
- Same-origin API in production; permissive CORS is not enabled by default.

---

## 9. Milestones and acceptance criteria

| # | Milestone | Contents | Done when |
| --- | --- | --- | --- |
| **M0** | Foundation | `server/` scaffold, env config, `fetch-ytdlp` script, Vite proxy, `pnpm dev` runs web+api, `/api/health` | Health returns yt-dlp/FFmpeg versions; existing page unchanged |
| **M1** | Resolve | URL validation, allowlist, `yt-dlp --dump-single-json`, presets, HMAC token, error mapping, tests | Valid FB/YT link returns real title/thumbnail/duration/presets; invalid/unsupported links return typed errors |
| **M2** | Download | Job queue, progress parsing, temp output, FFmpeg merge/MP3, file streaming, cancel, cleanup, caps | Public link → MP4 with audio plays locally; MP3 works; cancel leaves no temp files |
| **M3** | UI wiring | `api.ts`, `useDownloader`, component extraction, dynamic result, progress, error/ready states, platform detection | End-to-end from paste → format → progress → saved file; no fake data remains |
| **M4** | Polish | Copy accuracy, legal dialog, responsive/a11y pass, loading skeletons, empty states | Keyboard + mobile usable; no misleading privacy claims |
| **M5** | Hardening | Unit/API tests, README/.env.example, production build, Dockerfile/optional deploy config, real-link smoke test | `pnpm build` + `pnpm test` pass; `pnpm start` serves API + SPA; smoke test documented |

Rough effort: **3–5 focused development days** for M0–M5, excluding waiting on platform access/cookies and any legal review. M1–M2 are the risky parts because they depend on live platform behaviour.

**Definition of done for v1**

- Paste a public Facebook Reel → real metadata appears → choose an available quality → progress is visible → a playable MP4 with audio is saved.
- Instagram behaves per the chosen policy: either works with configured cookies, or fails with a clear, actionable message — never a silent hang.
- Invalid, private, live, too-long, unsupported, rate-limited, and server-misconfigured cases all produce specific UI messages.
- No arbitrary-host proxying; tokens expire; temp files are cleaned; queue/rate limits enforce.
- `pnpm build`, `pnpm test`, and a production `pnpm start` pass; README explains setup and limitations.

---

## 10. Test plan

- **Unit (Vitest):** hostname/platform detection; URL validation (IPs, credentials, ports, lookalike domains); preset derivation; token sign/verify/expiry; filename sanitisation; progress parsing.
- **API (Vitest + `app.inject`):** resolve success/error shapes with a fake yt-dlp runner; job lifecycle; queue-full 429; file 409 before ready; token tampering; rate limit. No network in CI.
- **Manual/real-link smoke:** `scripts/smoke.mjs <url>` resolves and downloads through the local API; run for FB, IG (with/without cookies), YouTube, TikTok.
- **Browser:** Chrome + Firefox, desktop + 390 px viewport; clipboard permission denial path; slow network/abort; double-submit.
- **Security checks:** unsupported host, `http://127.0.0.1`, `file://`, forged token, expired token, path traversal in preset, cancel mid-download, concurrent jobs.

No Playwright suite in v1 unless you want it; the component surface is small.

---

## 11. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Instagram requires login for most content | High — the headline feature may fail for public users | Decide policy now; optional cookies for local use; honest UI errors; don’t promise IG in marketing copy |
| Facebook/Instagram extractors break | Medium — recurring maintenance | Pinned latest yt-dlp + easy updater; health check exposes version; smoke test |
| YouTube bot checks on cloud IPs | High for public hosting | Document residential IP/proxy; set expectations; don’t make YouTube the primary demo |
| Platform ToS / copyright | Legal/reputational | Disclaimer, acceptable-use copy, personal-use framing, respond to takedowns if public |
| Abuse as an open proxy | Bandwidth/legal | Allowlist, tokens, per-IP limits, queue caps, size/duration caps, no arbitrary URLs |
| Large files / slow merges | Timeouts, disk pressure | Duration/size caps, concurrency 2, temp cleanup, hard timeout, clear progress |
| FFmpeg static install blocked by pnpm | Setup friction | `onlyBuiltDependencies` + documented `pnpm approve-builds`; system FFmpeg fallback |
| Serverless deployment attempts | Broken downloads | README explicitly requires a long-running host |

---

## 12. Alternatives considered (and why not)

- **Python/FastAPI backend using the `yt_dlp` Python API.** Cleaner progress callbacks and no CLI parsing, but adds a second toolchain (venv/pip) to a pnpm project and complicates deployment. Node + CLI is a better fit here; the Python API remains a fallback if CLI progress parsing proves too brittle.
- **`yt-dlp-exec` npm wrapper.** Convenient, but pins an older binary and adds a Python preinstall requirement; unacceptable for fast-moving extractors.
- **Nuxt/Next API routes.** Would mean rewriting the app; Vite + Fastify is simpler.
- **Direct CDN link extraction and `<a download>`.** Fails on signed/header-protected URLs and cannot merge audio; bad UX.
- **Client-side FFmpeg.wasm.** Cannot fetch the source media cross-origin, so it solves the wrong half of the problem.

---

## 13. Recommended defaults (if you don’t want to decide each item)

- Backend **in this repo** (`server/` + Fastify), one `pnpm install`, one `pnpm dev`.
- **Local/personal v1 first**, then harden for public hosting.
- **Instagram: public-only + clear error**, with `COOKIES_FILE` support for your own burner account, off by default.
- **Full UX in v1**: real metadata, dynamic quality presets, progress + cancel, MP4 and MP3.
- **Keep the single-page design**; add `Save video`, progress, error, and a legal dialog.
- **No database, no accounts, no history** in v1.
