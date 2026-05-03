# CQC Map Generator

## What This Is

A personal Next.js 16 tool that generates AI run-map screenshots (via WaveSpeed → gpt-image-2) for the daily CQC time window (16:30–17:30). Single user, iterated on as the maps improve. Adding a Neon Postgres + Vercel Blob layer to persist generations and unlock prompt-iteration analytics.

## Core Value

Generating a believable run-map screenshot on demand, fast and cheap. Everything else (analytics, storage) exists to make *that* better over time.

## Requirements

### Validated

<!-- Inferred from existing codebase -->

- ✓ Generate a run-map image via WaveSpeed gateway calling gpt-image-2 — existing
- ✓ Async submit + poll flow (avoids 504 timeouts on long generations) — existing
- ✓ Time-window constraint: generated screenshot is for 16:30–17:30 — existing
- ✓ Minimal Next.js 16 App Router UI titled "fuck this CQC" — existing
- ✓ Deployed on Vercel — existing

### Active

- [ ] Persist every generation's metadata (prompt inputs, params, timing, status, blob URL) to Neon Postgres
- [ ] Copy completed images from ephemeral WaveSpeed URL → Vercel Blob (public) for durable history
- [ ] Anonymous per-device identity via httpOnly UUID cookie, attached to every generation
- [ ] Drizzle ORM schema + drizzle-kit migrations checked into git
- [ ] Neon connection wired through `@neondatabase/serverless` HTTP driver (Fluid Compute friendly)
- [ ] Schema designed to answer: prompt iteration questions, usage patterns, "find a specific past map"

### Out of Scope

- Authentication / login — single-user tool, anonymous cookie ID is sufficient
- Admin dashboard or charts UI — analytics done via SQL against Neon directly (psql / Neon console)
- Public gallery page — defer; can re-find any past map by querying Neon for its Blob URL
- Cost tracking & failure logging — defer; nice-to-have, not load-bearing for the core analytics goals
- Storing image bytes in Postgres (`bytea`) — wrong tool, kills query speed
- Private Blob / token-gated reads — single-user personal tool, public URLs are fine
- Rate limits, abuse prevention, multi-tenancy — not a public product

## Context

- **Existing codebase**: Next.js 16 (App Router, React 19, Tailwind v4, TypeScript, Bun), deployed on Vercel. See `.planning/codebase/` for full map.
- **Generation backend**: WaveSpeed AI Gateway → gpt-image-2. Returns a signed CDN URL that is presumed ephemeral (not yet verified — first phase will confirm TTL).
- **Why Neon over alternatives**: Native Vercel Marketplace integration, serverless HTTP driver fits Fluid Compute (no connection-pool drama), generous free tier for personal use.
- **Why Vercel Blob over S3/R2**: Same Vercel surface, zero extra accounts/creds, ~$0.023/GB/month, trivially cheap at single-user scale.
- **Iteration mode**: User builds in small steps and refines as the tool gets used. Bias toward minimal viable layers, not big upfront design.

## Constraints

- **Tech stack**: Next.js 16 App Router, React 19, TypeScript, Bun, Tailwind v4 — must not regress.
- **Runtime**: Vercel Fluid Compute. DB driver MUST be HTTP-based (`@neondatabase/serverless`), not raw `pg` / connection pool.
- **Package manager**: Bun (per global CLAUDE.md). Never `npm`/`npx`.
- **Next.js docs**: This is Next 16 — APIs differ from training data. Per `AGENTS.md`, consult `node_modules/next/dist/docs/` before writing route handlers / cache code.
- **Secrets**: `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` via Vercel env vars; nothing in repo.
- **Single-user assumption**: Schema and code may assume one cookie = one logical user. Don't pre-build for multi-tenancy.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Neon Postgres for metadata | Native Vercel integration, serverless HTTP driver, free tier | — Pending |
| Vercel Blob (public) for image bytes | Same platform, cheap, no auth needed for personal use | — Pending |
| Drizzle ORM + drizzle-kit | Modern TS-first ORM, light, fits Next 16 / Fluid Compute | — Pending |
| `@neondatabase/serverless` HTTP driver | Required for Fluid Compute; avoids pg connection-pool issues | — Pending |
| Anonymous httpOnly UUID cookie | Per-device identity without auth surface | — Pending |
| No admin UI / no gallery page (yet) | SQL + raw Blob URLs are enough for one user; defer until annoying | — Pending |
| Copy WaveSpeed image → Blob on completion | WaveSpeed URLs presumed ephemeral; durable history requires our own copy | — Pending |

---
*Last updated: 2026-05-04 at project initialization (brownfield)*
