---
phase: 01-database-foundation
plan: 02
type: execute
wave: 2
depends_on: [01-database-foundation/01]
files_modified:
  - drizzle.config.ts
  - lib/db/index.ts
  - lib/db/schema.ts
  - lib/db/migrations/0000_*.sql
  - lib/db/migrations/meta/_journal.json
  - lib/db/migrations/meta/0000_snapshot.json
  - package.json
autonomous: false
requirements: [DB-03, DB-04, DB-05, DB-06, DB-07, SCH-01, SCH-02, SCH-03, SCH-04]

must_haves:
  truths:
    - "drizzle.config.ts at repo root points at lib/db/schema.ts and uses DATABASE_URL_UNPOOLED (not DATABASE_URL)"
    - "lib/db/schema.ts defines a `generations` pgTable with EVERY column listed in CONTEXT.md > Schema (id, device_id, status, prompt_inputs, prompt, model_params, wavespeed_task_id, blob_url, blob_pathname, error, duration_ms, created_at, updated_at) at the correct types"
    - "lib/db/index.ts exports a singleton `db` constructed from `neon(process.env.DATABASE_URL!)` + `drizzle(sql, { schema, casing: 'snake_case' })` AND re-exports `* as schema`"
    - "lib/db/index.ts imports ONLY from `@neondatabase/serverless` and `drizzle-orm/neon-http` — no `pg`, no `ws`, no `drizzle-orm/neon-serverless`"
    - "An initial migration file lib/db/migrations/0000_*.sql exists, is committed, and creates the `generations` table with the two indexes specified in CONTEXT.md"
    - "`bunx drizzle-kit migrate` applied the migration to the local Neon dev branch successfully (verifiable via `\\dt` showing `generations`)"
    - "package.json `build` script is `drizzle-kit migrate && next build` (in that order)"
    - "`bun run build` completes successfully against the local Neon dev branch with the new build script"
    - "`bunx drizzle-kit studio` opens and shows the empty `generations` table"
    - "POST /api/generate STILL returns a PNG with the new build script — zero regression"
  artifacts:
    - path: "drizzle.config.ts"
      provides: "drizzle-kit config — schema path, migrations out-dir, dialect, unpooled URL, snake_case"
      contains: "DATABASE_URL_UNPOOLED"
    - path: "lib/db/schema.ts"
      provides: "Drizzle pgTable definitions; all 13 columns of `generations`; indexes on (device_id, created_at desc) and (created_at desc)"
      contains: "generations"
      min_lines: 35
    - path: "lib/db/index.ts"
      provides: "Singleton `db` Drizzle client over neon-http; re-exports schema"
      contains: "neon-http"
      min_lines: 6
    - path: "lib/db/migrations/0000_*.sql"
      provides: "Initial DDL creating `generations` + indexes"
      contains: "CREATE TABLE"
    - path: "package.json"
      provides: "Build script that runs migrations before next build"
      contains: "drizzle-kit migrate && next build"
  key_links:
    - from: "drizzle.config.ts"
      to: "DATABASE_URL_UNPOOLED env var"
      via: "process.env access in dbCredentials.url"
      pattern: "DATABASE_URL_UNPOOLED"
    - from: "lib/db/index.ts"
      to: "DATABASE_URL env var"
      via: "neon(process.env.DATABASE_URL!)"
      pattern: "process\\.env\\.DATABASE_URL"
    - from: "lib/db/index.ts"
      to: "lib/db/schema.ts"
      via: "import * as schema from './schema'"
      pattern: "from ['\"]\\./schema['\"]"
    - from: "package.json build script"
      to: "lib/db/migrations/"
      via: "drizzle-kit migrate reads drizzle.config.ts -> out dir"
      pattern: "drizzle-kit migrate"
---

<objective>
Land the **schema, the singleton DB client, the initial migration, and the build-time migrate hook** for Phase 1. After this plan: the `generations` table exists in the Neon dev branch (and will exist in any Vercel preview/prod branch on next deploy), the schema includes every column Phases 2 & 3 depend on, and `bunx drizzle-kit studio` works locally.

This plan does NOT write any rows. The table sits empty. App code does not import `db` anywhere. That's strictly Phase 2/3 territory per CONTEXT.md > Out of Scope.

Purpose: Phase 2 (submit-side writes) and Phase 3 (blob + completion writes) both need this schema present and the `db` export wired. They also both need the build-step migrate so each Vercel deploy auto-applies new migrations against the deploy's branch DB.

Output: `drizzle.config.ts`, `lib/db/{index,schema}.ts`, `lib/db/migrations/0000_*.sql` + meta, modified `package.json` build script. Migration applied to local Neon dev branch; smoke-tested that the existing generate flow is unchanged.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/01-database-foundation/CONTEXT.md
@.planning/phases/01-database-foundation/01-01-SUMMARY.md
@.planning/research/neon-drizzle.md
@.planning/codebase/STACK.md
@.planning/codebase/STRUCTURE.md
@.planning/codebase/ARCHITECTURE.md
@package.json
@app/api/generate/route.ts
@tsconfig.json

<interfaces>
<!-- Locked decisions from CONTEXT.md, embedded here so the executor doesn't need to re-derive them. -->

### lib/db/index.ts shape (LOCKED in CONTEXT.md > DB Client)

```ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema, casing: 'snake_case' });
export { schema };
```

That is the entire file. Do not add a connection pool, do not set `neonConfig.*`, do not import from `drizzle-orm/neon-serverless`.

### drizzle.config.ts shape (LOCKED in CONTEXT.md > drizzle.config.ts)

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED!,  // UNPOOLED — pooled URL breaks prepared statements via PgBouncer
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
```

### lib/db/schema.ts — full column spec (LOCKED in CONTEXT.md > Schema)

| Column | Drizzle type | SQL type | Nullability / default |
|---|---|---|---|
| id | uuid('id').primaryKey() | uuid PRIMARY KEY | NOT NULL, app-generated via crypto.randomUUID() — no .defaultRandom() needed |
| device_id | text('device_id').notNull() | text NOT NULL | NOT NULL, no default |
| status | text('status').notNull() | text NOT NULL | NOT NULL, no default. CHECK constraint optional (Claude's discretion). |
| prompt_inputs | jsonb('prompt_inputs').notNull() | jsonb NOT NULL | NOT NULL |
| prompt | text('prompt').notNull() | text NOT NULL | NOT NULL |
| model_params | jsonb('model_params') | jsonb | nullable |
| wavespeed_task_id | text('wavespeed_task_id') | text | nullable |
| blob_url | text('blob_url') | text | nullable |
| blob_pathname | text('blob_pathname') | text | nullable |
| error | text('error') | text | nullable |
| duration_ms | integer('duration_ms') | integer | nullable |
| created_at | timestamp('created_at', { withTimezone: true }).notNull().defaultNow() | timestamptz NOT NULL DEFAULT now() | NOT NULL, default now() |
| updated_at | timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() | timestamptz NOT NULL DEFAULT now() | NOT NULL, default now() (Phase 2/3 will update on UPDATE) |

Indexes (Drizzle's `index(...).on(...).desc()` API in schema's `(table) => [...]` callback):
- `idx_generations_device_id_created_at` on `(device_id, created_at DESC)`
- `idx_generations_created_at` on `(created_at DESC)`

`casing: 'snake_case'` in both `drizzle.config.ts` AND the `db` constructor means TS field names can be camelCase if you prefer (e.g. `deviceId`) — drizzle will translate to `device_id` in SQL. CONTEXT.md uses snake_case column names explicitly; pass column names explicitly as snake_case strings to `text(...)`/`uuid(...)`/etc to be safe and to keep the migration SQL exactly matching CONTEXT.md.

Export inferred types at the bottom of schema.ts:
```ts
export type Generation = typeof generations.$inferSelect;
export type NewGeneration = typeof generations.$inferInsert;
```

### Build script change (LOCKED in CONTEXT.md > Build wiring)

Current: `"build": "next build"`
New:     `"build": "drizzle-kit migrate && next build"`

`drizzle-kit migrate` is programmatic (no shell prompt). It reads `drizzle.config.ts` -> `DATABASE_URL_UNPOOLED` -> applies pending migrations from `lib/db/migrations/`.
</interfaces>
</context>

<pre_flight>
Before any task, the executor MUST:
1. Confirm PLAN-01 is complete: `.env.local` exists with both `DATABASE_URL` and `DATABASE_URL_UNPOOLED`, and `package.json` lists the three deps. If not, STOP and run PLAN-01 first.
2. Re-read `.planning/phases/01-database-foundation/CONTEXT.md` Schema + drizzle.config.ts + DB Client + Build wiring sections.
3. Re-read `.planning/research/neon-drizzle.md` section 2 (Drizzle setup) and section 5 (Pitfalls — especially "Pooler vs unpooled mismatch" and "Schema-change-during-active-deployment").
4. Skim `node_modules/next/dist/docs/` for any Next-16-specific note about prepended commands in `build` (per AGENTS.md). The `&&`-prefix pattern is standard Vercel-supported usage; only investigate further if the build fails.
5. Confirm `app/api/generate/route.ts` does NOT import from `@/lib/db` anywhere — this plan must NOT add such imports. (`grep -r "@/lib/db" app/ lib/` should return nothing after this plan ships, except in `lib/db/index.ts` itself.)
</pre_flight>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Define schema, db singleton, and drizzle config</name>
  <files>lib/db/schema.ts, lib/db/index.ts, drizzle.config.ts</files>
  <action>
    Create three files exactly per the `<interfaces>` block above. Order matters — schema first (pure types), then db client (imports schema), then config (imports nothing app-side, just sets paths).

    **1. `lib/db/schema.ts`** (~40 lines):
    ```ts
    import { pgTable, uuid, text, jsonb, integer, timestamp, index } from 'drizzle-orm/pg-core';

    export const generations = pgTable(
      'generations',
      {
        id: uuid('id').primaryKey(),
        deviceId: text('device_id').notNull(),
        status: text('status').notNull(),
        promptInputs: jsonb('prompt_inputs').notNull(),
        prompt: text('prompt').notNull(),
        modelParams: jsonb('model_params'),
        wavespeedTaskId: text('wavespeed_task_id'),
        blobUrl: text('blob_url'),
        blobPathname: text('blob_pathname'),
        error: text('error'),
        durationMs: integer('duration_ms'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      },
      (t) => [
        index('idx_generations_device_id_created_at').on(t.deviceId, t.createdAt.desc()),
        index('idx_generations_created_at').on(t.createdAt.desc()),
      ],
    );

    export type Generation = typeof generations.$inferSelect;
    export type NewGeneration = typeof generations.$inferInsert;
    ```

    Notes:
    - TS field names are camelCase (`deviceId`); SQL column names are snake_case (`device_id`) — explicitly passed to each column constructor so the generated SQL matches CONTEXT.md exactly regardless of `casing` setting.
    - CHECK constraint on `status` is "Claude's discretion" (CONTEXT.md > deferred). Skip it for the initial migration — keeps the migration tiny and additive. Can be added later in a separate migration.
    - Index names are explicit (not Drizzle defaults) so they are stable across schema reads.

    **2. `lib/db/index.ts`** (~7 lines):
    ```ts
    import { neon } from '@neondatabase/serverless';
    import { drizzle } from 'drizzle-orm/neon-http';
    import * as schema from './schema';

    const sql = neon(process.env.DATABASE_URL!);
    export const db = drizzle(sql, { schema, casing: 'snake_case' });
    export { schema };
    ```

    Do NOT add `if (!process.env.DATABASE_URL) throw ...` — the `!` non-null assertion is enough; runtime will throw on first query if env is missing. This file is a module-scope singleton, evaluated lazily on first import.

    **3. `drizzle.config.ts`** at repo root (~17 lines):
    ```ts
    import { defineConfig } from 'drizzle-kit';

    export default defineConfig({
      dialect: 'postgresql',
      schema: './lib/db/schema.ts',
      out: './lib/db/migrations',
      dbCredentials: {
        url: process.env.DATABASE_URL_UNPOOLED!,
      },
      casing: 'snake_case',
      strict: true,
      verbose: true,
    });
    ```

    drizzle-kit auto-loads `.env.local` via Next's loader pattern when run from a Next 16 project root — verified by the smoke step in Task 2. If the env doesn't load (very unlikely with the standard Next 16 + Bun setup), fall back to invoking via `bunx --env-file=.env.local drizzle-kit ...` rather than adding `dotenv` as a dep.

    Do NOT yet run `drizzle-kit generate` — that's Task 2.
  </action>
  <verify>
    <automated>
      cd /Users/kalebnim/Documents/GitHub/run-map-generator && \
      test -f lib/db/schema.ts && test -f lib/db/index.ts && test -f drizzle.config.ts && \
      grep -q "drizzle-orm/neon-http" lib/db/index.ts && \
      grep -q "@neondatabase/serverless" lib/db/index.ts && \
      ! grep -qE "(neon-serverless|from 'pg'|from \"pg\"|require\\('pg'\\)|from 'ws'|from \"ws\")" lib/db/index.ts && \
      grep -q "DATABASE_URL_UNPOOLED" drizzle.config.ts && \
      ! grep -E "DATABASE_URL[^_]" drizzle.config.ts | grep -v UNPOOLED | grep -q DATABASE_URL && \
      grep -c "device_id\|status\|prompt_inputs\|prompt\|model_params\|wavespeed_task_id\|blob_url\|blob_pathname\|error\|duration_ms\|created_at\|updated_at" lib/db/schema.ts | awk '$1 >= 12 {exit 0} {exit 1}' && \
      bunx tsc --noEmit
    </automated>
  </verify>
  <done>
    Three files exist with correct content. TypeScript compiles cleanly with no new errors. No forbidden imports (pg / ws / neon-serverless). drizzle.config.ts uses `DATABASE_URL_UNPOOLED` exclusively (pooled `DATABASE_URL` reference would be a bug).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Generate initial migration and apply to local Neon dev branch</name>
  <files>lib/db/migrations/0000_*.sql, lib/db/migrations/meta/_journal.json, lib/db/migrations/meta/0000_snapshot.json</files>
  <action>
    Generate the migration from the schema diff (empty DB -> the `generations` table). Since `drizzle.config.ts` reads `process.env.DATABASE_URL_UNPOOLED` and Next 16 / Bun won't auto-load `.env.local` for arbitrary CLI invocations, use Bun's `--env-file` flag:

    ```bash
    cd /Users/kalebnim/Documents/GitHub/run-map-generator
    bunx --bun drizzle-kit generate
    ```

    If the above fails with "DATABASE_URL_UNPOOLED is undefined" (it tries to introspect even on first generate), fall back to:
    ```bash
    bun --env-file=.env.local x drizzle-kit generate
    ```
    or set inline:
    ```bash
    set -a; source .env.local; set +a; bunx drizzle-kit generate
    ```

    Expected output: drizzle-kit prints something like:
    ```
    1 tables
    generations 13 columns 2 indexes 0 fks
    [✓] Your SQL migration file ➜ lib/db/migrations/0000_<adjective_noun>.sql 🚀
    ```

    Open the generated `lib/db/migrations/0000_*.sql` and verify by eye that:
    - `CREATE TABLE "generations"` includes all 13 columns with correct types.
    - `id uuid PRIMARY KEY NOT NULL` (no `DEFAULT gen_random_uuid()` — app-side generation per CONTEXT.md).
    - `created_at timestamp with time zone DEFAULT now() NOT NULL` and same for `updated_at`.
    - Two `CREATE INDEX` statements at the bottom for the indexes named `idx_generations_device_id_created_at` and `idx_generations_created_at`, each ending with `DESC` on `created_at`.
    - `prompt_inputs` and `model_params` are `jsonb` (NOT `json`).

    If anything looks wrong, `rm -rf lib/db/migrations` and revisit Task 1's schema before regenerating. Never hand-edit the generated SQL — re-generate from schema.

    Then **apply the migration to the local Neon dev branch**:
    ```bash
    set -a; source .env.local; set +a; bunx drizzle-kit migrate
    ```

    Expected output: `[✓] migrations applied successfully!` (or `[i] No migrations to apply` on a re-run).

    Verify against the actual DB. The Neon dev branch is the same DB whether you query via pooled or unpooled URL; use the unpooled URL for `psql` to avoid prepared-statement issues during ad-hoc queries:
    ```bash
    set -a; source .env.local; set +a; \
      psql "$DATABASE_URL_UNPOOLED" -c "\dt" | grep generations && \
      psql "$DATABASE_URL_UNPOOLED" -c "\d generations"
    ```
    The first command must show the `generations` table; the second must list all 13 columns plus the two indexes.

    If `psql` is not installed locally, substitute with drizzle-kit studio (`bunx drizzle-kit studio` -> open http://local.drizzle.studio -> confirm `generations` shows in left nav with the right columns) AND use the Neon SQL Editor in the Vercel/Neon dashboard.

    Stage AND commit the migration files for git — this commit boundary is load-bearing for the safety story in Task 3:
    ```bash
    git add lib/db/schema.ts lib/db/index.ts drizzle.config.ts lib/db/migrations
    git commit -m "feat(db): add generations schema + initial migration"
    ```
    Task 3 MUST start on a clean tree. If you bundle Task 2 + Task 3 into one commit, both ship in the same deploy and the "migration-first" claim collapses — split the commits.
  </action>
  <verify>
    <automated>
      cd /Users/kalebnim/Documents/GitHub/run-map-generator && \
      ls lib/db/migrations/0000_*.sql 1>/dev/null 2>&1 && \
      test -f lib/db/migrations/meta/_journal.json && \
      test -f lib/db/migrations/meta/0000_snapshot.json && \
      grep -q 'CREATE TABLE "generations"' lib/db/migrations/0000_*.sql && \
      grep -q 'jsonb' lib/db/migrations/0000_*.sql && \
      grep -q 'idx_generations_device_id_created_at' lib/db/migrations/0000_*.sql && \
      grep -q 'idx_generations_created_at' lib/db/migrations/0000_*.sql && \
      grep -cE '^\s*"(id|device_id|status|prompt_inputs|prompt|model_params|wavespeed_task_id|blob_url|blob_pathname|error|duration_ms|created_at|updated_at)"' lib/db/migrations/0000_*.sql | awk '$1 >= 13 {exit 0} {exit 1}'
    </automated>
  </verify>
  <done>
    Migration generated, looks correct (all 13 columns + 2 indexes + jsonb types + DESC ordering), applied successfully to local Neon dev branch, and `\dt` confirms the table exists. Files staged for commit.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Wire drizzle-kit migrate into the build script</name>
  <files>package.json</files>
  <action>
    Update `package.json` `build` script from:
    ```json
    "build": "next build",
    ```
    to:
    ```json
    "build": "drizzle-kit migrate && next build",
    ```

    Critical ordering: this MUST happen AFTER Task 2 committed the migration file. If the build script changes first and gets deployed, Vercel's `next build` step would invoke `drizzle-kit migrate` against an empty migrations dir — drizzle-kit will succeed (nothing to apply), but no schema would exist on the new branch DB and Phase 2 would then ship migrations that race against the deploy. Migration-first, build-script-second is the safe order.

    Note: `drizzle-kit` is in `devDependencies`. Vercel installs devDependencies during build by default (it runs `bun install` without `--production`), so the binary is on PATH. No additional config needed.

    Do NOT change `dev`, `start`, or `lint` scripts.

    Do NOT add `"db:generate"` / `"db:migrate"` / `"db:studio"` convenience scripts in this plan — they're nice-to-have but not in CONTEXT.md and would expand scope. The user can run `bunx drizzle-kit ...` directly per the dev workflow already in research/neon-drizzle.md.
  </action>
  <verify>
    <automated>
      cd /Users/kalebnim/Documents/GitHub/run-map-generator && \
      grep -q '"build": "drizzle-kit migrate && next build"' package.json && \
      set -a && source .env.local && set +a && \
      bun run build
    </automated>
  </verify>
  <done>
    `package.json` build script updated. `bun run build` succeeds end-to-end: drizzle-kit migrate reports nothing to apply (already applied in Task 2), next build completes with no errors. The local dev branch DB still has the `generations` table, and rebuilding is idempotent.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: End-of-phase smoke test — studio + no-regression on /api/generate</name>
  <what-built>
    All schema + migration + build wiring from Tasks 1-3. Now verify the developer-facing studio works AND the existing generate flow is fully unbroken (the success criteria from ROADMAP.md Phase 1).
  </what-built>
  <how-to-verify>
    Run, in order, and confirm each:

    **A. drizzle-kit studio (validates DEV-01 + the dev workflow):**
    ```bash
    set -a; source .env.local; set +a; bunx drizzle-kit studio
    ```
    Expected: prints `Drizzle Studio is up and running on https://local.drizzle.studio`.
    Open that URL in a browser. Confirm the left nav shows `public.generations`. Click it — table view loads with columns `id, device_id, status, prompt_inputs, prompt, model_params, wavespeed_task_id, blob_url, blob_pathname, error, duration_ms, created_at, updated_at`. The table is empty (zero rows). Close studio.

    **B. POST /api/generate still returns a PNG (validates Phase 1 success criterion #4 — zero regression):**
    ```bash
    bun dev   # in one terminal
    ```
    Then in another:
    ```bash
    PASSWORD=$(grep '^GENERATE_PASSWORD=' .env.local | cut -d= -f2- | tr -d '"')
    curl -sS -X POST -H "x-generate-password: $PASSWORD" http://localhost:3000/api/generate -o /tmp/after-plan02.png
    file /tmp/after-plan02.png
    ls -lh /tmp/after-plan02.png
    ```
    Expected: `PNG image data` and a non-trivial file size. The generate flow has zero awareness of the DB layer at this phase — but if importing `lib/db/index.ts` was accidentally added somewhere, the route might break on cold-start (Neon connection resolution). Confirm via `grep -r "@/lib/db" app/ lib/ 2>/dev/null | grep -v "lib/db/index.ts"` returning empty.

    **C. Push to a Vercel preview and verify deploy + production-branch `\dt` (validates ROADMAP success criteria #1 and #3 — BLOCKING, do not skip):**

    Phase 1 is NOT complete until this passes. The two success criteria that depend on a real Vercel deploy must be observed, not deferred to "the next push someday."

    ```bash
    git push -u origin HEAD
    ```

    Then in the Vercel dashboard:
    1. Wait for the preview deploy to go green. The build log MUST show `drizzle-kit migrate` running before `next build`. If `drizzle-kit migrate` fails, the build fails — that's the gate.
    2. Open the Neon project for this Vercel project → switch to the preview branch (auto-named after the git branch) → SQL Editor → run `\dt`. Expected: the `generations` table is listed.
    3. (Optional but recommended) `\d generations` should show all 13 columns and the two indexes — same shape as local.
    4. If you've already merged to main and a production deploy ran: repeat (1) and (2) on the Neon production branch.

    Paste the Neon `\dt` output back to confirm. If the table is missing, Phase 1 is incomplete — diagnose the build log before proceeding to Phase 2.

    **D. (Optional, only if `bunx drizzle-kit migrate` fails on Vercel):** Most likely cause is drizzle-kit's `verbose: true` printing migration plans that confuse Vercel's log parser, or missing devDeps. Fix: confirm `drizzle-kit` is in `devDependencies` (Task 1) and that Vercel install command isn't `bun install --production`. Vercel's default is fine.
  </how-to-verify>
  <resume-signal>
    Reply "phase 1 complete" once A, B, AND C all succeed. Phase 1 is NOT complete on local checks alone.

    If anything fails: revert the build script change (Task 3) immediately so the next deploy isn't broken — `git checkout package.json` — diagnose, then re-apply.
  </resume-signal>
  <done>
    - drizzle-kit studio shows the `generations` table with all 13 columns. (criterion 5)
    - POST /api/generate returns a PNG end-to-end. (criterion 4)
    - `bun run build` succeeds with the new build script.
    - Vercel preview deploy goes green with `drizzle-kit migrate` in the build log. (criterion 3)
    - `\dt` on the corresponding Neon branch shows `generations`. (criterion 1)
  </done>
</task>

</tasks>

<verification>
After all four tasks of PLAN-02:

1. `lib/db/index.ts` imports only `@neondatabase/serverless` and `drizzle-orm/neon-http`, exports a singleton `db` and re-exports `schema`. (ROADMAP success criterion #2.)
2. `lib/db/schema.ts` defines `generations` with all 13 columns + 2 indexes per CONTEXT.md.
3. `drizzle.config.ts` uses `DATABASE_URL_UNPOOLED` exclusively (the pooled URL would break drizzle-kit's introspection through PgBouncer).
4. `lib/db/migrations/0000_*.sql` exists and is committed; meta files committed too.
5. The `generations` table exists on the local Neon dev branch — `\dt` confirms.
6. `package.json` build script is `drizzle-kit migrate && next build`. `bun run build` succeeds.
7. `bunx drizzle-kit studio` opens and shows the empty `generations` table. (ROADMAP success criterion #5.)
8. `POST /api/generate` returns a PNG end-to-end. (ROADMAP success criterion #4 — zero regression.)
9. No file in `app/` or `lib/` (other than `lib/db/index.ts` itself) imports from `@/lib/db` — confirming Phase 1 strictly does not wire writes/reads from app code (Phase 2/3 territory).
10. ROADMAP success criterion #3 (Vercel preview deploy runs `drizzle-kit migrate` and goes green) is automatically validated on the next push — no manual action required here.
</verification>

<success_criteria>
All five Phase 1 success criteria from ROADMAP.md are satisfiable:
1. `\dt` against the Neon production branch will show `generations` after the next Vercel deploy of this plan (already true on local dev branch as of Task 2).
2. `lib/db/index.ts` imports only the HTTP driver — no `pg`, `ws`, or `neon-serverless` (Task 1 + verify gate).
3. Vercel preview deploy runs `drizzle-kit migrate` during `bun run build` and goes green — Task 3 wires this.
4. `POST /api/generate` still returns a PNG — Task 4 verifies.
5. `bunx drizzle-kit studio` opens locally — Task 4 verifies.

No DB read/write code added to `app/` or `lib/generate.ts`. Phase boundary respected.
</success_criteria>

<requirements_coverage>
| Requirement | Task |
|-------------|------|
| DB-03 (Singleton `db` client at module scope, Fluid Compute friendly) | Task 1 (lib/db/index.ts) |
| DB-04 (Drizzle schema defines `generations` table) | Task 1 (lib/db/schema.ts) |
| DB-05 (drizzle-kit configured to use `DATABASE_URL_UNPOOLED`) | Task 1 (drizzle.config.ts) |
| DB-06 (Initial migration generated and applied; checked into git) | Task 2 |
| DB-07 (drizzle-kit migrate runs as part of Vercel build) | Task 3 |
| SCH-01 (Columns sufficient to answer "prompt iteration" questions: prompt_inputs, prompt, model_params) | Task 1 — schema columns `prompt_inputs jsonb`, `prompt text`, `model_params jsonb` |
| SCH-02 (Columns sufficient to answer "usage patterns": timestamps, device_id, status, duration) | Task 1 — `device_id`, `status`, `duration_ms`, `created_at`, `updated_at` |
| SCH-03 (Columns sufficient to "find a past map": durable Blob URL, generation id, search-friendly fields) | Task 1 — `id uuid PK`, `blob_url`, `blob_pathname`, indexed `(device_id, created_at desc)` and `(created_at desc)` |
| SCH-04 (Migrations are additive — no destructive changes on rolling deploys) | Task 1 + Task 2: initial migration is purely additive (CREATE TABLE + CREATE INDEX); CONTEXT.md commits future migrations to additive-only policy |

Combined with PLAN-01 coverage (DB-01, DB-02, DEV-01), Phase 1 covers all 12 requirement IDs in scope (DB-01..07, SCH-01..04, DEV-01). DEV-02 is explicitly Phase 3 per ROADMAP and out of scope here.
</requirements_coverage>

<output>
After completion, create `.planning/phases/01-database-foundation/01-02-SUMMARY.md` documenting:
- Resolved migration filename (e.g., `0000_silly_smiling_tiger.sql`)
- Confirmation `\dt` on local Neon dev branch shows `generations`
- Result of `bunx drizzle-kit studio` smoke check
- Result of `POST /api/generate` smoke check (file size + status)
- Whether `bun run build` invoked drizzle-kit migrate cleanly
- Any deviations from CONTEXT.md (none expected — every locked decision was implemented)
- Forward note: PLAN of next phase (Phase 2) can immediately `import { db, schema } from '@/lib/db'`.
</output>
