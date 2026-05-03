# Codebase Concerns

**Analysis Date:** 2026-05-03

## Tech Debt

**Single-file API route, no abstraction layer:**
- Issue: All WaveSpeed orchestration (auth check, submit, poll loop, base64/URL handling, response framing) lives inline in the route handler. `lib/generate.ts` is pure (good), but the network layer has no counterpart module.
- Files: `app/api/generate/route.ts`
- Impact: Hard to unit-test the polling logic; any second consumer (CLI, retry job) would need to duplicate the orchestration.
- Fix approach: Extract `submitWaveSpeedTask()`, `pollWaveSpeedTask()`, and `decodeWaveSpeedOutput()` into `lib/wavespeed.ts`. Keep the route handler as thin auth + dispatch.

**`pickValues()` random branch combined with `clamp()` collapses distribution:**
- Issue: `paceFromRaw` uses `±randInt(60, 240)` then clamps to `[330, 690]`. When `pace_to` is near a bound, results pile up at the boundary, producing visually identical outputs across runs.
- Files: `lib/generate.ts:54-55`, also `distFromRaw` at `lib/generate.ts:52-53`.
- Impact: Less variety than the random ranges suggest.
- Fix approach: Resample on out-of-range instead of clamping (rejection sampling), or pick `pace_from` independently of `pace_to`.

**`enable_base64_output: true` for a 1k 9:16 PNG balloons response payload:**
- Issue: Base64 inflates the binary by ~33% inside JSON; the route then decodes and re-emits as binary, doing two extra copies. With Vercel response size limits and Lambda memory pressure this is wasteful.
- Files: `app/api/generate/route.ts:59`, decoding at `:136-138`.
- Impact: Slower polls (larger JSON parse), higher memory, more 502 surface area.
- Fix approach: Set `enable_base64_output: false`, accept the URL branch (already implemented at `:130-135`), and stream/forward via `fetch` of the WaveSpeed CDN URL.

**Magic numbers scattered in the route handler:**
- Issue: `270_000`, `3000`, `300`, response slice `500`/`300` are inline literals.
- Files: `app/api/generate/route.ts:5, 66, 83-84, 95`.
- Impact: Tuning timeouts means hunting through code.
- Fix approach: Hoist to named constants at top of file.

## Known Bugs

**`URL.createObjectURL` blob leak:**
- Symptoms: Each successful generation creates a blob URL via `URL.createObjectURL(blob)` but the previous URL is never revoked when a new one replaces it or the component unmounts.
- Files: `app/page.tsx:61`
- Trigger: Generate repeatedly in one session.
- Workaround: Reload the page; or add `useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl])`.

**`X-Generate-Meta` header may exceed Vercel/edge proxy header size limits:**
- Symptoms: `meta` includes the full prompt + values, base64-encoded into a single response header. Long prompts (~1KB+) can trip 8KB/16KB header caps on some intermediaries.
- Files: `app/api/generate/route.ts:165`
- Trigger: Future prompt expansion or proxy with strict header size.
- Workaround: Move metadata into a JSON envelope (multipart or a sibling endpoint), not a header.

**Polling uses `setTimeout` then `fetch` even before the first check:**
- Symptoms: First poll happens 3s after submit even if the task is already done. Adds 3s latency floor.
- Files: `app/api/generate/route.ts:87-89`
- Trigger: Every request.
- Workaround: Move the `await new Promise` to the end of the loop body, or use exponential backoff starting at ~500ms.

**`elapsed` timer drifts on tab throttling:**
- Symptoms: Background tabs throttle `setInterval`; the displayed seconds counter under-reports actual wall time.
- Files: `app/page.tsx:23-28`
- Trigger: User switches tabs while generating.
- Workaround: Compute on render via `requestAnimationFrame` or compare against a `Date.now()` baseline on visibility change.

## Security Considerations

**Password compared with `!==` (timing-attack adjacent):**
- Risk: `password !== expected` is not constant-time. With network jitter the practical risk is low, but it's the kind of finding that lights up audits.
- Files: `app/api/generate/route.ts:26`
- Current mitigation: None.
- Recommendations: Use `crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected))` with length pre-check.

**Password stored in `localStorage` indefinitely:**
- Risk: Any XSS (none today, but future Tailwind/font/3p script additions could change that) exfiltrates `rmg-password` instantly. There is no rotation, no expiry, no httpOnly cookie option.
- Files: `app/page.tsx:5, 16-21, 33`
- Current mitigation: 401 clears the cached value; repo is private.
- Recommendations: Move to an httpOnly, Secure, SameSite=Strict cookie set by a `/api/login` route; client never sees the secret after submit.

**Password sent in a custom request header instead of `Authorization`:**
- Risk: Custom headers are fine but bypass conventional logging redaction; some observability stacks mask `Authorization` automatically and would log `x-generate-password` in plaintext.
- Files: `app/api/generate/route.ts:21`, `app/page.tsx:53`
- Current mitigation: None.
- Recommendations: Use `Authorization: Bearer <password>` or move to cookie auth.

**No rate limiting:**
- Risk: Anyone with the password (or anyone brute-forcing it) can drain the WaveSpeed budget at one request per ~60-90s per concurrent client. There is also no lockout on repeated 401s.
- Files: `app/api/generate/route.ts` (entire handler).
- Current mitigation: Password gate only.
- Recommendations: Add Vercel KV / Upstash-based IP+password-fingerprint rate limit (e.g., 10/hour). Add exponential backoff on failed auth.

**Public base image URL leakage:**
- Risk: `public/base.jpg` is served unauthenticated at `/base.jpg` and is also passed to a third-party (WaveSpeed). The base screenshot is implicitly assumed non-sensitive but is not documented as such.
- Files: `app/api/generate/route.ts:40-41`, `public/base.jpg`
- Current mitigation: None.
- Recommendations: Document that `public/base.jpg` is publicly readable; if it ever contains PII or the underlying user's identity, switch to a signed short-lived URL or send bytes directly.

**Error messages echo upstream response bodies to the client:**
- Risk: `text.slice(0, 500)` from WaveSpeed is forwarded verbatim. Could leak request IDs, partial keys, or internal endpoint structure if WaveSpeed ever returns them.
- Files: `app/api/generate/route.ts:64-67, 92-96`
- Current mitigation: 500-char cap.
- Recommendations: Log full text server-side, return a generic message + a correlation ID to the client.

**No CSRF protection on the POST:**
- Risk: With cookie-based auth this would matter; with the current header-based auth, a cross-origin attacker cannot send `x-generate-password` from a browser without the user typing it. Acceptable today, becomes critical the moment auth moves to cookies.
- Files: `app/api/generate/route.ts:20`
- Current mitigation: Custom header acts as de-facto CSRF token.
- Recommendations: Keep this in mind before any auth refactor.

## Performance Bottlenecks

**Fixed 3s poll interval:**
- Problem: Most edits finish in 30–90s; a fixed 3s interval wastes ~10–30 polls and adds up to 3s of post-completion latency.
- Files: `app/api/generate/route.ts:84, 87-89`
- Cause: Naive `while + sleep` loop.
- Improvement path: Exponential backoff capped at 5s, first poll at 500ms.

**Synchronous Buffer round-trip on response:**
- Problem: `Buffer.from(b64, 'base64')` then `new Uint8Array(pngBuf)` doubles memory at peak for the PNG payload.
- Files: `app/api/generate/route.ts:138, 160`
- Cause: Conversion needed because `NextResponse` body type expects `BodyInit`.
- Improvement path: Switch to URL output (see tech debt above) and stream the upstream response with `return new NextResponse(imgRes.body, ...)`.

**Cold-start cost of `runtime = 'nodejs'` + 300s `maxDuration`:**
- Problem: Node runtime cold starts ~300-800ms. For a single-button app, every first-of-day click feels sluggish.
- Files: `app/api/generate/route.ts:4-5`
- Cause: Default Node runtime; no warming.
- Improvement path: Acceptable for current scale; revisit with Vercel cron warmer if usage grows.

## Fragile Areas

**Polling loop has no per-attempt timeout:**
- Files: `app/api/generate/route.ts:89-91`
- Why fragile: `fetch` to WaveSpeed has no `AbortSignal.timeout(...)`. A hung connection could consume the full 270s budget on a single poll.
- Safe modification: Add `signal: AbortSignal.timeout(10_000)` to each poll fetch.
- Test coverage: Zero.

**`WaveSpeedResponse` type is a hand-rolled guess:**
- Files: `app/api/generate/route.ts:9-18`
- Why fragile: No runtime validation. If WaveSpeed changes `code: number` to `code: string`, or `status` adds new variants (`'queued'`, `'cancelled'`), the loop silently treats them as "still processing" and times out.
- Safe modification: Validate with `zod` or a hand-written guard; treat unknown statuses as failures with explicit logging.
- Test coverage: Zero.

**Origin inference for `baseImageUrl` assumes WaveSpeed can reach it:**
- Files: `app/api/generate/route.ts:40-41`
- Why fragile: `req.nextUrl.origin` resolves to the deployment URL — works on Vercel, breaks for `localhost` development (WaveSpeed cannot fetch `http://localhost:3000/base.jpg`). Local dev silently fails on submit.
- Safe modification: Either upload the base image once to a CDN and hard-code the URL, or detect `localhost`/`127.0.0.1` and refuse with a clear error.
- Test coverage: Zero.

## Scaling Limits

**Single Vercel function invocation per generation:**
- Current capacity: 1 generation = 1 long-running function (60-90s typical, 270s ceiling).
- Limit: Vercel Hobby concurrent function execution caps; sustained traffic will queue and time out.
- Scaling path: Move to a webhook callback model — submit returns immediately, WaveSpeed POSTs result to a callback route, client polls a lightweight `/api/result/:id` backed by Vercel KV.

**No request deduplication:**
- Current capacity: Double-clicks are blocked client-side via `disabled={generating}` only.
- Limit: A user can open two tabs and pay for two generations in parallel.
- Scaling path: Issue a per-user generation lock (KV with TTL) keyed by password hash.

## Dependencies at Risk

**`next@16.2.4` (bleeding edge):**
- Risk: Next 16 ships breaking changes vs 15 (per `AGENTS.md`: "This is NOT the Next.js you know"). API surface for `NextRequest`, route segment config, and runtime exports may shift in patch releases.
- Impact: A `bun update` could break route exports (`runtime`, `maxDuration`) or `req.nextUrl` semantics.
- Migration plan: Pin exactly (already pinned to `16.2.4`); read `node_modules/next/dist/docs/` before any upgrade; do not auto-merge Dependabot PRs for `next`.

**`react@19.2.4` + `react-dom@19.2.4`:**
- Risk: React 19 stable but ecosystem (Next 16, Tailwind 4) is still settling. Type changes in `@types/react@^19` (range, not pinned) may produce build errors after `bun install`.
- Impact: `useEffect` cleanup typing, ref forwarding patterns differ from React 18.
- Migration plan: Pin `@types/react` and `@types/react-dom` to exact versions.

**`tailwindcss@^4` + `@tailwindcss/postcss@^4`:**
- Risk: Tailwind v4 reworked config (`@theme`, CSS-first config). Loose `^4` range invites unexpected migrations.
- Impact: A minor bump can change class generation or PostCSS pipeline.
- Migration plan: Pin to exact minor.

**No lockfile audit / `bun audit` not run:**
- Risk: `bun.lock` checked in but no CI gate; transitive vulns invisible.
- Impact: Unknown.
- Migration plan: Add `bun audit` to a GitHub Action on PRs.

## Missing Critical Features

**No request logging / observability:**
- Problem: There is no structured logging of submit task IDs, poll counts, or upstream failures. When a 502 fires, debugging requires reading Vercel function logs and reconstructing the WaveSpeed call by hand.
- Blocks: Diagnosing the next 504 / 502 incident.

**No retry on transient WaveSpeed failures:**
- Problem: Any non-2xx from submit immediately returns 502 to the user. WaveSpeed can return 502/503 transiently.
- Blocks: User-facing reliability.

**No way to recover an in-flight task on page refresh:**
- Problem: If the user refreshes mid-generation, the task ID is lost; they pay for a generation they never see.
- Blocks: UX during the 60-90s wait.

**No history / gallery of past generations:**
- Problem: Each PNG is downloaded and gone; users regenerate things they already had.
- Blocks: Iteration UX.

## Test Coverage Gaps

**Zero tests in the project:**
- What's not tested: Everything. No `*.test.*` or `*.spec.*` files anywhere. No test runner declared in `package.json` (only `dev`, `build`, `start`, `lint`).
- Files: entire repo.
- Risk: Regressions in `pickValues()` math (e.g., `distance × pace = elapsed` invariant) or polling logic ship undetected.
- Priority: High for `lib/generate.ts` (pure, trivially testable, encodes the project's "believable values" contract).

**`lib/generate.ts` invariants untested:**
- What's not tested: `timing_to_sec === round(distance_to_km * pace_to_sec_per_km)`; ranges of every field; `mulberry32` determinism.
- Files: `lib/generate.ts`
- Risk: Future "make values more believable" tweaks silently break the README's stated invariant.
- Priority: High — pure, fast, no setup needed. Add `bun test` with `lib/generate.test.ts`.

**Polling logic untested:**
- What's not tested: Status transitions, deadline handling, base64 vs URL output branches, error message formatting.
- Files: `app/api/generate/route.ts`
- Risk: Refactors to the polling loop break silently in production.
- Priority: Medium — needs `fetch` mocking, more setup.

**No e2e / smoke test against the deployed endpoint:**
- What's not tested: Auth header flow, password rotation behaviour, large PNG response delivery.
- Risk: Vercel config drift (env vars, function size limits) breaks prod undetected.
- Priority: Low — can be a Playwright script behind a CI secret.

## Deprecation / Version Risks

**Next 16 App Router exports may shift:**
- `export const runtime = 'nodejs'` and `export const maxDuration = 300` are route segment config. Per `AGENTS.md`, Next 16 has breaking changes vs the LLM-trained baseline; verify against `node_modules/next/dist/docs/` before any refactor of `app/api/generate/route.ts`.

**`NextRequest.nextUrl.origin` behaviour:**
- Used at `app/api/generate/route.ts:40` to construct the WaveSpeed image URL. In Next 16, `nextUrl` semantics around proxied origins (Vercel preview deployments behind `x-forwarded-host`) may differ; confirm before assuming this works for preview URLs.

**`@next/next/no-img-element` disabled inline:**
- `app/page.tsx:128` disables the lint rule for the generated blob preview. Acceptable for blob URLs (next/image cannot optimize them) but worth noting as an intentional escape hatch.

**Bun + Next 16 compatibility:**
- `bun dev` / `bun run build` are supported but Bun's resolver occasionally diverges from Node's for ESM-only deps. `package.json` already lists `unrs-resolver` and `sharp` in `ignoreScripts` + `trustedDependencies`, suggesting prior friction. Expect more on minor Next bumps.

## Known TODOs / FIXMEs

None found. Grep for `TODO|FIXME|HACK|XXX` across `app/` and `lib/` returns no matches.

---

*Concerns audit: 2026-05-03*
