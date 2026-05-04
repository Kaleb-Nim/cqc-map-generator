---
phase: 01-database-foundation
plan: 01
status: complete
date: 2026-05-04
requirements_satisfied: [DB-01, DB-02, DEV-01]
---

# Plan 01-01 Summary — Provisioning + Deps

## What shipped

| Commit | What |
|---|---|
| `e67e288` | `bunx vercel env pull .env.local` — `DATABASE_URL` and `DATABASE_URL_UNPOOLED` (plus `GENERATE_PASSWORD`) populated locally |
| `923ea46` | `bun add @neondatabase/serverless drizzle-orm` + `bun add -d drizzle-kit` |
| `ef7a353` | (housekeeping) renamed plan files to canonical `{phase}-{plan}-PLAN.md` |

User actions completed: Neon Marketplace integration installed on the Vercel project across all 3 scopes (Production, Preview, Development).

## Requirements satisfied

- **DB-01** — Neon provisioned via Vercel Marketplace; both `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) auto-injected.
- **DB-02** — `@neondatabase/serverless` and `drizzle-orm` added as deps; `drizzle-kit` as dev dep. Wiring into `lib/db/` happens in PLAN-02.
- **DEV-01** — `bunx vercel env pull .env.local` works; envs are reachable locally.

## No-regression smoke

Ran `bun dev` + `POST /api/generate`. Result: 502 from the generate route with error `Failed to establish a new connection: localhost:3000/base.jpg`. **This is NOT a regression from this plan** — confirmed by `git diff --stat cec3b66..HEAD app/ lib/` returning empty. Zero application source files were touched.

The 502 is an inherent limitation of running this app locally: the generate flow sends WaveSpeed a base-image URL constructed from the current host, and WaveSpeed's servers cannot reach `http://localhost:3000`. The real "no regression" verification is the Vercel preview deploy at the end of PLAN-02 (Task 4-C, blocking).

## Carried forward to PLAN-02

- `lib/db/index.ts` (singleton via `neon-http`)
- `lib/db/schema.ts` (13 columns + 2 indexes)
- `drizzle.config.ts` (uses `DATABASE_URL_UNPOOLED`)
- Generate + commit initial migration
- Flip `package.json` build script (separate commit, after migration is committed)
- Final smoke + Vercel preview gate

## Notes

- Pre-flight clean: `.env*` already gitignored, Vercel project already linked (`.vercel/project.json` present), Bun 1.x, no `.env.local` collision.
- LOW finding from PLAN-CHECK (F-1, `node -e` → `bun -e`) was not encountered — the verify gate that mentioned `node -e` was never the active check path.
