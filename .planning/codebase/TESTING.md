# Testing Patterns

**Analysis Date:** 2026-05-03

## Test Framework

**Runner:**
- **None configured.** No `vitest`, `jest`, `playwright`, `bun:test`, or `node --test` dependency in `package.json`.
- No `*.test.ts`, `*.test.tsx`, `*.spec.ts`, or `*.spec.tsx` files exist anywhere in the repo (outside `node_modules/`).
- No `tests/`, `__tests__/`, or `e2e/` directory.

**Assertion Library:** None.

**Run Commands:**
```bash
# No test script exists in package.json. Available scripts:
bun run dev      # next dev
bun run build    # next build
bun run start    # next start
bun run lint     # eslint
```

The only quality gate today is `bun run lint` plus TypeScript's `strict` checking via `next build`.

## Test File Organization

**Not yet established.** When introducing tests, the recommended layout for this project is:

**Location:**
- Co-locate unit tests next to source: `lib/generate.ts` ↔ `lib/generate.test.ts`
- Route handler tests: `app/api/generate/route.test.ts`
- Browser/E2E tests in a top-level `e2e/` directory

**Naming:**
- `*.test.ts` for unit tests (pure logic, no DOM)
- `*.test.tsx` for component tests (React rendering)
- `*.spec.ts` for Playwright specs under `e2e/`

## Test Structure

**No existing patterns.** Below is the recommended structure for this codebase.

**Recommended runner: `bun test`**
- Built-in to Bun, no extra dependency
- Native TypeScript + JSX support
- Jest-compatible API (`describe`, `test`, `expect`)
- Per global rules: this environment uses Bun, not Node/npm — `bun test` is the natural fit.

**Suite skeleton:**
```typescript
import { describe, test, expect } from 'bun:test';
import { pickValues, buildPrompt, formatHHMM, mulberry32 } from './generate';

describe('pickValues', () => {
  test('produces deterministic output for a fixed seed', () => {
    const rng = mulberry32(42);
    const v = pickValues(rng);
    expect(v.battery_pct).toBeGreaterThanOrEqual(25);
    expect(v.battery_pct).toBeLessThanOrEqual(65);
  });
});
```

## Testability Hooks Already in Code

**`lib/generate.ts` is designed for testing.** The file's header comment explicitly states: *"Pure value generation + prompt construction. No I/O, no network — easy to test."*

Reusable seams:
- `pickValues(rng)` accepts an injectable RNG (default `Math.random`). Pass `mulberry32(seed)` for deterministic tests.
- `mulberry32(seed)` is exported specifically to enable seeded property tests.
- `formatHHMM`, `formatClock`, `formatPace`, `buildPrompt` are pure string functions — trivial to assert against snapshots or string equality.

**`app/api/generate/route.ts` is harder to test** — it does network I/O against WaveSpeed and reads env vars. To test it, mock `globalThis.fetch` and set `process.env.GENERATE_PASSWORD` / `WAVESPEED_API_KEY` in test setup.

## Mocking

**No framework chosen.** Recommendations:

- **`bun test`** ships `mock()` and `spyOn()` from `bun:test` — sufficient for `fetch` stubs and module mocks.
- For React component tests, add `@testing-library/react` + `happy-dom` (lighter than jsdom and Bun-friendly).

**What to mock here:**
- Outbound `fetch` calls to `api.wavespeed.ai` (always — never hit the real API in tests)
- `process.env` values for password / API key
- `Date.now()` if you need stable timestamps in `Content-Disposition` filenames

**What NOT to mock:**
- The pure functions in `lib/generate.ts` — call them directly with a seeded RNG.
- Tailwind / CSS — irrelevant in unit tests.

## Fixtures and Factories

**Not yet established.** Suggested approach:

- Use `mulberry32(seed)` as the canonical fixture generator for `Values`. Document the seed → values mapping in test names.
- Place shared fixtures in `lib/__fixtures__/` if multiple test files need the same data.

## Coverage

**No coverage tooling.** If added: `bun test --coverage` is built-in, no config required.

**No coverage targets enforced.** When tests are added, prioritize 100% coverage of `lib/generate.ts` (pure, easy) before tackling the route handler.

## Test Types

**Unit Tests (recommended, none exist):**
- Scope: `lib/generate.ts` exports — `pickValues`, `buildPrompt`, `formatHHMM`, `formatClock`, `formatPace`, `mulberry32`.
- These are deterministic with a seeded RNG and have no external dependencies.

**Integration Tests (recommended, none exist):**
- Scope: `app/api/generate/route.ts` POST handler with mocked `fetch`.
- Cover the four error paths: missing env, wrong password, WaveSpeed submit failure, WaveSpeed poll timeout.
- Use the `Request`/`Response` web APIs directly: `await POST(new NextRequest('http://localhost/api/generate', { method: 'POST', headers: { 'x-generate-password': 'x' } }))`.

**E2E Tests:**
- Per global rules, use **Playwright CLI/SDK directly** (`bunx playwright`), not the Playwright MCP server.
- Always use the bundled Chromium binary from `bunx playwright install chromium`, never system Chrome.
- Recommended scope: password gate flow, generate button disabled state, error rendering. Skip the actual generation call (mock the API route) to keep E2E hermetic.

## Common Patterns (recommended for this codebase)

**Async testing:**
```typescript
test('route returns 401 when password is wrong', async () => {
  process.env.GENERATE_PASSWORD = 'right';
  const req = new NextRequest('http://localhost/api/generate', {
    method: 'POST',
    headers: { 'x-generate-password': 'wrong' },
  });
  const res = await POST(req);
  expect(res.status).toBe(401);
});
```

**Deterministic randomness:**
```typescript
test('pickValues with seed=1 produces a known battery value', () => {
  const v = pickValues(mulberry32(1));
  expect(v.battery_pct).toBe(/* precomputed */);
});
```

**Error-path testing:**
```typescript
test('throws when WaveSpeed returns non-200 code', async () => {
  globalThis.fetch = mock(async () =>
    new Response(JSON.stringify({ code: 500, message: 'boom' }), { status: 200 }),
  );
  // ... call POST and expect 502
});
```

## How to Add Tests (step-by-step)

1. Install Bun's test runner (already bundled — no install needed) plus React Testing helpers if doing component tests:
   ```bash
   bun add -d @testing-library/react happy-dom
   ```
2. Add a test script to `package.json`:
   ```json
   "test": "bun test",
   "test:watch": "bun test --watch"
   ```
3. Create `bunfig.toml` at project root if you need DOM globals:
   ```toml
   [test]
   preload = ["./test-setup.ts"]
   ```
4. Co-locate your first test next to the module: `lib/generate.test.ts`.
5. Update ESLint ignores if needed — current config already lints `**/*.ts` so test files will be linted by default; that is desirable.

---

*Testing analysis: 2026-05-03*
