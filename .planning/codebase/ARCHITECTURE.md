<!-- refreshed: 2026-05-03 -->
# Architecture

**Analysis Date:** 2026-05-03

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                   Browser (Client Component)                 │
│   `app/page.tsx`  — password gate + Generate button + <img>  │
│   localStorage: rmg-password                                 │
└──────────────────┬──────────────────────────────────────────┘
                   │ POST /api/generate
                   │ header: x-generate-password
                   ▼
┌─────────────────────────────────────────────────────────────┐
│             Next.js Route Handler (Node runtime)             │
│   `app/api/generate/route.ts`  — runtime='nodejs',           │
│                                  maxDuration=300             │
│   1. Auth check (GENERATE_PASSWORD)                          │
│   2. pickValues() + buildPrompt()  (`lib/generate.ts`)       │
│   3. Submit + poll WaveSpeed                                 │
│   4. Decode base64 → return image/png                        │
└──────────────────┬──────────────────────────────────────────┘
                   │
        ┌──────────┴───────────┐
        │                      │
        ▼                      ▼
┌────────────────────┐  ┌──────────────────────────────────┐
│  Pure value/prompt │  │  WaveSpeed gateway               │
│  module (no I/O)   │  │  api.wavespeed.ai                │
│  `lib/generate.ts` │  │  /api/v3/openai/gpt-image-2/edit │
│                    │  │  /api/v3/predictions/{id}/result │
└────────────────────┘  └──────────────────────────────────┘
                                   │
                                   │ references baseImageUrl
                                   ▼
                        ┌────────────────────────┐
                        │  `public/base.jpg`     │
                        │  served at /base.jpg   │
                        └────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Root layout | HTML shell, fonts, global CSS, page metadata | `app/layout.tsx` |
| Home page (client) | Password gate, Generate trigger, blob → `<img>`, download | `app/page.tsx` |
| Generate route | Auth, value picking, WaveSpeed submit+poll, PNG response | `app/api/generate/route.ts` |
| Value/prompt module | Pure RNG → `Values`, formatters, `buildPrompt` | `lib/generate.ts` |
| Base image asset | Source screenshot edited by gpt-image-2 | `public/base.jpg` |
| Global styles | Tailwind v4 import + CSS vars | `app/globals.css` |

## Pattern Overview

**Overall:** Single-page Next.js 16 App Router app with one client page and one Node-runtime API route. No DB, no server components beyond `RootLayout`, no middleware, no server actions. State lives in the browser (localStorage + React state); the server is stateless and proxies a single async job to WaveSpeed.

**Key Characteristics:**
- App Router (`app/`), not Pages Router. No `pages/` directory exists.
- Route handler explicitly opts into Node runtime (`runtime = 'nodejs'`) and extends `maxDuration` to 300s for poll headroom.
- `lib/generate.ts` is intentionally pure (no `fetch`, no `process.env`) — all I/O confined to `route.ts`.
- Image bytes are returned directly as `image/png` from the route; metadata is side-channelled in the `X-Generate-Meta` header (base64-encoded JSON).
- Auth is a single shared password compared in the route handler against `process.env.GENERATE_PASSWORD`. No sessions, no cookies — the client resends the password header on every request.

## Layers

**Client (browser):**
- Purpose: Capture password, trigger generation, render returned PNG, expose download.
- Location: `app/page.tsx` (entire file is a `'use client'` component).
- Contains: React state, `fetch('/api/generate')`, `URL.createObjectURL(blob)`, localStorage persistence under key `rmg-password`.
- Depends on: `/api/generate` route, browser `localStorage`, `URL` API.
- Used by: end user.

**Server route handler:**
- Purpose: Authenticate, generate randomized prompt values, drive WaveSpeed async task to completion, return PNG.
- Location: `app/api/generate/route.ts`.
- Contains: `POST` handler, `WaveSpeedResponse` type, submit/poll loop.
- Depends on: `lib/generate.ts`, `process.env.WAVESPEED_API_KEY`, `process.env.GENERATE_PASSWORD`, public asset `base.jpg`.
- Used by: client page.

**Pure logic / utilities:**
- Purpose: Deterministic-when-seeded value generation, time/pace formatters, prompt assembly.
- Location: `lib/generate.ts`.
- Contains: `Values` type, `mulberry32`, `pickValues`, `formatHHMM`, `formatClock`, `formatPace`, `buildPrompt`.
- Depends on: nothing (no imports).
- Used by: `app/api/generate/route.ts`. Importable in tests with a seeded RNG via `mulberry32`.

## Data Flow

### Primary Request Path (Generate)

1. User clicks Generate in `app/page.tsx:113` → `generate()` (`app/page.tsx:45`) calls `fetch('/api/generate', { method: 'POST', headers: { 'x-generate-password': password } })`.
2. `POST` handler reads header, compares to `GENERATE_PASSWORD` env (`app/api/generate/route.ts:21-28`). 401 → client clears stored password.
3. `pickValues()` (`lib/generate.ts:32`) produces randomized `Values`; `screenshot_time_from` constrained to 16:30–17:30 (`lib/generate.ts:38`). `buildPrompt(values)` (`lib/generate.ts:100`) assembles the gpt-image-2 edit prompt.
4. Route computes `baseImageUrl = req.nextUrl.origin + '/base.jpg'` (`app/api/generate/route.ts:40-41`) — `public/base.jpg` is served by Next from project root.
5. **Submit:** `POST https://api.wavespeed.ai/api/v3/openai/gpt-image-2/edit` with `{ images: [baseImageUrl], prompt, aspect_ratio: '9:16', resolution: '1k', quality: 'high', enable_sync_mode: false, enable_base64_output: true }` (`app/api/generate/route.ts:46-61`). Returns `{ data: { id, status } }`.
6. **Poll loop:** every 3s, `GET /api/v3/predictions/{id}/result` until `status === 'completed'` or `'failed'`, with deadline `Date.now() + 270_000` ms (`app/api/generate/route.ts:82-118`). Headroom of 30s under `maxDuration = 300`.
7. **Decode:** first entry of `data.outputs` is either a `data:`/raw base64 string or an `http(s)://` URL. Base64 path strips `data:...;base64,` prefix and decodes to `Buffer`; URL path re-fetches the asset (`app/api/generate/route.ts:127-139`).
8. **Respond:** `new NextResponse(new Uint8Array(pngBuf))` with `Content-Type: image/png`, `Content-Disposition: attachment`, and base64-JSON `X-Generate-Meta` (`app/api/generate/route.ts:160-167`).
9. Client receives blob, `URL.createObjectURL` → `<img src>` and download button (`app/page.tsx:60-75`).

### Auth Flow

1. First load: `useEffect` reads `localStorage['rmg-password']`. If absent, render password form (`app/page.tsx:15-21`, `app/page.tsx:77-100`).
2. On submit, password persisted to localStorage, gate flipped via `setHasPassword(true)`.
3. On any 401 from `/api/generate`, `clearPassword()` removes localStorage and returns user to the gate.

**State Management:**
- Client: React `useState` only. Persisted state: `localStorage['rmg-password']`. No cookies, no server session.
- Server: stateless. No in-memory caches, no DB.

## Key Abstractions

**`Values` (type):**
- Purpose: Single object describing every randomized parameter for one generation.
- Examples: `lib/generate.ts:3-19`.
- Pattern: Plain TS object; produced once per request, formatted into the prompt and into the `X-Generate-Meta` header.

**`mulberry32(seed)`:**
- Purpose: Seedable PRNG factory for deterministic test runs.
- Location: `lib/generate.ts:21-30`.
- Pattern: `pickValues` accepts `rng = Math.random` parameter so callers can inject `mulberry32(seed)`.

**`WaveSpeedResponse` (type):**
- Purpose: Local view of the WaveSpeed JSON envelope shared by submit and poll endpoints.
- Location: `app/api/generate/route.ts:9-18`.

## Entry Points

**HTTP entry — page:**
- Location: `app/page.tsx` (route `/`).
- Triggers: GET `/`.
- Responsibilities: Render gate or generator UI.

**HTTP entry — API:**
- Location: `app/api/generate/route.ts` (route `/api/generate`).
- Triggers: POST from `app/page.tsx`.
- Responsibilities: Auth + WaveSpeed orchestration.

**Root layout:**
- Location: `app/layout.tsx`.
- Triggers: All routes.
- Responsibilities: HTML shell, Geist fonts, `globals.css`, document `<title>` ("fuck this CQC").

## Architectural Constraints

- **Runtime:** Route handler pinned to `runtime = 'nodejs'` (`app/api/generate/route.ts:4`). It uses Node `Buffer` for base64 decode and the response body — Edge runtime would break this.
- **maxDuration:** `export const maxDuration = 300` (`app/api/generate/route.ts:5`) — caps Vercel function execution at 300s. Poll deadline is 270s to leave 30s headroom for decode + response.
- **Public base image required:** `public/base.jpg` MUST be reachable at `<origin>/base.jpg` because WaveSpeed fetches it as the source `images[0]` (`app/api/generate/route.ts:40-41, 53`). On localhost, WaveSpeed cannot reach `http://localhost:3000/base.jpg` — local dev requires a tunnel or hosted env.
- **Single-process state:** Submit and poll happen in the same request lifecycle; if the function crashes mid-poll, the WaveSpeed task ID is lost. No persistence layer.
- **Auth is shared-secret:** No per-user accounts, no rate limiting, no audit trail. Password header is plaintext over HTTPS.
- **No middleware:** No `middleware.ts` exists; the password check is duplicated only inside `route.ts`. Adding a new authenticated route requires re-implementing the check or extracting it.
- **Tailwind v4:** Styles use Tailwind v4 via `@tailwindcss/postcss` (`postcss.config.mjs`, `package.json:17`). No `tailwind.config.*` — config lives in `app/globals.css` directives.

## Anti-Patterns

### Auth check inlined in route handler

**What happens:** Password comparison is hard-coded at the top of `POST` in `app/api/generate/route.ts:21-28`.
**Why it's wrong:** Any new authenticated route must copy this block; easy to forget. Also leaks the response shape (`{ error: 'Unauthorized' }`) inconsistently.
**Do this instead:** Extract to `lib/auth.ts` (e.g. `requirePassword(req): NextResponse | null`) and call from each route, or move to `middleware.ts` for `/api/*`.

### Side-channel metadata via response header

**What happens:** `X-Generate-Meta` carries base64-JSON of values + prompt alongside `image/png` body (`app/api/generate/route.ts:165`).
**Why it's wrong:** Header size limits (~8KB on most platforms) cap how much metadata can ride along; the client currently ignores it (no reader in `app/page.tsx`); base64-JSON-in-header is awkward to debug.
**Do this instead:** If metadata is needed client-side, return JSON `{ pngBase64, meta }` and have the client decode; or add a separate `/api/generate/meta/[id]` if you start persisting tasks.

### Mixing submit-and-poll in a single HTTP request

**What happens:** One client request blocks for up to 270s while the server polls WaveSpeed (`app/api/generate/route.ts:87-118`).
**Why it's wrong:** Any client disconnect (mobile sleep, navigation) loses the result; Vercel's `maxDuration` is the hard ceiling; no way to resume or cache.
**Do this instead:** Split into `POST /api/generate` returning `{ taskId }` immediately, and `GET /api/generate/[taskId]` for polling from the client. Persist `taskId → status` (KV/Redis) if you want resume.

## Error Handling

**Strategy:** Fail-fast inside the `POST` handler — every error path returns a JSON `{ error: string }` with an appropriate HTTP status (401, 500, 502, 504). The client surfaces `body.error` verbatim via `setError`.

**Patterns:**
- Missing env → 500 with explicit "Server misconfigured: X not set" (`app/api/generate/route.ts:23-24, 31-32`).
- Bad password → 401, client clears localStorage (`app/api/generate/route.ts:26-28`, `app/page.tsx:57`).
- Upstream HTTP failure → 502 with `text.slice(0, 500)` for safety (`app/api/generate/route.ts:65-68, 92-97`).
- WaveSpeed `code !== 200` → 502 with `code` and `message` (`app/api/generate/route.ts:71-77, 100-105`).
- `status === 'failed'` → 502 with task error string (`app/api/generate/route.ts:111-116`).
- Poll deadline exceeded → 504 with task ID for debugging (`app/api/generate/route.ts:120-125`).
- All wrapped in `try/catch` — unexpected throws → 502 with message (`app/api/generate/route.ts:140-143`).

## Cross-Cutting Concerns

**Logging:** None. Errors are returned to the client; server-side `console.*` is not used. Add structured logging here when introducing observability.

**Validation:** None on inbound request — `POST /api/generate` takes no body. The only validated input is the `x-generate-password` header.

**Authentication:** Shared password via `x-generate-password` header, compared to `GENERATE_PASSWORD` env. Persisted client-side in `localStorage['rmg-password']`.

**Configuration:** `process.env.WAVESPEED_API_KEY`, `process.env.GENERATE_PASSWORD`. Template at `.env.example`. No runtime config validation (e.g. zod on env) — env presence is checked lazily inside the handler.

**Styling:** Tailwind v4 utility classes inline in JSX; no component library, no CSS modules. Geist Sans/Mono via `next/font/google` in `app/layout.tsx`.

---

*Architecture analysis: 2026-05-03*
