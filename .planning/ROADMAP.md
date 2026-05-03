# Roadmap: Storage & Analytics Milestone

**Defined:** 2026-05-04
**Granularity:** coarse (3 phases, 1–3 plans each)
**Project:** CQC Map Generator — adding a Neon Postgres + Vercel Blob persistence layer underneath the existing WaveSpeed generation flow.

## Milestone Summary

Three phases, each independently deployable. The existing submit/poll generation flow keeps working at every checkpoint — no big-bang cutover.

1. **Phase 1 — Database Foundation:** Neon provisioned, Drizzle wired through `neon-http`, schema + initial migration in git, build-time migrate hook, local env reachable. App still serves PNGs unchanged; DB exists but is unused.
2. **Phase 2 — Identity + Submit-Side Writes:** `device_id` cookie minted in the submit route, every submit inserts a `status='pending'` row tagged with that device. Existing UI behaviour unchanged.
3. **Phase 3 — Blob Persistence + Completion Writes:** On poll-detected success, server streams the WaveSpeed PNG into Vercel Blob and updates the row to `status='complete'` (or `failed` on error). Closes the loop: every generation has a durable URL queryable via SQL.

After Phase 3, every requirement in the v1 list is satisfied. v2 (gallery, dashboard, ops) is explicitly deferred.

---

## Phase 1 — Database Foundation

**Goal:** Neon Postgres is provisioned, the Drizzle schema and initial migration live in git, and `bunx drizzle-kit migrate` runs cleanly against both local `.env.local` and the Vercel build — without changing any user-visible behaviour.

**Scope:**
- Provision Neon via Vercel Marketplace integration (Production + Preview + Development scopes).
- Add `@neondatabase/serverless`, `drizzle-orm`, and `-d drizzle-kit` via `bun add`.
- Create `lib/db/index.ts` exporting a module-scope `db` singleton built from `neon(process.env.DATABASE_URL!)` + `drizzle-orm/neon-http`.
- Create `lib/db/schema.ts` with the `generations` table: id (uuid PK), device_id (text), status (text — `pending|complete|failed`), prompt inputs (jsonb of `Values`), built prompt (text), model params (text/jsonb for resolution/quality/aspect/etc.), wavespeed task id (text nullable), blob url (text nullable), blob pathname (text nullable), error (text nullable), duration_ms (integer nullable), created_at (timestamptz default now), updated_at (timestamptz).
- Create `drizzle.config.ts` pointed at `DATABASE_URL_UNPOOLED` with `casing: 'snake_case'`, `out: './lib/db/migrations'`.
- Generate + commit the initial migration (`bunx drizzle-kit generate`).
- Update `package.json` build script to `drizzle-kit migrate && next build`.
- Pull env locally via `bunx vercel env pull .env.local` and confirm `bunx drizzle-kit migrate` then `bunx drizzle-kit studio` both work.

**Requirements covered:** DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, SCH-01, SCH-02, SCH-03, SCH-04, DEV-01

**Success criteria:**
1. `\dt` against the Neon production branch shows the `generations` table with all v1 columns.
2. `lib/db/index.ts` imports only `@neondatabase/serverless` (HTTP) and `drizzle-orm/neon-http` — no `pg`, no `ws`, no `neon-serverless`.
3. A fresh Vercel preview deployment runs `drizzle-kit migrate` against its branch DB during build and the deployment goes live green.
4. `POST /api/generate` still returns a PNG end-to-end with the existing UI — zero regression.
5. `bunx drizzle-kit studio` opens locally against the same schema after `bunx vercel env pull`.

**Depends on:** none

---

## Phase 2 — Identity + Submit-Side Writes

**Goal:** Every call to the submit route mints (or reuses) a `device_id` cookie and inserts a `status='pending'` row into `generations` keyed by that device, without changing what the user sees.

**Scope:**
- Add `lib/identity.ts` with `getOrMintDeviceId()` using async `cookies()` from `next/headers` and `crypto.randomUUID()`. Cookie options: `httpOnly: true`, `sameSite: 'lax'`, `secure: NODE_ENV === 'production'`, `path: '/'`, `maxAge: 60*60*24*365`.
- Wire `getOrMintDeviceId()` into the existing submit code path inside `app/api/generate/route.ts` (the POST that hits WaveSpeed). Mint here, not in `proxy.ts`, to keep static responses cacheable.
- Generate a row UUID (`crypto.randomUUID()`) up front; pass it down the rest of the flow so Phase 3 can `UPDATE` by id.
- Insert into `generations` immediately after WaveSpeed accepts the submission: `{ id, device_id, status: 'pending', prompt_inputs, prompt, model_params, wavespeed_task_id, created_at }`.
- Verify reads from a Server Component using `await cookies()` work (a one-line debug route is fine; no UI).
- Confirm subsequent submits from the same browser reuse the same `device_id`.

**Requirements covered:** ID-01, ID-02, ID-03, ID-04, ID-05, WIRE-01

**Success criteria:**
1. First submit from a fresh browser session sets a `device_id` cookie matching the v4 UUID format and the `httpOnly`/`sameSite=lax`/`secure`/`maxAge` flags above.
2. Second submit from the same browser reuses the same `device_id` (verified via `SELECT device_id, count(*) FROM generations GROUP BY 1`).
3. Every submit produces exactly one new `generations` row with `status='pending'` and the correct `device_id` and `wavespeed_task_id`.
4. The home page (`/`) does not call `cookies()` at the top level and remains free of per-request dynamic-rendering opt-in solely from identity code.
5. The existing UI flow still ends with the user receiving their PNG unchanged.

**Depends on:** Phase 1

---

## Phase 3 — Blob Persistence + Completion Writes

**Goal:** When the poll loop detects `status === 'completed'`, the server streams the WaveSpeed PNG into Vercel Blob and updates the row to `status='complete'` with a durable `url` and `pathname`; failures and timeouts mark the row `failed`. Every successful generation is now permanently queryable by SQL.

**Scope:**
- Provision the Blob store via `bunx vercel blob store add`; confirm `BLOB_READ_WRITE_TOKEN` lands in Vercel env (all scopes) and locally via `bunx vercel env pull`.
- Add `@vercel/blob` via `bun add`.
- In the poll-success branch of `app/api/generate/route.ts` (still `runtime = 'nodejs'`): `fetch(ephemeralUrl)`, then `put(\`runs/${generationId}.png\`, upstream.body, { access: 'public', addRandomSuffix: true, cacheControlMaxAge: 60*60*24*365, contentType: upstream.headers.get('content-type') ?? 'image/png' })`.
- `UPDATE generations` with `status='complete'`, `blob_url`, `blob_pathname`, `duration_ms`, `updated_at` keyed by the row id from Phase 2.
- In the failure / timeout / WaveSpeed-error branches, `UPDATE generations` with `status='failed'`, `error`, `duration_ms`, `updated_at`.
- Keep the existing response shape (`image/png` body) so the client UI is unchanged. Source the response bytes either from the freshly fetched buffer or by re-fetching `blob.url` — whichever keeps the existing decode path simplest.
- Update `README.md` with the Neon + Blob setup steps for re-clone scenarios (provisioning, env pull, migrate).

**Requirements covered:** BLOB-01, BLOB-02, BLOB-03, BLOB-04, BLOB-05, BLOB-06, WIRE-02, WIRE-03, WIRE-04, DEV-02

**Success criteria:**
1. After a successful generation, the matching row has `status='complete'`, a `blob_url` of the form `https://<storeId>.public.blob.vercel-storage.com/runs/<uuid>-<suffix>.png`, a non-null `blob_pathname`, and a non-null `duration_ms`.
2. Hitting the persisted `blob_url` directly in a browser returns the PNG with `Cache-Control: public, max-age=31536000` (or equivalent immutable header).
3. Forcing a WaveSpeed failure (bad task / poll timeout) marks the row `status='failed'` with a non-empty `error` and a `duration_ms`, and the client still receives the existing error response (no regression).
4. Server memory does not balloon on multi-MB images: the upload uses streaming `put(..., upstream.body, ...)` rather than `await upstream.arrayBuffer()`.
5. `README.md` documents the full re-clone path: provision Neon, provision Blob, `bunx vercel env pull .env.local`, `bunx drizzle-kit migrate`, `bun dev`.

**Depends on:** Phase 2

---

## Coverage Table

Every v1 requirement maps to exactly one phase.

| Requirement | Phase |
|-------------|-------|
| ID-01 | Phase 2 |
| ID-02 | Phase 2 |
| ID-03 | Phase 2 |
| ID-04 | Phase 2 |
| ID-05 | Phase 2 |
| DB-01 | Phase 1 |
| DB-02 | Phase 1 |
| DB-03 | Phase 1 |
| DB-04 | Phase 1 |
| DB-05 | Phase 1 |
| DB-06 | Phase 1 |
| DB-07 | Phase 1 |
| SCH-01 | Phase 1 |
| SCH-02 | Phase 1 |
| SCH-03 | Phase 1 |
| SCH-04 | Phase 1 |
| BLOB-01 | Phase 3 |
| BLOB-02 | Phase 3 |
| BLOB-03 | Phase 3 |
| BLOB-04 | Phase 3 |
| BLOB-05 | Phase 3 |
| BLOB-06 | Phase 3 |
| WIRE-01 | Phase 2 |
| WIRE-02 | Phase 3 |
| WIRE-03 | Phase 3 |
| WIRE-04 | Phase 3 |
| DEV-01 | Phase 1 |
| DEV-02 | Phase 3 |

**Total:** 26 / 26 v1 requirements mapped. No orphans.

---
*Defined: 2026-05-04*
