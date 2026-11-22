# vid4u

Paste a public video link from Facebook, Instagram, YouTube, TikTok and other supported sites, choose a quality, and save the video or audio to your device.

The Vue landing page is backed by a small Node/Fastify service that runs [yt-dlp](https://github.com/yt-dlp/yt-dlp) and FFmpeg. The browser never talks to Facebook/Instagram directly: the API resolves metadata, runs the download in a queued job, reports progress, and streams the finished file back.

---

## Requirements

- **Node.js ≥ 22.12** (developed on Node 26)
- **pnpm ≥ 10** (developed on pnpm 12)
- A working internet connection and enough disk space for temporary downloads
- No global installs are required: `pnpm setup:tools` downloads a pinned, SHA-256-verified yt-dlp binary, and FFmpeg comes from `ffmpeg-static`

> **Important:** this cannot be deployed as a static site. Facebook/Instagram block browser requests through CORS and signed URLs, and merging 1080p/MP3 requires FFmpeg. Use a long-running host (VPS, Docker, Railway/Render/Fly), not static Netlify/Vercel and not serverless functions.

---

## Quick start

```bash
pnpm install
pnpm setup:tools          # downloads server/bin/yt-dlp(.exe)
pnpm dev                  # Vite on http://localhost:5173 + API on :8787
```

Open <http://localhost:5173>. Paste a public Facebook Reel, YouTube video, or TikTok link.

The first `pnpm install` may print an `ERR_PNPM_IGNORED_BUILDS` message on a fresh checkout. This repo's `pnpm-workspace.yaml` already allows the two required packages (`esbuild`, `ffmpeg-static`); if your pnpm version still blocks them, run:

```bash
pnpm approve-builds --all
pnpm install
```

### Production build

```bash
pnpm build                # type-check + build web (dist/) + compile server (server/dist/)
NODE_ENV=production pnpm start
```

`pnpm start` serves the SPA and API on <http://127.0.0.1:8787>. Set `HOST=0.0.0.0` when running in Docker/behind a proxy. `SIGNING_SECRET` is mandatory when `NODE_ENV=production`.

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
$env:NODE_ENV = "production"
pnpm start
```

### Smoke test a real link

With the API running:

```bash
pnpm smoke -- https://www.facebook.com/reel/...
```

or choose a preset:

```bash
SMOKE_PRESET=video:720 pnpm smoke -- https://www.youtube.com/watch?v=...
```

On PowerShell: `$env:SMOKE_PRESET='video:720'; pnpm smoke -- "..."`.

---

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Runs Vite and the API together (Vite proxies `/api`) |
| `pnpm dev:web` | Vite only |
| `pnpm dev:api` | API only, with `tsx watch` |
| `pnpm build` | `build:web` + `build:api` |
| `pnpm build:web` | `vue-tsc -b && vite build` |
| `pnpm build:api` | Compiles `server/src` to `server/dist` |
| `pnpm start` | Runs the compiled API and serves `dist/` |
| `pnpm test` | Vitest unit + API tests (44 tests, no network) |
| `pnpm typecheck` | Web and API type checks |
| `pnpm setup:tools` | Downloads the pinned yt-dlp binary |
| `pnpm update:ytdlp` | Installs the latest yt-dlp release |
| `pnpm smoke -- <url>` | Resolves and downloads one real link through the API |

---

## Configuration

Copy `.env.example` to `.env`. Everything has a development default, so `.env` is optional locally.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `8787` | API port |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` in containers |
| `NODE_ENV` | `development` | `production` requires `SIGNING_SECRET` |
| `SIGNING_SECRET` | generated per boot in dev | Signs 15-minute download tokens |
| `YTDLP_PATH` | `server/bin/yt-dlp[.exe]` | Auto-detected |
| `FFMPEG_PATH` | `ffmpeg-static` binary | Falls back to a system `ffmpeg` if set |
| `COOKIES_FILE` | empty | Optional Netscape `cookies.txt` for login-gated sites |
| `PROXY_URL` | empty | Optional outbound proxy for yt-dlp |
| `ALLOWED_HOSTS` | supported platforms | Comma-separated hostname suffix allowlist |
| `TEMP_DIR` | `server/.tmp` | Per-job temp directories live here |
| `MAX_DURATION_SECONDS` | `1800` | Reject videos longer than 30 minutes |
| `MAX_FILESIZE_MB` | `500` | yt-dlp `--max-filesize` cap |
| `MAX_CONCURRENT_JOBS` | `2` | Simultaneous downloads |
| `MAX_QUEUED_JOBS` | `20` | Queue cap before `429 busy` |
| `JOB_TTL_MINUTES` | `30` | Time a finished file stays downloadable |
| `RESOLVE_TIMEOUT_SECONDS` | `45` | Metadata extraction timeout |
| `DOWNLOAD_TIMEOUT_SECONDS` | `600` | Hard download timeout |
| `RATE_LIMIT_RESOLVE_PER_MIN` | `10` | Per-IP resolve limit |
| `RATE_LIMIT_JOBS_PER_MIN` | `5` | Per-IP job limit |
| `TRUST_PROXY` | `false` | Set `true` behind a trusted reverse proxy |
| `SERVE_STATIC` | auto | Serves `dist/` when `dist/index.html` exists |
| `LOG_LEVEL` | `info` | Pino log level |

### Short-lived download tokens

`POST /api/resolve` returns a signed token containing the URL, title, media id and an expiry. `POST /api/jobs` accepts only that token, so the API cannot be used as an arbitrary proxy. Tokens last 15 minutes; jobs/files last 30 minutes by default.

---

## API

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/api/health` | — | yt-dlp/FFmpeg availability and versions |
| `POST` | `/api/resolve` | `{ "url": "https://…" }` | `{ video, presets, token, expiresAt }` |
| `POST` | `/api/jobs` | `{ "token": "…", "presetId": "video:720" }` | `202 { id, status: "queued", … }` |
| `GET` | `/api/jobs/:id` | — | `{ id, status, stage, progress, … }` |
| `GET` | `/api/jobs/:id/file` | — | Streamed attachment (409 until ready) |
| `DELETE` | `/api/jobs/:id` | — | `{ ok: true }`; cancels and cleans up |

Errors use one envelope:

```json
{
  "error": {
    "code": "login_required",
    "message": "This video needs a logged-in session.",
    "hint": "Instagram and some Facebook or YouTube videos require cookies. …"
  }
}
```

Codes include `invalid_url`, `invalid_request`, `invalid_token`, `unsupported`, `playlist_unsupported`, `login_required`, `private`, `live_unsupported`, `too_long`, `too_big`, `format_unavailable`, `rate_limited`, `busy`, `extractor_failed`, `timeout`, `tools_missing`, `not_ready`, `not_found`.

### How a download flows

1. The UI posts a URL to `/api/resolve`.
2. The API validates the host, runs `yt-dlp --dump-single-json`, rejects live/playlist/too-long media, derives real quality presets, and signs a token.
3. The UI posts the token + chosen preset to `/api/jobs`.
4. A bounded queue runs `yt-dlp` into `server/.tmp/<job-id>`, parses progress lines, asks FFmpeg to merge or extract MP3, and marks the job `ready`.
5. The UI polls every second. “Save video” follows `/api/jobs/:id/file`, which sets a safe filename and streams the file.
6. Temp files are deleted on cancel, expiry, error and server shutdown.

Presets are derived from the actual formats, not invented:

- `video:best` — best MP4, preferring H.264/AAC for compatibility
- `video:<height>` — available heights only (no fake downscaling)
- `video:hd` / `video:sd` — Facebook’s progressive formats without numeric heights
- `audio:mp3` — extract audio via FFmpeg

---

## Platform reality check

| Platform | Public link, no cookies | Notes |
| --- | --- | --- |
| Facebook | Usually works | Some regional/private videos need cookies |
| Instagram | Many public Reels work; some need login | Public Reels were verified anonymously, but IG is inconsistent by post/IP; use `COOKIES_FILE` with a **burner** account if needed |
| YouTube | Works from residential IPs | Datacenter/cloud IPs often get “Sign in to confirm you’re not a bot”; downloading conflicts with YouTube’s ToS |
| TikTok | Usually works | yt-dlp handles impersonation where needed |
| X / Twitter | Usually works | Some sensitive posts need cookies |
| Vimeo, Reddit, Dailymotion, Twitch clips, others | Varies | Extend `ALLOWED_HOSTS` if needed |

**Instagram is inconsistent.** A public Reel worked during development without cookies, but other posts return “login required”. Server-side cookies make more links work for your own use, but they grant account access, can be revoked, and should never be used for a multi-user public service. Per-user cookie upload is intentionally out of scope.

---

## Security notes

- Hostname suffix allowlist; IP literals, credentials, custom ports, `file:`, `javascript:` and local names are rejected
- Signed, expiring tokens; jobs cannot be created from an arbitrary URL
- `spawn` with argument arrays only; `--ignore-config` prevents local config injection
- Per-IP rate limits, bounded queue, duration and file-size caps, hard timeouts
- Fixed temp filenames; sanitized `Content-Disposition` (RFC 5987)
- Temp directories are removed on cancel/expiry/shutdown; yt-dlp’s PyInstaller temp cache is kept separate from job output so Windows locks do not block cleanup
- No full URLs are logged; full yt-dlp stderr is redacted from API responses
- The API is same-origin in production; CORS is not enabled

Use at your own risk. Only download videos you own or have permission to save, and respect copyright and each platform’s terms. vid4u is not affiliated with Meta, YouTube, TikTok, X or any other platform. See the in-app **Privacy & fair use** dialog.

---

## Deployment checklist

- Long-running host with FFmpeg (the bundled binary is copied into `node_modules`; Docker images need the same `pnpm install` + `pnpm build`)
- `NODE_ENV=production`, a strong `SIGNING_SECRET`, `HOST=0.0.0.0`, `TRUST_PROXY=true` behind the proxy
- HTTPS reverse proxy (Caddy/Nginx) and a process supervisor
- Persistent/adequate temp disk; monitor `server/.tmp`
- One instance unless jobs are moved to Redis (jobs are in-memory)
- Run `pnpm update:ytdlp` on a schedule — extractors break when platforms change
- Add a real privacy policy and terms if the service is public
- If YouTube is important, use a residential egress IP or accept bot-check failures

---

## Project layout

```text
src/                     Vue app
  components/            DownloadCard, ResultPanel, LegalDialog
  composables/           useDownloader state machine
  lib/                   API client, platform helpers
  types/                 shared client types
server/src/              Fastify API
  routes/                resolve, jobs, health
  services/              yt-dlp runner, job queue, presets, security, tools
scripts/                 fetch-ytdlp, smoke test
PLAN.md                  architecture and implementation plan
```

## Tests

```bash
pnpm test
```

Covers hostname/URL validation, token signing/expiry/tampering, preset derivation, selectors, filename sanitization, API envelopes, job creation/cancel, static SPA fallback and health. Real platform calls are exercised with `pnpm smoke` and were manually verified against public Facebook, Instagram, YouTube and TikTok links during development.

## Troubleshooting

- **`ERR_PNPM_IGNORED_BUILDS`** — run `pnpm approve-builds --all` (the required packages are esbuild and ffmpeg-static).
- **“The download tools are not installed”** — run `pnpm setup:tools`; check `GET /api/health`.
- **Instagram says login required** — expected for most public IG links; configure `COOKIES_FILE` with a burner account or use another platform.
- **YouTube says “Sign in to confirm you’re not a bot”** — the egress IP is flagged. Try a different network/proxy; do not ship cookies for a public service.
- **“File is larger than the server limit”** — raise `MAX_FILESIZE_MB` or choose a lower quality.
- **Cancel leaves a temp folder on Windows** — fixed by keeping PyInstaller temp outside the job folder and retrying cleanup; if an old folder remains, it is safe to remove `server/.tmp`.
