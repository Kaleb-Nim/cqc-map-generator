# Phase 1 Plan Check — Goal-Backward Verification

**Verdict:** PASS-WITH-MINOR
**Findings:** 0 HIGH · 3 MEDIUM · 4 LOW
**Date:** 2026-05-04
**Plans audited:** PLAN-01-provisioning-and-deps.md, PLAN-02-schema-migrations-and-build.md

---

## 1. Phase 1 Success Criteria → Task Mapping

ROADMAP.md Phase 1 lists 5 success criteria. Each maps to a concrete task that, if executed as written, achieves it.

| # | Success criterion | Achieving task(s) | Status |
|---|---|---|---|
| 1 | `\dt` against Neon production branch shows `generations` with all v1 columns | PLAN-02 Task 2 (apply to local dev branch) + PLAN-02 Task 3 (build-time migrate guarantees prod branch on next deploy) + PLAN-02 Task 4-C (deferred to post-deploy verification) | ACHIEVED |
| 2 | `lib/db/index.ts` imports only `@neondatabase/serverless` + `drizzle-orm/neon-http` — no `pg`/`ws`/`neon-serverless` | PLAN-02 Task 1 (file content locked + verify gate greps for forbidden imports) | ACHIEVED |
| 3 | Fresh Vercel preview runs `drizzle-kit migrate` against its branch DB during build and goes green | PLAN-02 Task 3 (build script change) — committed AFTER Task 2 commits the migration. Verified post-deploy automatically. | ACHIEVED (with MEDIUM caveat — see F-2) |
| 4 | `POST /api/generate` still returns a PNG end-to-end — zero regression | PLAN-01 Task 4 (smoke after deps installed) AND PLAN-02 Task 4-B (smoke after build-script change) | ACHIEVED — both plans smoke. |
| 5 | `bunx drizzle-kit studio` opens locally against the same schema after `bunx vercel env pull` | PLAN-02 Task 4-A (interactive verify) | ACHIEVED |

**No success criterion is unachieved.**

---

## 2. Requirement Coverage (12 IDs)

| Requirement | Plan-Task | Notes |
|---|---|---|
| DB-01 | 01-Task 1 | Vercel Marketplace provisioning checkpoint |
| DB-02 | 01-Task 3 (dep install) + 02-Task 1 (wiring in `lib/db/index.ts`) | Split is correct — install in plan 01, import in plan 02 |
| DB-03 | 02-Task 1 | `const sql = neon(...)`, `export const db = drizzle(sql, ...)` at module scope |
| DB-04 | 02-Task 1 | `pgTable('generations', ...)` w/ all 13 columns. **NOTE:** REQUIREMENTS.md DB-04 says "two tables: `generations` and (implicit) per-device aggregates derivable via SQL" — second one is a derivable view, no DDL needed. Plans correctly only create `generations`. |
| DB-05 | 02-Task 1 | `drizzle.config.ts` uses `DATABASE_URL_UNPOOLED` (verify gate confirms) |
| DB-06 | 02-Task 2 | Migration generated, applied locally, staged for git |
| DB-07 | 02-Task 3 | `"build": "drizzle-kit migrate && next build"` |
| SCH-01 | 02-Task 1 | `prompt_inputs jsonb`, `prompt text`, `model_params jsonb` |
| SCH-02 | 02-Task 1 | `device_id`, `status`, `duration_ms`, `created_at`, `updated_at` |
| SCH-03 | 02-Task 1 | `id uuid PK`, `blob_url`, `blob_pathname`, indexes on `(device_id, created_at desc)` and `(created_at desc)` |
| SCH-04 | 02-Task 1+2 | Initial migration is purely additive (CREATE TABLE + CREATE INDEX). All Phase 2/3 nullable columns already present so future migrations stay additive. |
| DEV-01 | 01-Task 2 | `bunx vercel env pull .env.local` checkpoint |

**12/12 covered. No orphans. No double counts. No leakage to DEV-02 (Phase 3) or any Phase 2/3 ID.**

---

## 3. Phase Boundary Compliance

- No app code reads/writes DB. PLAN-02 pre-flight step 5 explicitly checks `grep -r "@/lib/db" app/` returns empty after the plan ships, and PLAN-02 Task 4-B re-asserts this. PASS.
- No cookie/identity work. PASS.
- No Vercel Blob work. PASS.
- No UI changes. PASS.
- Schema is forward-compatible: all 13 columns from CONTEXT.md present, `device_id NOT NULL` with no default (Phase 1 doesn't insert), `blob_*` and `wavespeed_task_id` and `error` and `duration_ms` all nullable for Phase 2/3 inserts/updates. PASS.

---

## 4. Pooled vs Unpooled URL Discipline

| Caller | URL | Where enforced |
|---|---|---|
| App runtime (`lib/db/index.ts`) | `DATABASE_URL` (pooled) | PLAN-02 Task 1 action + verify gate |
| `drizzle.config.ts` | `DATABASE_URL_UNPOOLED` | PLAN-02 Task 1 action + verify gate (`grep -q "DATABASE_URL_UNPOOLED" drizzle.config.ts`) |
| `psql` ad-hoc | `DATABASE_URL_UNPOOLED` | PLAN-02 Task 2 action |
| `drizzle-kit migrate` (build & local) | `DATABASE_URL_UNPOOLED` (via config) | PLAN-02 Task 3 |

PLAN-01 Task 2 verifies pull put the pooled URL with `-pooler` and the unpooled without. PASS — strongest possible enforcement.

---

## 5. Build-Script Ordering Trap

The risk: if `package.json` build script changes to `drizzle-kit migrate && next build` BEFORE the initial migration is committed, the next preview deploy runs migrate against an empty migrations dir on a fresh Neon branch — migrate succeeds (no-op), but Phase 2 code that comes later races against deploys.

**How the plans guard against it:**
- PLAN-02 Task 2 generates AND applies AND `git add`s the migration files.
- PLAN-02 Task 2 done-criteria: "Files staged for commit."
- PLAN-02 Task 3 explicitly states the ordering rule in its action: *"Critical ordering: this MUST happen AFTER Task 2 committed the migration file."*
- Task 3 is a separate task (separate commit) AFTER Task 2, so the ordering is structurally enforced by task numbering.

PASS — but see F-3 below for one residual gap.

---

## 6. Bun Discipline

Searched both plans for `npm`, `npx`, `node` invocations:

- PLAN-01 Task 3 verify gate uses `node -e '...'` to validate the major version of `@neondatabase/serverless`. **F-1 (LOW) — uses `node` instead of `bun`.** Per AGENTS.md / global CLAUDE.md, this should be `bun -e`.
- All other commands are `bun add`, `bun run`, `bunx`, `bun dev`. PASS otherwise.

---

## 7. No-Regression Smoke Coverage

ROADMAP success criterion 4 (zero regression on `/api/generate`) is the most easily forgotten. Both plans include it:

- PLAN-01 Task 4: full POST + `file` check after deps install.
- PLAN-02 Task 4-B: same check after build-script change.

This is correct — the dep install in PLAN-01 could theoretically pull in a transitive that breaks the existing build, and the build-script change in PLAN-02 changes what `bun run build` does. Two independent regression points → two smokes. PASS.

PLAN-01 pre-flight also calls for an *initial baseline* smoke, with a graceful skip if `GENERATE_PASSWORD` isn't yet in `.env.local`. Reasonable.

---

## 8. Atomicity (one task = one commit)

- PLAN-01: Tasks 1, 2, 4 are checkpoints (no commit). Task 3 is the only auto task → single dep-install commit. PASS.
- PLAN-02: Task 1 (3 source files) = one commit. Task 2 (migration files) = one commit (or folded with Task 1, but the plan stages explicitly via `git add lib/db/migrations`). Task 3 (`package.json`) = one commit. Task 4 = no commit. PASS.

The Task 1 vs Task 2 commit boundary is a little ambiguous (Task 2's done says "Files staged for commit" but doesn't enforce a separate commit). See F-4.

---

## 9. Findings

| # | Severity | Where | What's wrong | Fix |
|---|---|---|---|---|
| F-1 | LOW | PLAN-01 Task 3 verify `<automated>` block | Uses `node -e '...'` to inspect `package.json`. Project rule is bun-only. | Replace with `bun -e '...'` (Bun's `-e` flag accepts the same JS string). |
| F-2 | MEDIUM | PLAN-02 Task 4-C ("deferred to actual Vercel deploy") | Success criterion 1 (`\dt` on production branch) and criterion 3 (preview deploy goes green with migrate) are explicitly *not* verified during plan execution — they're handed off to "the next push". If the user merges PLAN-02 without pushing, Phase 1 is silently incomplete. | Add a final blocking checkpoint task: "After commit, push to a preview branch, wait for Vercel preview to go green, run `\dt` on the preview Neon branch via the Neon dashboard SQL editor, paste output back." Or at minimum, mark the phase as NOT COMPLETE until this is done in the SUMMARY. |
| F-3 | MEDIUM | PLAN-02 Task 2 / Task 3 commit ordering | Task 2 says "Files staged for commit" but doesn't actually commit. Task 3 modifies `package.json` and verifies via `bun run build`. If executor stages everything across Tasks 1+2+3 and commits once at the end, a partial revert (just `package.json`) would leave migrations un-committed too — and the ordering safety story (migrations land in a deploy *before* the build script change) collapses if both ship in the same commit anyway, since a single deploy carries both. The safety claim in the Task 3 action is therefore aspirational unless commits are actually split. | Either (a) explicitly require a commit between Task 2 and Task 3 ("Task 2 done = `git commit` of migration files; Task 3 begins on a clean tree"), or (b) accept that both ship in the same deploy and remove the misleading "Migration-first, build-script-second is the safe order" claim. (a) is preferred because it matches the safety reasoning. |
| F-4 | MEDIUM | PLAN-02 Task 1 verify gate (`grep` for column count) | The grep `grep -c "device_id\|status\|..."` counts *occurrences in any context* (comments, type aliases) not column declarations. A schema file with the right column names mentioned only in a docstring would pass. | Replace with a runtime check: `bunx tsx -e "import { generations } from './lib/db/schema'; console.log(Object.keys(generations._.columns).length)"` and require `>= 13`. Or assert specific exported column-key names. |
| F-5 | LOW | PLAN-02 Task 1 verify | The double-negative grep `! grep -E "DATABASE_URL[^_]" drizzle.config.ts \| grep -v UNPOOLED \| grep -q DATABASE_URL` is hard to reason about and can falsely pass/fail on edge whitespace. | Simpler: `! grep -E '\\bDATABASE_URL\\b(?!_UNPOOLED)' drizzle.config.ts` (or ripgrep equivalent) — matches `DATABASE_URL` only when not followed by `_UNPOOLED`. |
| F-6 | LOW | PLAN-02 Task 2 action — `--bun` flag | `bunx --bun drizzle-kit generate` forces Bun's runtime, which has historically had issues with drizzle-kit's `tsx` shimming for loading `drizzle.config.ts`. Plan offers fallbacks but not in priority order. | Recommend leading with `set -a; source .env.local; set +a; bunx drizzle-kit generate` (works without `--bun`) and demote `--bun` to the fallback. |
| F-7 | LOW | PLAN-02 Task 4-A — drizzle-kit studio | Studio is a foreground process; the verify recipe says "Close studio" but doesn't tell the executor how (it's `Ctrl+C` in the shell that started it). For a non-autonomous human-verify task it's fine, but worth a one-line note. | Add: "Press Ctrl+C in the studio terminal when done." |

**No HIGH findings.** No blocker prevents the phase goal from being achieved if the plans are executed as written.

---

## 10. CONTEXT.md Decision Compliance

Every LOCKED decision in CONTEXT.md is honored:

- Driver: `@neondatabase/serverless@^1.x` + `drizzle-orm/neon-http` — PLAN-01 Task 3 + PLAN-02 Task 1. PASS.
- No `neonConfig.fetchConnectionCache = true` — PLAN-02 Task 1 file content omits it. PASS.
- DB client shape exactly matches CONTEXT.md `<DB Client>` section — PLAN-02 `<interfaces>` block embeds the locked snippet verbatim. PASS.
- Schema columns: all 13 present with correct types/nullability. PASS.
- Indexes: both `(device_id, created_at desc)` and `(created_at desc)` named explicitly. PASS.
- `drizzle.config.ts`: dialect, schema path, out path, `DATABASE_URL_UNPOOLED`, `casing: 'snake_case'`. PASS.
- Migrations under `lib/db/migrations/` and committed. PASS.
- Build script `drizzle-kit migrate && next build`. PASS.
- Provisioning via Vercel Marketplace, all three scopes. PASS.
- `.env.local` confirmed gitignored via existing `.env*` pattern. PASS — neither plan re-adds the pattern (CONTEXT.md pre-flight forbade duplicates).

No deferred ideas leaked in (CHECK constraint on status correctly skipped per "Claude's discretion"; no `lib/db/README.md` added — fine, it's discretionary).

---

## 11. Summary

The two plans, executed as written and in order, will achieve every Phase 1 success criterion in ROADMAP.md and cover every one of the 12 in-scope requirements. No HIGH findings. The MEDIUM findings are real but bounded:

- F-2 (post-deploy verification gap) is the most consequential — fixable by adding one checkpoint task at the end of PLAN-02.
- F-3 (commit ordering) makes the "safe order" claim only true if executor splits commits — fixable by explicit instruction.
- F-4 (verify gate's grep is too lax) is a quality issue, not a correctness one — the schema content itself is locked verbatim in the action body, so the lax verify won't actually let a wrong schema slip through unless the executor diverges from the locked snippet.

Recommended: address F-2 (post-deploy `\dt` checkpoint) before execution. Others can be fixed in-flight or noted in the SUMMARY.

