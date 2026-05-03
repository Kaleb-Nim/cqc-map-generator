# External Integrations

**Analysis Date:** 2026-05-03

## APIs & External Services

**Image generation gateway:**
- **WaveSpeed AI** — sole external service; gateway to OpenAI's `gpt-image-2` edit endpoint without requiring OpenAI org verification
  - SDK/Client: none — direct `fetch` calls in `app/api/generate/route.ts`
  - Auth: `Authorization: Bearer ${WAVESPEED_API_KEY}` header
  - Submit endpoint: `POST https://api.wavespeed.ai/api/v3/openai/gpt-image-2/edit` (`WAVESPEED_ENDPOINT` constant, `app/api/generate/route.ts:7`)
  - Poll endpoint: `GET https://api.wavespeed.ai/api/v3/predictions/{taskId}/result` (`app/api/generate/route.ts:82`)
  - Request payload: `{ images: [baseImageUrl], prompt, aspect_ratio: '9:16', resolution: '1k', quality: 'high', enable_sync_mode: false, enable_base64_output: true }`
  - Response shape: `{ code, message, data: { id, status: 'created'|'processing'|'completed'|'failed', outputs?: string[], error? } }` (typed locally as `WaveSpeedResponse`)
  - Pattern: async submit → poll every 3s with a 270s deadline; outputs may arrive as base64 (preferred via `enable_base64_output: true`) or as an HTTPS URL — both branches handled at `app/api/generate/route.ts:130-139`

**Indirect (via WaveSpeed):**
- OpenAI `gpt-image-2` edit endpoint — accessed only through WaveSpeed; no direct OpenAI integration. The previous direct OpenAI integration was replaced (see commit `8e05f3b feat: switch from OpenAI direct to WaveSpeed gateway for gpt-image-2`).

**Google Fonts:**
- `next/font/google` loads Geist and Geist Mono in `app/layout.tsx`; Next handles fetching/self-hosting at build time. No runtime credentials required.

## Data Storage

**Databases:**
- None. The app is stateless.

**File Storage:**
- Local filesystem only — `public/base.jpg` is the immutable source image served by Next.js at `/base.jpg` and re-fetched by WaveSpeed via the deployment's public origin.
- Generated PNGs are streamed back to the browser as the response body (no server-side persistence).

**Caching:**
- None. Each request re-runs the full generation pipeline.
- Client-side: generated image held in a blob URL via `URL.createObjectURL` (`app/page.tsx:61`).

## Authentication & Identity

**Auth Provider:**
- Custom — single shared password gate, no user accounts or sessions.

**Implementation:**
- Server: `/api/generate` requires header `x-generate-password` to equal `process.env.GENERATE_PASSWORD` (`app/api/generate/route.ts:21-28`); responds 401 on mismatch, 500 if env var missing
- Client: password collected via form, stored in `localStorage` under key `rmg-password` (`app/page.tsx:5,33`); sent as the `x-generate-password` header on every generate call (`app/page.tsx:53`)
- 401 responses trigger automatic `clearPassword()` on the client (`app/page.tsx:57`), wiping `localStorage` and forcing re-entry
- No CSRF protection, rate limiting, or session expiry — protection model is "long random shared secret + private deployment URL" (per `README.md` Security section)

## Monitoring & Observability

**Error Tracking:**
- None. Errors are returned as JSON to the client and surfaced in a red banner (`app/page.tsx:120-124`).

**Logs:**
- Implicit — Vercel Functions captures `console`/stderr automatically. No explicit logging calls in the codebase.

## CI/CD & Deployment

**Hosting:**
- Vercel (Hobby plan or higher)
- Function `maxDuration = 300` declared in `app/api/generate/route.ts:5`
- Runtime pinned to `nodejs` (not Edge) — required for Buffer usage and long polling

**CI Pipeline:**
- None detected (no `.github/`, no CI config). Deployment presumed via Vercel's Git integration.

## Environment Configuration

**Required env vars** (per `.env.example` and `app/api/generate/route.ts`):
- `WAVESPEED_API_KEY` — WaveSpeed AI API key; fronts gpt-image-2 access
- `GENERATE_PASSWORD` — shared secret protecting `/api/generate`; `.env.example` ships placeholder `pick-something-long-and-random`

**Local secret location:**
- `.env.local` (gitignored, created from `.env.example`)

**Production secret location:**
- Vercel Project → Settings → Environment Variables (per `README.md` deployment table)

**Validation:**
- Both vars are checked at request time inside the route handler; missing values yield a 500 response. No startup-time validation.

## Webhooks & Callbacks

**Incoming:**
- None. The only HTTP entry point is `POST /api/generate`.

**Outgoing:**
- None. Communication with WaveSpeed is request/response polling, not webhook callbacks.

**Public surface required by WaveSpeed:**
- WaveSpeed pulls the source image from `${req.nextUrl.origin}/base.jpg` (`app/api/generate/route.ts:40-41`). The deployment origin must be publicly reachable for image edits to succeed — local development against a non-tunneled host will fail this fetch.

---

*Integration audit: 2026-05-03*
