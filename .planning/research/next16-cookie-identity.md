# Anonymous per-device identity via httpOnly UUID cookie (Next.js 16)

**Confidence:** HIGH (sourced from `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md` and `.../03-file-conventions/proxy.md` — i.e., the exact Next.js 16 docs shipped with this project's `next` install).

## TL;DR recommendation

Mint the `device_id` cookie **inside the `submit` route handler** (the existing `app/api/generate/submit/route.ts` once split, currently `app/api/generate/route.ts`). Use `crypto.randomUUID()`. Use `httpOnly: true`, `sameSite: 'lax'`, `secure: true` (in prod), `path: '/'`, `maxAge: 60 * 60 * 24 * 365`. Read it back from Server Components via `await cookies()`. Do **not** put this in `proxy.ts` — proxy is a "last resort" per Next 16 docs and adds Set-Cookie to every response (including cached/static).

---

## 1. Where to mint the cookie

| Location | Set cookie? | Notes (Next 16) |
|---|---|---|
| Route Handler (`app/api/.../route.ts`) | Yes | Cleanest. Set on a Response that the user is already waiting for. **Recommended.** |
| Server Function (`'use server'`) | Yes | Same cookie API as route handlers. |
| Server Component (`page.tsx`) | **No — read only** | Docs explicitly: "Setting cookies is not supported during Server Component rendering." (cookies.md L80) |
| Proxy (`proxy.ts`, ex‑middleware) | Yes (on every matching request) | Runs for every matched route, mutates response via `NextResponse.cookies.set`. Heavy hammer. |

**Why the `submit` route handler is the right home for this app:**
- It's the only place a row gets written to DB. If no `device_id` exists, we mint one *before* insert and use it as `user_id`.
- Avoids touching cached GET responses (a proxy implementation would attach `Set-Cookie` to every page render, defeating the static cache).
- HTTP rule from cookies.md L73: "you must use `.set` in a Server Function or Route Handler" — i.e., before streaming starts. Submit is a POST with a discrete response, so this is trivially satisfied.

---

## 2. Reading + writing cookies in a Next 16 route handler

Breaking change vs Next 14: `cookies()` is **async** (cookies.md L300, "v15.0.0-RC: cookies is now an async function"). Synchronous access in 15 was a temporary back-compat shim and is gone in 16.

```ts
// app/api/generate/submit/route.ts
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const DEVICE_COOKIE = 'device_id'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

async function getOrMintDeviceId(): Promise<{ id: string; isNew: boolean }> {
  const jar = await cookies()                         // <-- async in Next 16
  const existing = jar.get(DEVICE_COOKIE)?.value
  if (existing) return { id: existing, isNew: false }

  const id = crypto.randomUUID()                      // built-in, no dep
  jar.set({
    name: DEVICE_COOKIE,
    value: id,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  })
  return { id, isNew: true }
}

export async function POST(req: Request) {
  const { id: deviceId } = await getOrMintDeviceId()
  const body = await req.json()

  // ... insert into DB with user_id = deviceId
  const job = await createJob({ userId: deviceId, ...body })

  return NextResponse.json({ jobId: job.id })
}
```

Notes on the API surface (cookies.md L34-L41):
- `set(name, value, options)` *or* `set({ name, value, ...options })` — both supported.
- `delete(name)` only works in route handlers / server functions, same-domain rule.
- `has`, `get`, `getAll`, `toString` available.

Options of interest (cookies.md L47-L60): `httpOnly`, `sameSite` (`'lax' | 'strict' | 'none' | boolean`), `secure`, `maxAge` (seconds), `expires` (Date), `path` (default `'/'`), `partitioned` (CHIPS).

---

## 3. Reading the cookie from a Server Component

Same `cookies()` import, same async signature. This is *read-only* in components.

```tsx
// app/history/page.tsx
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

export default async function HistoryPage() {
  const jar = await cookies()
  const deviceId = jar.get('device_id')?.value

  if (!deviceId) {
    // First-ever visit, no submits yet
    return <p>No history yet — generate a map to start.</p>
  }

  const rows = await db.generation.findMany({
    where: { userId: deviceId },
    orderBy: { createdAt: 'desc' },
  })

  return <HistoryList rows={rows} />
}
```

Caveat from cookies.md L69: "`cookies` is a Request-time API … Using it in a layout or page will opt a route into dynamic rendering." That's fine for `/history`, but means **don't** read the device cookie inside a layout that wraps your homepage if you want the homepage to stay static. Read it inside a sub-component or a sibling page.

---

## 4. Proxy alternative (formerly `middleware.ts`)

**Major rename in Next 16** (proxy.md L770: "v16.0.0: Middleware is deprecated and renamed to Proxy"). File is now `proxy.ts` at project root, function exported as `proxy` (or default). A codemod exists: `npx @next/codemod@canary middleware-to-proxy .` (proxy.md L754).

The Next team is actively de-emphasizing this layer (proxy.md L737-L749): *"this feature is recommended to be used as a last resort."*

What it would look like:

```ts
// proxy.ts (project root, sibling to app/)
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const existing = request.cookies.get('device_id')?.value
  const response = NextResponse.next()
  if (!existing) {
    response.cookies.set({
      name: 'device_id',
      value: crypto.randomUUID(),
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

Tradeoffs vs route handler approach:

| Concern | Proxy | Route Handler (recommended) |
|---|---|---|
| Cookie present on first page load | Yes — set on initial GET | No — set on first POST to `/api/generate/submit` |
| Affects cached/static responses | Yes — `Set-Cookie` mutates the response, can break ISR/CDN caching | No |
| Runtime | Node.js by default in Next 16 (proxy.md L219; was Edge by default in 14). `runtime` config option is **not allowed** in proxy files. | Node.js (Vercel Fluid Compute) |
| Read in Server Components | Yes (same cookie) | Yes, but only after first submit |
| Code locality | Separate top-level file | Lives next to the only DB write |
| Per Vercel guidance | "Last resort" | Idiomatic |

For our use case (device id only matters when we write a row), the route-handler approach wins. Skip proxy.

> Inferred (not explicit in local docs): setting a `Set-Cookie` on a response the CDN considers cacheable will typically mark it `private` / bypass the shared cache. Verify against your `Cache-Control` setup before adopting the proxy approach. Marked LOW confidence.

---

## 5. UUID generation

Use **`crypto.randomUUID()`** — it's built into Node 19+, Bun, and the Edge runtime. Zero dependency, RFC 4122 v4, ~36 chars.

```ts
const id = crypto.randomUUID()  // '550e8400-e29b-41d4-a716-446655440000'
```

`nanoid` (~21 chars, URL-safe) is fine but unnecessary here:
- Cookie size is trivial either way.
- DB column is `text`/`uuid` either way; if you want a native Postgres `uuid` column, prefer `crypto.randomUUID()`.
- Adds a dep and pulls a tiny bit of bundle if accidentally imported client-side.

Bun-compatible (Bun implements WebCrypto). No polyfill.

---

## 6. Pitfalls

1. **Async cookies() — the #1 Next 16 footgun.** Forgetting `await` returns a promise; `.get()` on it throws. Codemod: `npx @next/codemod@canary next-async-request-api .` (cookies.md L300). Same applies to `headers()` and `draftMode()`.

2. **Overwriting on every request.** Always check `jar.get(...)?.value` first. Re-`set`-ing the same cookie sends a fresh `Set-Cookie` and resets `maxAge` — usable as a sliding expiry but burns a header on every POST. For a 1-year cookie, just write once.

3. **SameSite=lax is correct here.** `strict` would block the cookie on cross-site top-level navigations (e.g., user clicks a tweet linking to your app — first request lands without cookie). `none` requires `secure` and is for true cross-site (we don't need it). Lax is the modern browser default anyway.

4. **HttpOnly means JS can't read it.** That's the point — but it also means client components cannot key local state on `device_id`. Either pass it down from a Server Component, or expose a separate non-httpOnly companion cookie if you need it client-side (you probably don't).

5. **Cookies and cached pages.** A page that calls `await cookies()` is forced into dynamic rendering (cookies.md L69). If you want `/` to stay static, do *not* read the device cookie in `app/layout.tsx` or `app/page.tsx` — only in `/history` or in a child Server Component fetched dynamically.

6. **Race on first hit.** If two POSTs from a brand-new device land concurrently (e.g., user double-clicks submit), each call independently sees no cookie and mints its own UUID. Browser keeps whichever `Set-Cookie` arrives last; the *first* request's row is now orphaned under a UUID the browser discarded. Mitigations: disable the submit button until response arrives (already standard UX), or accept the orphan (rare, no real harm — history just won't show it).

7. **HTTP no-set-after-stream rule** (cookies.md L73). Route handlers and server functions are fine because the response is constructed in one shot. If you ever stream a response (`ReadableStream`, server-sent events), set the cookie *before* you start streaming the body.

8. **Vercel Fluid Compute** runs your route handlers in Node — `crypto.randomUUID()` and `cookies()` both work. No special config.

9. **Don't mint in a `GET` route used by RSC prefetch.** Next will sometimes prefetch route handlers; setting a cookie there causes "phantom" identities. The submit POST is safe by definition.

10. **Proxy in Next 16 defaults to Node runtime, not Edge** (proxy.md L219, L771-L772). If you copy a Next 14 middleware that assumed Edge globals, behavior may differ — but for the cookie use case this only helps you (Node `crypto` always available).

---

## Sources

- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md` (HIGH — shipped with project)
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` (HIGH — shipped with project)
- MDN Cookies (referenced from cookies.md)
- Inferred: CDN cache interaction with `Set-Cookie` from proxy (LOW confidence — verify against Vercel/Fluid behavior before relying on it)
