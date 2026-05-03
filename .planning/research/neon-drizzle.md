# Neon Postgres + Drizzle ORM on Vercel Fluid Compute (Next.js 16)

**Date:** 2026-05-03
**Versions referenced:** `next@16.2.4`, `@neondatabase/serverless@1.1.0`, `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`
**Confidence:** HIGH (Context7 docs for Neon + Drizzle, Vercel official docs for Fluid Compute, Neon docs for Vercel Marketplace integration)

---

## 1. Driver choice — pick `neon-http`

Three drivers ship in `@neondatabase/serverless`:

| Driver | Transport | When to use on Fluid Compute |
|---|---|---|
| `neon(...)` (HTTP) | HTTPS (fetch) | **Default choice.** One-shot queries, no session state. No connection lifecycle. Works in Edge, Node, Bun. |
| `Pool` / `Client` (WebSocket) | WSS over TCP-tunnel | Only when you need **interactive transactions** (`BEGIN ... COMMIT` across awaits) or `LISTEN/NOTIFY`. |
| Raw `pg` against direct (`DATABASE_URL_UNPOOLED`) | TCP | Long-lived processes (cron, workers, local scripts, migrations). **Not** in route handlers. |

### Why HTTP wins on Fluid Compute

Fluid Compute reuses a single Node process across many concurrent invocations ([Vercel docs: "multiple invocations can share the same physical instance"](https://vercel.com/docs/fluid-compute)). The HTTP driver is **stateless per query** — every `sql\`...\`` call is one HTTPS request that Neon's proxy translates to Postgres. No socket to leak, no pool to size, no `pool.end()` hygiene.

The WebSocket `Pool` requires per-request setup/teardown (`ctx.waitUntil(pool.end())`) and a polyfill (`neonConfig.webSocketConstructor = ws`) on Node ≤ 21 — operational overhead you do not want unless you need transactions.

> **Note on `neonConfig.fetchConnectionCache`** — this flag is a no-op in `@neondatabase/serverless@1.x`; connection caching is on by default. Drop the line if you copy old snippets.

### Minimal driver setup

```ts
// src/db/index.ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
```

That's it for HTTP. No `neonConfig` needed.

### When you actually need WebSocket (transactions)

```ts
// src/db/tx.ts — only import this in handlers that need a real transaction
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

// Node 22+ has global WebSocket — no polyfill needed.
// For Node ≤ 21, set: neonConfig.webSocketConstructor = (await import('ws')).default;

export function getTxDb() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool, { schema });
  return { db, end: () => pool.end() };
}
```

The `neon-http` driver's `db.transaction()` only batches queries (one HTTPS roundtrip, all-or-nothing) — it cannot run logic between statements. Use `neon-serverless` (WebSocket Pool) when you need true interactive transactions.

---

## 2. Drizzle setup

### File layout

```
src/db/
  index.ts          # exports `db` (neon-http)
  schema.ts         # all pgTable definitions (or schema/*.ts barrel)
  migrations/       # drizzle-kit output (DO commit)
drizzle.config.ts
```

### Schema example

```ts
// src/db/schema.ts
import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';

export const runs = pgTable('runs', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  distanceM: integer('distance_m').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
```

### `drizzle.config.ts`

Use the **unpooled** URL for `drizzle-kit` — it opens a real psql connection for introspection and DDL, which the pooler (PgBouncer transaction mode) can't always service cleanly.

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!,
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
```

### Bun commands

```bash
bun add @neondatabase/serverless drizzle-orm
bun add -d drizzle-kit

# Generate SQL migration from schema diff
bunx drizzle-kit generate

# Apply pending migrations to the DB pointed to by drizzle.config.ts
bunx drizzle-kit migrate

# (Dev only) push schema directly without a migration file
bunx drizzle-kit push

# Open the data browser
bunx drizzle-kit studio
```

For production, run `drizzle-kit migrate` from your Vercel Build Command (e.g. `"build": "drizzle-kit migrate && next build"`) so each deployment applies pending migrations against the branch DB before the new code goes live.

---

## 3. Vercel Marketplace Neon integration

Installing Neon via the Vercel Marketplace auto-provisions these env vars on the linked project (Production, Preview, Development scopes):

| Variable | Notes |
|---|---|
| `DATABASE_URL` | **Pooled** (PgBouncer, `-pooler` host suffix). Use this in route handlers with `neon-http`. |
| `DATABASE_URL_UNPOOLED` | Direct connection. Use for `drizzle-kit`, long-running scripts, migrations. |
| `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD` | Components — rarely needed. |
| `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING` | Legacy aliases for backwards compat with the old `@vercel/postgres` package. |
| `NEON_AUTH_*` | Only present if Neon Auth is enabled on the project. |

### Local dev

```bash
bunx vercel link               # one-time
bunx vercel env pull .env.local   # writes all of the above into .env.local
```

Next.js 16 reads `.env.local` automatically. Re-pull after rotating credentials or enabling new integrations.

---

## 4. Query patterns in Next.js 16 App Router

### Singleton DB client — yes, do this

Module-level `db` is correct on Fluid Compute. Each warm instance reuses it across concurrent invocations, and the HTTP driver has no socket state to corrupt.

```ts
// app/api/runs/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { runs } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';

export async function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const rows = await db
    .select()
    .from(runs)
    .where(eq(runs.userId, userId))
    .orderBy(desc(runs.capturedAt))
    .limit(50);

  return NextResponse.json(rows);
}
```

### Server Components / Server Actions

Same singleton, no caveats:

```ts
// app/runs/page.tsx
import { db } from '@/db';
import { runs } from '@/db/schema';

export default async function RunsPage() {
  const rows = await db.select().from(runs).limit(20);
  return <pre>{JSON.stringify(rows, null, 2)}</pre>;
}
```

### Cold start considerations

- The first invocation on a fresh instance pays one HTTPS handshake to Neon's edge (~30–80 ms warm region). Subsequent calls reuse the keep-alive connection inside the `neon()` client.
- Keep the import graph small at the edge of `src/db/index.ts` — schema files are fine (zero runtime cost), but don't pull in `pg`, `ws`, or `drizzle-orm/neon-serverless` unless a specific route needs them. Tree-shaking only works if those imports are isolated.
- Use Drizzle's `db.batch([...])` to fold multiple queries into one HTTP roundtrip:

  ```ts
  const [user, latest] = await db.batch([
    db.select().from(users).where(eq(users.id, id)),
    db.select().from(runs).where(eq(runs.userId, id)).limit(1),
  ]);
  ```

---

## 5. Pitfalls

### Free-tier connection limits
Neon Free has a hard ceiling (~100 simultaneous connections to the pooler, 10 to direct). With `neon-http` this is rarely hit because each query is a short-lived HTTPS request, not a held socket. With `Pool`/WebSocket on a busy Fluid instance, you can exhaust direct connections fast — always `await pool.end()` (via `ctx.waitUntil`) at the end of the handler.

### Branching for previews
The Vercel integration creates a Neon branch per preview deployment (`preview/<git-branch>`). Env vars are injected via webhook at deploy time. Migrations run during `next build` on that preview will mutate **only the preview branch** — production is safe. Branches are auto-deleted when the Vercel deployment is removed.

Caveat: branch creation adds 5–15 s to the first deploy of a new git branch. For ephemeral PRs this is fine; for noisy bot branches consider disabling the integration's auto-branching.

### Schema-change-during-active-deployment
Running `drizzle-kit migrate` in the build step means there is a window where the new schema is live but old function instances (still serving traffic during rollout) are running old code. **All migrations must be backwards-compatible with the previous deployment**:

- Add columns nullable (or with defaults). Backfill in a separate migration.
- Never `DROP COLUMN` in the same deploy that stops writing to it — split into: (1) stop writing, ship; (2) drop, ship.
- Rename via add-new + dual-write + backfill + drop-old (4 deploys).
- Index creation: use `CREATE INDEX CONCURRENTLY` (Drizzle: `.concurrently()`); blocks ALTERs but not reads/writes.

### Pooler vs unpooled mismatch
Don't point `drizzle-kit` at the pooled URL. PgBouncer in transaction mode breaks `CREATE TYPE` introspection, prepared statement caching, and advisory locks that `drizzle-kit migrate` uses. Symptom: random `prepared statement "s_1" does not exist` errors during migration. Fix: use `DATABASE_URL_UNPOOLED` for the kit, `DATABASE_URL` for runtime.

### Edge runtime compat
`neon-http` works in both Node and Edge runtimes. `neon-serverless` (WebSocket) works in Edge but needs `globalThis.WebSocket` (Edge has it; Node 22+ has it; Node ≤ 21 needs the `ws` polyfill). If a route needs Edge runtime, prefer `neon-http`.

### `drizzle-orm/neon` (RLS helpers) is separate
The `crudPolicy` / `pgRole` helpers under `drizzle-orm/neon` are for Neon's row-level-security with Neon Auth. Don't confuse with `drizzle-orm/neon-http` (the driver adapter). Most projects only use the latter.

---

## Sources

- [Vercel — Fluid compute](https://vercel.com/docs/fluid-compute) (2026-01-29)
- [Neon — Vercel Native Integration](https://neon.com/docs/guides/vercel-native-integration)
- Context7: `/neondatabase/serverless` (v1.1.0 reference)
- Context7: `/drizzle-team/drizzle-orm` (drizzle-orm 0.45.x, drizzle-kit 0.31.x)
