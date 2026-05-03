# Codebase Structure

**Analysis Date:** 2026-05-03

## Directory Layout

```
run-map-generator/
├── app/                          # Next.js 16 App Router root
│   ├── api/
│   │   └── generate/
│   │       └── route.ts          # POST /api/generate — auth + WaveSpeed submit/poll
│   ├── favicon.ico
│   ├── globals.css               # Tailwind v4 entry + global CSS vars
│   ├── layout.tsx                # Root layout: HTML, fonts, metadata ("fuck this CQC")
│   └── page.tsx                  # Home page (client component) — gate + Generate UI
├── lib/
│   └── generate.ts               # Pure RNG, formatters, prompt builder (no I/O)
├── public/
│   ├── base.jpg                  # Source screenshot consumed by WaveSpeed gpt-image-2/edit
│   ├── favicon-style assets...   # next.svg, vercel.svg, file.svg, globe.svg, window.svg
├── .vercel/                      # Vercel project link (gitignored project.json)
├── .env.example                  # Template: WAVESPEED_API_KEY, GENERATE_PASSWORD
├── AGENTS.md                     # Agent guidance — "this is NOT the Next.js you know"
├── CLAUDE.md                     # @AGENTS.md re-export for Claude Code
├── README.md
├── eslint.config.mjs             # ESLint flat config — extends eslint-config-next
├── next.config.ts                # Empty NextConfig stub
├── next-env.d.ts                 # Next-managed ambient types (do not edit)
├── package.json                  # next 16.2.4, react 19.2.4, tailwindcss v4
├── postcss.config.mjs            # Tailwind v4 PostCSS plugin
├── tsconfig.json                 # strict TS, path alias "@/*" → "./*"
├── tsconfig.tsbuildinfo          # incremental build cache (gitignored typically)
└── bun.lock                      # Bun lockfile (this project uses bun, not npm)
```

## Directory Purposes

**`app/`:**
- Purpose: Next.js 16 App Router — every route, layout, and route handler lives here.
- Contains: `layout.tsx`, `page.tsx`, `globals.css`, `api/*/route.ts`.
- Key files: `app/layout.tsx`, `app/page.tsx`, `app/api/generate/route.ts`.

**`app/api/`:**
- Purpose: Server-side route handlers (folder-per-route, file named `route.ts`).
- Contains: One subroute today — `generate/`.
- Key files: `app/api/generate/route.ts`.

**`lib/`:**
- Purpose: Framework-agnostic helpers. Pure functions only — no `fetch`, no `process.env`, no React.
- Contains: `generate.ts`.
- Key files: `lib/generate.ts`.

**`public/`:**
- Purpose: Static assets served from site root by Next.js (`public/base.jpg` → `/base.jpg`).
- Contains: `base.jpg` (load-bearing — WaveSpeed fetches it), plus default Next/Vercel SVGs.
- Key files: `public/base.jpg`.

**`.vercel/`:**
- Purpose: Vercel CLI project link metadata. Generated, do not edit by hand.
- Contains: `project.json`, `README.txt`.

## Key File Locations

**Entry Points:**
- `app/page.tsx`: Route `/` — client component with the Generate UI.
- `app/api/generate/route.ts`: Route `POST /api/generate`.
- `app/layout.tsx`: Wraps every route.

**Configuration:**
- `next.config.ts`: Next config (currently empty).
- `tsconfig.json`: TypeScript strict + `@/*` path alias.
- `eslint.config.mjs`: Flat ESLint config extending `eslint-config-next`.
- `postcss.config.mjs`: Tailwind v4 PostCSS plugin.
- `.env.example`: Required env var template.
- `package.json`: Scripts (`dev`, `build`, `start`, `lint`) and deps.

**Core Logic:**
- `lib/generate.ts`: `pickValues`, `buildPrompt`, formatters, `mulberry32`.
- `app/api/generate/route.ts`: WaveSpeed submit + poll, PNG response.

**Testing:**
- No test setup currently. No `*.test.*` or `*.spec.*` files exist; no test runner in `package.json`.

**Static Assets:**
- `public/base.jpg`: Required base image for gpt-image-2 edit. Referenced as `${origin}/base.jpg` in `app/api/generate/route.ts:41`.

## Naming Conventions

**Files:**
- Route handlers: always `route.ts` inside an `app/.../route-name/` folder.
- Pages: always `page.tsx`.
- Layouts: always `layout.tsx`.
- Library modules: lowercase, kebab-free single words (`generate.ts`).
- React components in pages use default export; library modules use named exports.

**Directories:**
- App Router segments: lowercase (`api`, `generate`).
- Top-level: lowercase (`app`, `lib`, `public`).

**Imports:**
- Use the `@/` path alias for cross-tree imports — e.g. `import { pickValues } from '@/lib/generate'` (`app/api/generate/route.ts:2`). Maps to repo root via `tsconfig.json:22-23`.

## Where to Add New Code

**New API route (e.g. `/api/foo`):**
- Create `app/api/foo/route.ts` exporting `POST` / `GET` async functions taking `NextRequest` and returning `NextResponse`.
- If you need Node APIs (Buffer, Node fetch internals), add `export const runtime = 'nodejs';` like `app/api/generate/route.ts:4`.
- If long-running, add `export const maxDuration = N;` (≤300 on Vercel hobby/pro defaults).
- For auth, replicate the password check from `app/api/generate/route.ts:21-28` — or extract it first to `lib/auth.ts` (see CONCERNS).

**New page (e.g. `/about`):**
- Create `app/about/page.tsx`. Default-export a component.
- Server Component by default. Add `'use client'` at the top only if you need state/effects (see `app/page.tsx:1`).

**New shared utility:**
- Add to `lib/`. Keep it pure if possible — no `fetch`, no `process.env` access, no React imports — to keep it test-friendly the way `lib/generate.ts` is.
- Import via `@/lib/your-module`.

**New shared React component:**
- No `components/` directory exists yet. Create `components/<Name>.tsx` at repo root and import via `@/components/<Name>`. Co-locating in `app/_components/` is also valid (underscore prefix excludes from routing).

**New static asset:**
- Drop in `public/`. Reference as `/your-file.ext` (root-relative) — Next serves `public/` at the site root.
- If WaveSpeed or another external service must fetch it, remember the asset must be reachable at `${req.nextUrl.origin}/your-file.ext`, which fails on localhost without a tunnel.

**New environment variable:**
- Add to `.env.example` with a placeholder.
- Read via `process.env.NAME` inside the route handler (lazily — current code checks presence at request time, not module load).
- For client exposure prefix with `NEXT_PUBLIC_` (none today).

**New global style:**
- Edit `app/globals.css`. Tailwind v4 directives live there; there is no `tailwind.config.ts`.

**Tests (when introduced):**
- `lib/generate.ts` is already structured for unit testing — pass `mulberry32(seed)` as the `rng` arg to `pickValues` for deterministic output.
- No runner is wired. If adding one, prefer `bun test` (project uses Bun) over Jest/Vitest unless a specific reason exists.

## Special Directories

**`.next/`:**
- Purpose: Next.js build output and dev cache.
- Generated: Yes (by `next dev` / `next build`).
- Committed: No (gitignored).

**`.vercel/`:**
- Purpose: Vercel CLI link to the deployed project.
- Generated: Yes (by `vercel link`).
- Committed: Partially — `project.json` is typically gitignored; `README.txt` may be committed.

**`node_modules/`:**
- Purpose: Bun-installed dependencies.
- Generated: Yes (`bun install`).
- Committed: No.

**`node_modules/next/dist/docs/`:**
- Purpose: Bundled Next.js 16 docs. Per `AGENTS.md`, consult these before writing Next-specific code — APIs may differ from older Next versions in training data.
- Generated: Yes (shipped with the `next` package).
- Committed: No.

---

*Structure analysis: 2026-05-03*
