# Phase 1: Database Foundation - Context

**Gathered:** 2026-05-04
**Status:** Ready for planning
**Source:** Lifted from project-init questioning + project-level research; no separate discuss-phase

<domain>
## Phase Boundary

This phase **only** sets up the data layer. It does **not** wire any DB writes into the existing generation flow (that's Phase 2/3). At the end of this phase:

- Neon Postgres is provisioned via Vercel Marketplace.
- Drizzle ORM (with the `neon-http` HTTP driver) is wired and exports a singleton `db`.
- The `generations` table schema exists in `lib/db/schema.ts`.
- An initial migration is generated and committed to git.
- `drizzle-kit migrate` runs as part of the Vercel build, applying migrations to whichever Neon branch the deployment is bound to.
- `bunx drizzle-kit studio` works locally against `.env.local` populated by `vercel env pull`.

The existing `POST /api/generate` flow MUST continue to return PNGs unchanged. No DB reads or writes from app code yet — the table just exists, empty.

</domain>

<decisions>
## Implementation Decisions (LOCKED)

### Driver
- Use `@neondatabase/serverless@^1.x` — HTTP driver only.
- Use `drizzle-orm/neon-http` adapter (not `neon-serverless`, not `pg`).
- Reason: Fluid Compute reuses function instances across concurrent requests. HTTP driver is stateless per query (no socket pool, no `ws` polyfill, no `pool.end()`) and "just works" with module-scope singletons.
- Do **not** set `neonConfig.fetchConnectionCache = true` — it's a no-op in v1.x (default on, deprecated).

### DB Client
- Singleton `db` at module scope in `lib/db/index.ts`.
- Construct as: `const sql = neon(process.env.DATABASE_URL!); export const db = drizzle(sql, { schema, casing: 'snake_case' });`
- Re-export `schema` for convenience.

### Schema (`generations` table)
Columns required by Phases 2/3 — schema must support all of them now so migrations stay additive later:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | row id, generated app-side via `crypto.randomUUID()` |
| `device_id` | `text NOT NULL` | written in Phase 2 — keep NOT NULL with no default; Phase 1 doesn't insert anything, so no rows exist yet |
| `status` | `text NOT NULL` | one of `pending`, `complete`, `failed`. CHECK constraint optional but recommended. |
| `prompt_inputs` | `jsonb NOT NULL` | the user-facing `Values` object that produced the prompt |
| `prompt` | `text NOT NULL` | the rendered prompt sent to gpt-image-2 |
| `model_params` | `jsonb` | resolution/quality/aspect/etc. |
| `wavespeed_task_id` | `text` | nullable — set after WaveSpeed accepts submit |
| `blob_url` | `text` | nullable until Phase 3 |
| `blob_pathname` | `text` | nullable until Phase 3; needed for future cleanup |
| `error` | `text` | nullable; populated on failure |
| `duration_ms` | `integer` | nullable until terminal status |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | bump in Phase 2/3 on UPDATE |

Indexes: `(device_id, created_at desc)` for "this device's history" queries; `(created_at desc)` for global recency.

### `drizzle.config.ts`
- `schema: './lib/db/schema.ts'`
- `out: './lib/db/migrations'`
- `dialect: 'postgresql'`
- `dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED! }` — **MUST** be the unpooled URL. Pooled URL goes through PgBouncer which breaks prepared statements that drizzle-kit relies on for introspection/migrate.
- `casing: 'snake_case'` to match the table column convention above.

### Migrations
- Generated via `bunx drizzle-kit generate` and committed to git under `lib/db/migrations/`.
- Applied via `bunx drizzle-kit migrate` (programmatic, no shell prompt) at Vercel build time and locally on demand.
- All future migrations MUST be backwards-compatible with the previous deploy (additive columns first; column drops in a separate later deploy).

### Build wiring
- `package.json` `build` script becomes: `drizzle-kit migrate && next build`.
- This ensures every Vercel deploy (preview + production) applies pending migrations against the Neon branch the deployment is bound to before Next builds.

### Provisioning
- Use Vercel Marketplace → Storage → Neon. Choose Neon free tier.
- Auto-provisioned env vars on the project (Production + Preview + Development scopes):
  - `DATABASE_URL` (pooled, via PgBouncer) — used by app runtime
  - `DATABASE_URL_UNPOOLED` (direct) — used by drizzle-kit
  - Plus `PG*` and legacy `POSTGRES_*` aliases (ignore)
- Local dev: `bunx vercel env pull .env.local`. Add `.env.local` to `.gitignore` if not already there.

### Out of scope for this phase (locked, do not creep)
- Reading or writing rows from app code (Phase 2/3).
- Any cookie / identity logic (Phase 2).
- Any Vercel Blob work (Phase 3).
- Any UI changes — including `/history`, `/admin`, or stats display (v2).
- Background jobs, cleanup, retention.

### Claude's Discretion
- Exact migration filename / hash format (drizzle-kit defaults are fine).
- Whether to add a CHECK constraint on `status` (nice-to-have, not required).
- Index naming (drizzle defaults are fine).
- Whether to add a tiny `lib/db/README.md` documenting the dev workflow (nice-to-have).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `.planning/PROJECT.md` — project framing, locked decisions
- `.planning/REQUIREMENTS.md` — full v1 requirement list (this phase covers DB-01..07, SCH-01..04, DEV-01)
- `.planning/ROADMAP.md` — full milestone, especially Phase 2/3 so schema is forward-compatible

### Codebase map
- `.planning/codebase/STACK.md` — versions in play
- `.planning/codebase/ARCHITECTURE.md` — current submit/poll request flow (don't break it)
- `.planning/codebase/STRUCTURE.md` — where things live; `lib/` is the right home for `db/`

### Research
- `.planning/research/neon-drizzle.md` — driver choice, schema layout, drizzle-kit gotchas, PgBouncer trap, preview-branch behaviour. **Authoritative for this phase.**

### Next.js 16 docs
- `node_modules/next/dist/docs/` — consult before writing any Next-specific code (per `AGENTS.md`)

</canonical_refs>

<specifics>
## Specific Concrete Items

- File paths to create:
  - `lib/db/index.ts` (~10 lines)
  - `lib/db/schema.ts` (~40 lines)
  - `drizzle.config.ts` (project root, ~15 lines)
  - `lib/db/migrations/0000_*.sql` (drizzle-kit generated)
  - `lib/db/migrations/meta/` (drizzle-kit generated)
- Files to modify:
  - `package.json` — add deps + change `build` script
  - `.gitignore` — confirm `.env.local` is ignored
  - Possibly `next.config.ts` — only if needed to mark Drizzle as external for serverless build (research says no, but verify on first build)

</specifics>

<deferred>
## Deferred Ideas

- CHECK constraint on `status` enum — nice but not required.
- Tiny `lib/db/README.md` for dev workflow — could be folded into project README in Phase 3 (DEV-02).
- Splitting schema into multiple files — not warranted with one table.
- Seeding script — no useful seed data exists.

</deferred>

---

*Phase: 01-database-foundation*
*Context gathered: 2026-05-04*
