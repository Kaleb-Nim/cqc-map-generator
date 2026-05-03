# Requirements: CQC Map Generator — Storage & Analytics Milestone

**Defined:** 2026-05-04
**Core Value:** Generating a believable run-map screenshot on demand, fast and cheap. Storage/analytics exist to make *that* better over time.

## v1 Requirements

Requirements for the **storage + analytics layer** milestone. The existing generation flow stays working; this milestone adds the persistence + identity layer underneath it.

### Identity (per-device)

- [ ] **ID-01**: First request without a `device_id` cookie mints a UUID via `crypto.randomUUID()`
- [ ] **ID-02**: Cookie is set `httpOnly`, `sameSite=lax`, `secure` (prod), `path=/`, `maxAge=1y`
- [ ] **ID-03**: Cookie is minted in the `submit` route handler (not in `proxy.ts`) so cached pages stay cacheable
- [ ] **ID-04**: Subsequent requests from the same browser reuse the existing `device_id` (no re-mint)
- [ ] **ID-05**: Server Components / route handlers can read `device_id` via the async `cookies()` API

### Database (Neon Postgres)

- [ ] **DB-01**: Neon Postgres provisioned via Vercel Marketplace integration (auto-injects `DATABASE_URL` + `DATABASE_URL_UNPOOLED`)
- [ ] **DB-02**: `@neondatabase/serverless` HTTP driver wired through `drizzle-orm/neon-http`
- [ ] **DB-03**: Singleton `db` client at module scope (Fluid Compute friendly)
- [ ] **DB-04**: Drizzle schema defines two tables: `generations` and (implicit) per-device aggregates derivable via SQL
- [ ] **DB-05**: `drizzle-kit` configured to use `DATABASE_URL_UNPOOLED` (avoids PgBouncer prepared-statement issues)
- [ ] **DB-06**: Initial migration generated and applied; migrations checked into git
- [ ] **DB-07**: `drizzle-kit migrate` runs as part of Vercel build command (so preview branches get schema)

### Schema (`generations` table)

- [ ] **SCH-01**: Columns sufficient to answer "prompt iteration" questions (prompt inputs, model params, version of any system prompt)
- [ ] **SCH-02**: Columns sufficient to answer "usage patterns" (timestamps, device_id, status, duration)
- [ ] **SCH-03**: Columns sufficient to "find a past map" via SQL (durable Blob URL, generation id, search-friendly fields)
- [ ] **SCH-04**: Migrations are additive (no destructive changes on rolling deploys)

### Image Persistence (Vercel Blob)

- [ ] **BLOB-01**: Vercel Blob store provisioned; `BLOB_READ_WRITE_TOKEN` available in env
- [ ] **BLOB-02**: On WaveSpeed completion, server fetches the ephemeral URL and pipes the response stream into `put()` with `access: 'public'` (no full-buffer load)
- [ ] **BLOB-03**: Object key follows `runs/<generation_id>.png` with `addRandomSuffix: true`
- [ ] **BLOB-04**: Blob `url` and `pathname` both persisted to `generations` row (pathname enables future cleanup)
- [ ] **BLOB-05**: `cacheControlMaxAge` set to 1 year (immutable images)
- [ ] **BLOB-06**: Blob upload runs on Node.js runtime (not Edge) to handle multi-MB streams

### Wiring (existing async submit + poll flow)

- [ ] **WIRE-01**: On `submit`, a row is inserted into `generations` with `status='pending'`, `device_id`, and request inputs
- [ ] **WIRE-02**: On poll-detected success, the row updates to `status='complete'`, sets blob URL, sets duration
- [ ] **WIRE-03**: On poll-detected failure/timeout, the row updates to `status='failed'` with error info
- [ ] **WIRE-04**: Existing UI behavior unchanged — user still sees their image at the end

### Local Dev

- [ ] **DEV-01**: `bunx vercel env pull .env.local` populates DB + Blob secrets locally
- [ ] **DEV-02**: README documents the Neon + Blob setup steps for re-clone scenarios

## v2 Requirements

Deferred — explicitly out of this milestone but acknowledged for later.

### Gallery & UI

- **GAL-01**: `/history` page showing this device's past generations as scrollable thumbnails
- **GAL-02**: Lightweight stats strip (total generated, this week, etc.)
- **DASH-01**: `/admin` route with hardcoded charts

### Operations

- **OPS-01**: Cost tracking per generation (WaveSpeed spend)
- **OPS-02**: Failure log surfaced in app (currently visible only via SQL)
- **OPS-03**: Background cleanup job for old Blob objects (using stored `pathname`)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Authentication / login | Single-user tool; anonymous cookie ID is enough |
| Multi-tenancy / per-user isolation beyond device_id | Not a public product |
| Storing image bytes as `bytea` in Postgres | Wrong tool — kills query speed, bloats DB |
| Private Blob with token-gated reads | Personal use; public URLs are fine |
| Rate limits / abuse prevention | Not exposed to strangers |
| WebSocket / long-poll Pool driver | HTTP driver fits Fluid Compute; no interactive transactions needed |
| Raw `pg` driver | Incompatible with Fluid Compute connection model |

## Traceability

Populated by the roadmapper agent in the next step.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (filled by roadmapper) | | |

**Coverage targets:**
- v1 requirements: 26 total
- All must map to a phase before roadmap is approved

---
*Defined: 2026-05-04 at project initialization*
