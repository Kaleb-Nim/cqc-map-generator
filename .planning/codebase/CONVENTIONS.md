# Coding Conventions

**Analysis Date:** 2026-05-03

## Naming Patterns

**Files:**
- Next.js App Router special files use lowercase: `page.tsx`, `layout.tsx`, `route.ts`, `globals.css`
- Library modules use lowercase verb/noun: `lib/generate.ts`
- No PascalCase component files yet — components are inline in `app/page.tsx`
- Config files use the framework-mandated names: `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `tsconfig.json`

**Functions:**
- camelCase for all functions: `pickValues`, `buildPrompt`, `formatHHMM`, `mulberry32`, `submitPassword`, `clearPassword`
- Acronyms in function names stay UPPERCASE when they are the unit/format being formatted (`formatHHMM`, not `formatHhMm`)
- Local arrow helpers inside functions also camelCase: `randInt`, `randFloat`, `clamp`, `pad2`

**Variables:**
- camelCase for runtime variables: `password`, `hasPassword`, `imageUrl`, `pollUrl`, `taskId`, `pngBuf`
- snake_case is used **only** inside the domain `Values` payload (`battery_pct`, `distance_from_km`, `pace_to_sec_per_km`) because those keys are user-facing prompt fields. Do not introduce snake_case elsewhere.
- SCREAMING_SNAKE_CASE for module-level constants: `STORAGE_KEY` (`app/page.tsx:5`), `WAVESPEED_ENDPOINT` (`app/api/generate/route.ts:7`)
- Numeric literals with underscores for readability: `270_000` (`app/api/generate/route.ts:83`)

**Types:**
- PascalCase: `Values` (`lib/generate.ts:3`), `WaveSpeedResponse` (`app/api/generate/route.ts:9`)
- `type` aliases preferred over `interface` (every type in the codebase uses `type X = { ... }`)

## Code Style

**Formatting:**
- No Prettier or Biome config detected. Formatting follows ESLint + editor defaults.
- Observed style: 2-space indent, single quotes in `.ts`/`.tsx` files (`'use client'`, `'/api/generate'`), double quotes in `.mjs`/JSON config files (`"@tailwindcss/postcss"`)
- Trailing commas in multiline objects/arrays
- Semicolons always present
- Arrow functions for short helpers; `function` keyword for top-level exports (`export function pickValues`, `export function buildPrompt`)

**Linting:**
- ESLint 9 flat config (`eslint.config.mjs`)
- Extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Ignores: `.next/**`, `out/**`, `build/**`, `next-env.d.ts`
- Run with `bun run lint` (script: `eslint`)
- Inline disables are allowed where idiomatic — example at `app/page.tsx:128`: `// eslint-disable-next-line @next/next/no-img-element` (used because the generated PNG is an object URL, not a static asset)

## Import Organization

**Order observed:**
1. Node/Next built-ins (`next/server`, `next/font/google`)
2. React / framework hooks (`react`)
3. Internal modules via `@/*` alias (`@/lib/generate`)
4. Side-effect imports last for CSS (`import "./globals.css"`)

**Path Aliases:**
- `@/*` maps to `./*` from project root (`tsconfig.json:21-23`)
- Always use `@/lib/...` and `@/app/...` instead of relative `../../` paths

**Quote style in imports:** matches the file's overall quote style — `'next/server'` in `.ts` source, `"next"` in `.mjs` config.

## TypeScript Patterns

**Compiler config (`tsconfig.json`):**
- `strict: true` — no implicit any, strict null checks enforced
- `target: ES2017`, `module: esnext`, `moduleResolution: bundler`
- `jsx: react-jsx` (no `import React` needed)
- `isolatedModules: true` — every file must be independently transpilable; use `export type` for type-only re-exports
- `noEmit: true` — Next/Bun handles emission; `tsc` is type-check only

**Type narrowing patterns:**
- `unknown` errors narrowed via `instanceof Error`: `err instanceof Error ? err.message : String(err)` (`app/page.tsx:63`, `app/api/generate/route.ts:141`)
- Discriminated unions on string literals for state: `'created' | 'processing' | 'completed' | 'failed'` (`app/api/generate/route.ts:14`)
- Optional chaining + nullish coalescing for safe access: `submitJson.data?.id`, `body.error ?? \`HTTP ${res.status}\``
- Type assertions only at JSON boundaries: `(await submit.json()) as WaveSpeedResponse`

**Readonly props:**
- Layout component uses `Readonly<{ children: React.ReactNode }>` (`app/layout.tsx:22`) — follow this for any new layout/page props.

## React / Next.js Patterns

**Server vs Client:**
- Default to Server Components. Add `'use client'` as the first line only when hooks/browser APIs are needed (see `app/page.tsx:1`).
- Route handlers (`app/api/*/route.ts`) export `runtime` and `maxDuration` as named consts — use `export const runtime = 'nodejs'` when Node APIs (e.g. `Buffer`) are required.

**State management:**
- Plain `useState` + `useEffect`. No global store, no context, no SWR/React Query yet.
- LocalStorage access guarded inside `useEffect` (never at render time) — see `app/page.tsx:15-21`.

**Event handlers:**
- Inline arrow functions in JSX for trivial handlers
- Named handlers for non-trivial logic: `submitPassword`, `clearPassword`, `generate`, `download`

**Reading Next.js docs:**
- Per `AGENTS.md`, this project uses Next 16 with breaking changes. Before writing new Next.js code, read `node_modules/next/dist/docs/` for the relevant API. Do not rely on Next 13/14/15 muscle memory.

## Styling

**Tailwind v4:**
- Tailwind imported via `@import "tailwindcss"` in `app/globals.css:1` (no `@tailwind base/components/utilities` directives — that's v3 syntax).
- Theme tokens declared with `@theme inline { ... }` block.
- CSS variables for design tokens (`--background`, `--foreground`, `--font-geist-sans`).
- Dark mode handled via `@media (prefers-color-scheme: dark)` overriding root variables.

**Class composition:**
- Inline className strings, space-separated. No `clsx`/`cva` yet — add only if conditional class logic gets unwieldy.
- Template literals for conditional classes: `className={\`${geistSans.variable} ${geistMono.variable} h-full antialiased\`}` (`app/layout.tsx:28`)

**Color palette in use:** `bg-black`, `text-white`, `bg-zinc-{700,800,900}`, `border-zinc-{700,800}`, `bg-red-950`/`text-red-200` for errors. Stick to the `zinc` scale for neutrals.

## Error Handling

**Route handlers:**
- Always return `NextResponse.json({ error: '...' }, { status: N })` for failure paths — never throw from route handlers.
- Status code conventions in this codebase:
  - `401` — auth failure (missing/wrong password)
  - `500` — server misconfiguration (env var missing)
  - `502` — upstream API error (WaveSpeed)
  - `504` — upstream timeout
- Truncate upstream error bodies with `.slice(0, 500)` before echoing back, to avoid leaking large payloads.

**Client side:**
- Wrap `fetch` in `try/catch`, narrow errors with `instanceof Error`, surface via `setError(...)`.
- Always reset state in `finally` (`setGenerating(false)`).

## Logging

- No logging framework. `console` is not used in current source.
- When adding logs, prefer `console.error` for server-side error paths in route handlers; do not log secrets or full request bodies.

## Comments

**When to comment:**
- Top-of-file purpose comments for "pure" modules: `lib/generate.ts:1` — `// Pure value generation + prompt construction. No I/O, no network — easy to test.`
- Inline comments to explain *why*, not *what*: e.g. `app/api/generate/route.ts:38-41` explains why `public/base.jpg` is fetched via origin URL.
- Step labels for multi-phase flows: `// Step 1: submit async task`, `// Step 2: poll for result`.

**No JSDoc/TSDoc** is used. Types document the API; prose comments document intent.

## Function Design

**Size:** Helpers are small (3–10 lines). The route handler is ~150 lines and acceptable because it is sequential async I/O — extract only if branching grows.

**Parameters:**
- Default values for injectable dependencies: `pickValues(rng: () => number = Math.random)` (`lib/generate.ts:32`) — pattern to follow for any randomness/time/IO dependency to keep functions testable.
- Object parameters for domain payloads: `buildPrompt(v: Values)`.

**Return values:**
- Pure functions return plain objects/strings. No tuples, no `Result<T, E>` wrapping.
- Route handlers always return `NextResponse` or `new NextResponse(...)`.

## Module Design

**Exports:**
- Named exports only. No default exports for library code.
- Default exports reserved for Next.js convention files (`page.tsx`, `layout.tsx`, `next.config.ts`, `postcss.config.mjs`).

**Barrel files:** None. Import directly from the source module (`@/lib/generate`).

**Purity boundary:** `lib/` is pure (no I/O, no network). All side effects live in `app/api/*/route.ts` and client components. Preserve this split when adding new modules.

## Secrets & Environment

- Read env vars inside the handler, not at module top-level — see `app/api/generate/route.ts:22,30`. This avoids build-time crashes when vars are unset.
- Always check for missing env vars and return `500` with a clear message.
- Never inline secrets. Required vars: `GENERATE_PASSWORD`, `WAVESPEED_API_KEY`.

---

*Convention analysis: 2026-05-03*
