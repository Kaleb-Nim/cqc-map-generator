# Roadmap: CQC Map Generator

## Overview

Storage & Analytics milestone — adding a Neon Postgres + Vercel Blob persistence layer underneath the existing WaveSpeed generation flow. Three coarse phases, each independently deployable. The existing submit/poll generation flow keeps working at every checkpoint — no big-bang cutover. After Phase 3, every v1 requirement (26 total) is satisfied; gallery / dashboard / ops are explicitly v2.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Database Foundation** - Neon provisioned, Drizzle schema + migration in git, build-time `drizzle-kit migrate`, no UI changes
- [ ] **Phase 2: Identity + Submit-Side Writes** - `device_id` cookie minted in submit route; every submit inserts a `status='pending'` row tagged with that device
- [ ] **Phase 3: Blob Persistence + Completion Writes** - Stream WaveSpeed PNG → Vercel Blob on success; `UPDATE` row to `complete`/`failed` with durable URL

## Phase Details

### Phase 1: Database Foundation
**Goal**: Neon Postgres is provisioned, the Drizzle schema and initial migration live in git, and `bunx drizzle-kit migrate` runs cleanly against both local `.env.local` and the Vercel build — without changing any user-visible behaviour.
**Depends on**: Nothing (first phase)
**Requirements**: DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, SCH-01, SCH-02, SCH-03, SCH-04, DEV-01
**Success Criteria** (what must be TRUE):
  1. `\dt` against the Neon production branch shows the `generations` table with all v1 columns.
  2. `lib/db/index.ts` imports only `@neondatabase/serverless` (HTTP) and `drizzle-orm/neon-http` — no `pg`, no `ws`, no `neon-serverless`.
  3. A fresh Vercel preview deployment runs `drizzle-kit migrate` against its branch DB during build and the deployment goes live green.
  4. `POST /api/generate` still returns a PNG end-to-end with the existing UI — zero regression.
  5. `bunx drizzle-kit studio` opens locally against the same schema after `bunx vercel env pull`.
**Plans**: TBD

Plans:
- [ ] 01-01: TBD (planner will decompose)

### Phase 2: Identity + Submit-Side Writes
**Goal**: Every call to the submit route mints (or reuses) a `device_id` cookie and inserts a `status='pending'` row into `generations` keyed by that device, without changing what the user sees.
**Depends on**: Phase 1
**Requirements**: ID-01, ID-02, ID-03, ID-04, ID-05, WIRE-01
**Success Criteria** (what must be TRUE):
  1. First submit from a fresh browser session sets a `device_id` cookie matching the v4 UUID format and the `httpOnly`/`sameSite=lax`/`secure`/`maxAge` flags.
  2. Second submit from the same browser reuses the same `device_id` (verified via `SELECT device_id, count(*) FROM generations GROUP BY 1`).
  3. Every submit produces exactly one new `generations` row with `status='pending'` and the correct `device_id` and `wavespeed_task_id`.
  4. The home page (`/`) does not call `cookies()` at the top level and remains free of per-request dynamic-rendering opt-in solely from identity code.
  5. The existing UI flow still ends with the user receiving their PNG unchanged.
**Plans**: TBD

Plans:
- [ ] 02-01: TBD (planner will decompose)

### Phase 3: Blob Persistence + Completion Writes
**Goal**: When the poll loop detects `status === 'completed'`, the server streams the WaveSpeed PNG into Vercel Blob and updates the row to `status='complete'` with a durable `url` and `pathname`; failures and timeouts mark the row `failed`. Every successful generation is now permanently queryable by SQL.
**Depends on**: Phase 2
**Requirements**: BLOB-01, BLOB-02, BLOB-03, BLOB-04, BLOB-05, BLOB-06, WIRE-02, WIRE-03, WIRE-04, DEV-02
**Success Criteria** (what must be TRUE):
  1. After a successful generation, the matching row has `status='complete'`, a `blob_url` of the form `https://<storeId>.public.blob.vercel-storage.com/runs/<uuid>-<suffix>.png`, a non-null `blob_pathname`, and a non-null `duration_ms`.
  2. Hitting the persisted `blob_url` directly in a browser returns the PNG with `Cache-Control: public, max-age=31536000` (or equivalent immutable header).
  3. Forcing a WaveSpeed failure (bad task / poll timeout) marks the row `status='failed'` with a non-empty `error` and a `duration_ms`, and the client still receives the existing error response (no regression).
  4. Server memory does not balloon on multi-MB images: the upload uses streaming `put(..., upstream.body, ...)` rather than `await upstream.arrayBuffer()`.
  5. `README.md` documents the full re-clone path: provision Neon, provision Blob, `bunx vercel env pull .env.local`, `bunx drizzle-kit migrate`, `bun dev`.
**Plans**: TBD

Plans:
- [ ] 03-01: TBD (planner will decompose)

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
