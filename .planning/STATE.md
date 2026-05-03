# Project State

**Project:** CQC Map Generator
**Initialized:** 2026-05-04
**Mode:** Brownfield (existing Next.js 16 app)

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-04)

**Core value:** Generating a believable run-map screenshot on demand, fast and cheap. Storage/analytics exist to make *that* better over time.

**Current milestone:** Storage & Analytics — adding Neon Postgres + Vercel Blob persistence underneath the existing WaveSpeed generation flow.

## Current Focus

**Next phase:** Phase 1 — Database Foundation

Run `/gsd-plan-phase 1` to create the executable plan.

## Roadmap Snapshot

| Phase | Status | Goal |
|-------|--------|------|
| 1. Database Foundation | Not started | Neon provisioned, Drizzle schema + migration in git, build-time migrate hook |
| 2. Identity + Submit-Side Writes | Not started | `device_id` cookie + `status='pending'` row per submit |
| 3. Blob Persistence + Completion Writes | Not started | Stream WaveSpeed PNG → Vercel Blob, update row on success/failure |

## Key Artifacts

- `.planning/PROJECT.md` — what this is, requirements, decisions
- `.planning/REQUIREMENTS.md` — 26 v1 requirements with traceability
- `.planning/ROADMAP.md` — 3-phase milestone
- `.planning/config.json` — workflow config (coarse, parallel, balanced models, all gates on)
- `.planning/codebase/` — 7-doc codebase map (existing app)
- `.planning/research/` — 3 docs: neon-drizzle, vercel-blob, next16-cookie-identity

## Locked Decisions (load-bearing)

- Neon Postgres + `@neondatabase/serverless` HTTP driver + Drizzle ORM (`neon-http`)
- Vercel Blob (public) for image bytes
- Anonymous httpOnly UUID cookie for per-device identity
- No UI work this milestone (gallery / dashboard are v2)
- Single-user assumption — no auth, no multi-tenancy

---
*Last updated: 2026-05-04 at project initialization*
