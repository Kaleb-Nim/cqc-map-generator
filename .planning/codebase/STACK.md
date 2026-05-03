# Technology Stack

**Analysis Date:** 2026-05-03

## Languages

**Primary:**
- TypeScript ^5 — all application code (`app/`, `lib/`); strict mode enabled in `tsconfig.json`
- TSX (React 19) — UI components (`app/page.tsx`, `app/layout.tsx`)

**Secondary:**
- JavaScript (ESM) — config files only (`eslint.config.mjs`, `postcss.config.mjs`)
- CSS — `app/globals.css` (Tailwind v4 entrypoint)

## Runtime

**Environment:**
- Node.js runtime for the API route (`export const runtime = 'nodejs'` in `app/api/generate/route.ts`)
- Targets Vercel Functions in production (`maxDuration = 300` declared per-route)
- Browser runtime (React 19) for the client page

**Package Manager:**
- Bun (project-mandated; see `CLAUDE.md` / `AGENTS.md`)
- Lockfile: `bun.lock` (present at repo root)
- `package.json` declares `ignoreScripts: ["sharp", "unrs-resolver"]` and matching `trustedDependencies` — Bun-style postinstall opt-ins

## Frameworks

**Core:**
- Next.js `16.2.4` — App Router (`app/` directory); see `app/layout.tsx`, `app/page.tsx`, `app/api/generate/route.ts`
- React `19.2.4` + React DOM `19.2.4` — client UI rendering
- Tailwind CSS `^4` (via `@tailwindcss/postcss`) — utility classes used throughout `app/page.tsx`; PostCSS plugin wired in `postcss.config.mjs`

**Testing:**
- None detected. No test runner, config, or test files in the repo. `lib/generate.ts` is documented as "easy to test" but no tests exist.

**Build/Dev:**
- Next.js CLI — `next dev`, `next build`, `next start` (see `package.json` scripts)
- TypeScript `^5` — type checking only (`noEmit: true`)
- ESLint `^9` with `eslint-config-next` `16.2.4` — flat config in `eslint.config.mjs` using `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- PostCSS — driven by `@tailwindcss/postcss` plugin

## Key Dependencies

**Critical:**
- `next` `16.2.4` — framework, App Router, route handlers, `next/font/google` (Geist + Geist Mono in `app/layout.tsx`)
- `react` / `react-dom` `19.2.4` — UI framework
- `@tailwindcss/postcss` `^4` — Tailwind v4 build pipeline

**Infrastructure:**
- `@types/node` `^20` — Node typings
- `@types/react` `^19`, `@types/react-dom` `^19` — React 19 typings
- `eslint-config-next` `16.2.4` — Next-aware lint rules

**Notably absent:**
- No HTTP client library — uses the platform `fetch` (`app/api/generate/route.ts`)
- No OpenAI / WaveSpeed SDK — direct REST calls via `fetch`
- No validation library (Zod, etc.)
- No state management library — local React `useState` only

## Configuration

**Environment:**
- Configured via env vars loaded by Next.js (`process.env.*`)
- Local dev uses `.env.local` (`cp .env.example .env.local` per `README.md`); `.env.example` lists `WAVESPEED_API_KEY`, `GENERATE_PASSWORD`
- Production via Vercel Project → Settings → Environment Variables

**Build:**
- `next.config.ts` — empty config object (no custom rewrites/headers/images config)
- `tsconfig.json` — `target: ES2017`, `module: esnext`, `moduleResolution: bundler`, `strict: true`, `jsx: react-jsx`, path alias `@/*` → `./*`, includes `next-env.d.ts` and `.next/types`
- `postcss.config.mjs` — single plugin `@tailwindcss/postcss`
- `eslint.config.mjs` — flat config; ignores `.next/**`, `out/**`, `build/**`, `next-env.d.ts`

**Project conventions (from `CLAUDE.md` / `AGENTS.md`):**
- Use `bun` / `bunx`, never `npm` / `npx` / `node`
- Treat Next.js 16 as breaking from prior versions; consult `node_modules/next/dist/docs/` before writing framework code

## Platform Requirements

**Development:**
- Bun installed locally
- Node-compatible runtime (Bun provides this)
- macOS / Linux dev environments (project authored on macOS / Apple Silicon per global rules)

**Production:**
- Vercel (Hobby plan or higher — Hobby supports the declared `maxDuration = 300` for `/api/generate`)
- Vercel Functions running the Node.js runtime
- Public deployment URL (the route uses `req.nextUrl.origin` to build a public `base.jpg` URL passed to WaveSpeed — requires the deployment to be publicly reachable for WaveSpeed to fetch the source image)

---

*Stack analysis: 2026-05-03*
