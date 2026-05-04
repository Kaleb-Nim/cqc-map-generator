---
phase: 01-database-foundation
plan: 02
subsystem: data
tags: [drizzle, neon, postgres, migrations]
status: paused-on-checkpoint
requires: [01-database-foundation/01]
provides:
  - "Singleton db client at lib/db/index.ts (neon-http)"
  - "generations pgTable with 13 columns + 2 indexes"
  - "Initial migration 0000_tiresome_squadron_supreme.sql (committed)"
  - "Build-time drizzle-kit migrate hook"
affects:
  - "package.json build script (drizzle-kit migrate && next build)"
tech-stack:
  added:
    - "ws + @types/ws (devDeps, kit websocket polyfill)"
    - "pg + @types/pg (devDeps, drizzle-kit's preferred TCP driver)"
  patterns:
    - "Module-scope db singleton (Fluid Compute friendly)"
    - "snake_case casing in both schema column names and drizzle config"
    - "DESC indexes for created_at history queries"
key-files:
  created:
    - "lib/db/schema.ts"
    - "lib/db/index.ts"
    - "drizzle.config.ts"
    - "lib/db/migrations/0000_tiresome_squadron_supreme.sql"
    - "lib/db/migrations/meta/_journal.json"
    - "lib/db/migrations/meta/0000_snapshot.json"
  modified:
    - "package.json"
    - "bun.lock"
decisions:
  - "Added pg as a devDep so drizzle-kit migrate uses TCP direct via DATABASE_URL_UNPOOLED. The auto-detected @neondatabase/serverless driver path inside drizzle-kit hung the migrate command (warning + exit 1, no schema persisted). Runtime stays on neon-http per CONTEXT.md — pg never imported by app code."
  - "Added ws as a devDep alongside pg. Harmless and standard for any kit/neon path that needs a websocket."
metrics:
  duration_minutes: 12
  completed_date: "2026-05-03"
  tasks_completed: 3
  tasks_total: 4
  checkpoint_blocked_at: "Task 4-C (Vercel preview deploy verification)"
---

# Phase 1 Plan 02: Schema + Migration + Build Hook — Summary

One-liner: Drizzle ORM wired with neon-http singleton; `generations` table created via initial migration; `bun run build` now runs `drizzle-kit migrate` before `next build`.

## What shipped

- **`lib/db/schema.ts`** — `generations` pgTable, 13 columns (id, device_id, status, prompt_inputs, prompt, model_params, wavespeed_task_id, blob_url, blob_pathname, error, duration_ms, created_at, updated_at), 2 named indexes (`idx_generations_device_id_created_at`, `idx_generations_created_at`), inferred `Generation` / `NewGeneration` types.
- **`lib/db/index.ts`** — singleton `db` from `neon(process.env.DATABASE_URL!)` + `drizzle(sql, { schema, casing: 'snake_case' })`. Re-exports `schema`. Imports only `@neondatabase/serverless` and `drizzle-orm/neon-http`.
- **`drizzle.config.ts`** — postgresql, schema path, out path `./lib/db/migrations`, `dbCredentials.url = DATABASE_URL_UNPOOLED`, `casing: 'snake_case'`, strict, verbose.
- **`lib/db/migrations/0000_tiresome_squadron_supreme.sql`** — `CREATE TABLE "generations" (...)` with all 13 columns at correct types (jsonb where required, timestamptz with `DEFAULT now()` for both timestamps, no `gen_random_uuid()` default on `id`), plus the two `CREATE INDEX ... DESC NULLS LAST` statements.
- **`package.json` build script** — `"build": "drizzle-kit migrate && next build"`.

## Verification results

| Check | Result |
| ----- | ------ |
| `bunx tsc --noEmit` after Task 1 | clean |
| `bunx drizzle-kit generate` | 1 table, 13 columns, 2 indexes — `0000_tiresome_squadron_supreme.sql` |
| `bunx drizzle-kit migrate` against local Neon dev branch | `[✓] migrations applied successfully!` (idempotent on re-run) |
| Direct introspection (`information_schema.columns` via neon-http) | 13 columns present, types match CONTEXT.md exactly, indexes named correctly |
| `bun run build` | green — kit migrate (no-op, already applied) → `next build` compiled, 5/5 static pages, `/api/generate` listed as dynamic |
| `bunx drizzle-kit studio` | binds to `https://local.drizzle.studio`, HTTP 200 |
| `POST /api/generate` (local) | HTTP 502 — **pre-existing** WaveSpeed-can't-reach-localhost limitation documented in 01-01-SUMMARY.md, not a regression |
| `git diff --stat 2445936..HEAD -- app/ lib/generate.ts` | empty (zero non-DB changes; only new `lib/db/` tree) |

## Deviations from CONTEXT.md / Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `drizzle-kit migrate` hung silently with @neondatabase/serverless driver**
- **Found during:** Task 2
- **Issue:** drizzle-kit's `connect()` flow auto-detects installed packages and prefers `@neondatabase/serverless`. With only the neon driver installed, the spinner advanced for ~10s then exited 1 with no error message. Schema never reached the DB (verified by introspection: only the unrelated `sessions, transcripts` tables were present).
- **Fix:** Installed `pg` + `@types/pg` as devDeps. drizzle-kit's precedence is `pg → postgres → @vercel/postgres → @neondatabase/serverless`, so adding `pg` switches kit to direct TCP via `DATABASE_URL_UNPOOLED` — exactly the connection style CONTEXT.md mandates for kit. Migrate then completed cleanly.
- **Runtime impact:** zero. `lib/db/index.ts` still imports only `@neondatabase/serverless` and `drizzle-orm/neon-http`. `pg` is dev-only.
- **Files modified:** `package.json`, `bun.lock`
- **Commit:** `b496add`

**2. [Rule 3 - Pre-emptive] Added ws + @types/ws as devDeps**
- **Found during:** Task 2 (before installing pg)
- **Why:** drizzle-kit's neon-serverless code path needs a `WebSocket` constructor. Already installed before learning the real fix was `pg`. Kept because (a) it's harmless, (b) it's a documented prereq for any future kit/neon path that does want websocket transport.
- **Files modified:** `package.json`, `bun.lock`
- **Commit:** `b496add` (bundled with the pg fix)

### Locked decisions implemented exactly

Every locked item in CONTEXT.md (Driver, DB Client shape, Schema columns/indexes, drizzle.config.ts shape, Build wiring) implemented verbatim. No CHECK constraint added on `status` (CONTEXT.md marks it as discretionary; skipped to keep the initial migration tiny and additive).

## Phase 1 success criteria status

| ROADMAP criterion | Status |
| ----------------- | ------ |
| 1. `\dt` on Neon production branch shows `generations` | **Pending Task 4-C** (local dev branch confirmed; production branch awaits Vercel deploy) |
| 2. `lib/db/index.ts` imports only HTTP driver — no `pg`/`ws`/`neon-serverless` | ✅ done |
| 3. Vercel preview deploy runs `drizzle-kit migrate` and goes green | **Pending Task 4-C** (build script wired locally; awaits push) |
| 4. `POST /api/generate` still returns a PNG | ✅ unchanged code path; pre-existing 502 on localhost is the same as before this plan |
| 5. `bunx drizzle-kit studio` opens locally | ✅ done |

## Forward note for Phase 2

`import { db, schema } from '@/lib/db'` is now valid. Phase 2 may write rows to `generations` (status='pending', then update to 'complete'/'failed'). Schema is forward-compatible with all Phase 2 + 3 columns. Future migrations must remain additive (CONTEXT.md > Schema-change-during-active-deployment).

## Commits

- `87e8338` feat(01-02): add generations schema, db singleton, drizzle config
- `b496add` feat(01-02): generate + apply initial generations migration
- `0eedd90` feat(01-02): wire drizzle-kit migrate into build script

## Self-Check: PASSED

- lib/db/schema.ts → FOUND
- lib/db/index.ts → FOUND
- drizzle.config.ts → FOUND
- lib/db/migrations/0000_tiresome_squadron_supreme.sql → FOUND
- lib/db/migrations/meta/_journal.json → FOUND
- lib/db/migrations/meta/0000_snapshot.json → FOUND
- commit 87e8338 → FOUND
- commit b496add → FOUND
- commit 0eedd90 → FOUND
