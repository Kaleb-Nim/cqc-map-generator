# Vercel Blob (public) for AI-generated images

**Researched:** 2026-05-03
**SDK version cited:** `@vercel/blob` **2.3.3** (npm `latest` at time of research)
**Use case:** Persist gpt-image-2 / WaveSpeed PNGs (signed, ephemeral CDN URL → permanent public Blob URL) and store the URL in Postgres.
**Overall confidence:** HIGH (Context7 + official Vercel docs)

---

## 1. Provisioning

A Vercel Blob "store" is a project-scoped object bucket. Two ways to create one:

**Dashboard:** Project → **Storage** tab → **Create Database** → **Blob** → name it (e.g. `run-map-images`) → **Create**. Vercel automatically links the store to the project and injects environment variables.

**CLI** (Bun-friendly, no global install needed):

```bash
bunx vercel link                           # link cwd to a Vercel project
bunx vercel blob store add run-map-images  # create the store
bunx vercel env pull .env.local            # pulls BLOB_READ_WRITE_TOKEN locally
```

**Env var injected:** `BLOB_READ_WRITE_TOKEN` — single secret, scoped per store. The SDK reads it from `process.env.BLOB_READ_WRITE_TOKEN` automatically when running on Vercel; locally you need it in `.env.local`. You can also pass `token` explicitly to `put()` for multi-store setups.

Confidence: HIGH (verified against `vercel/storage` docs and `vercel blob` CLI reference).

---

## 2. Server-side upload pattern (remote URL → Blob)

The `put()` function accepts `ReadableStream | String | ArrayBuffer | Blob | Buffer` as the body. For our case, `fetch()` returns a `Response` whose `.body` is a `ReadableStream<Uint8Array>` — pass it directly. **No need to buffer the entire image in memory.**

```ts
// app/api/persist-image/route.ts (Next.js 16 App Router, runtime: nodejs)
import { put } from '@vercel/blob';

export const runtime = 'nodejs'; // Edge also works, but Node gives more headroom

export async function POST(req: Request) {
  const { sourceUrl, runId } = (await req.json()) as {
    sourceUrl: string; // ephemeral WaveSpeed CDN URL
    runId: string;
  };

  const upstream = await fetch(sourceUrl);
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: 'fetch failed' }, { status: 502 });
  }

  // Stream straight into Blob — no full-image buffer in function memory.
  const blob = await put(`runs/${runId}.png`, upstream.body, {
    access: 'public',
    contentType: upstream.headers.get('content-type') ?? 'image/png',
    addRandomSuffix: true,        // see §3
    cacheControlMaxAge: 60 * 60 * 24 * 365, // 1 year (default is 1 month)
  });

  // Persist blob.url in Postgres next.
  return Response.json(blob);
}
```

`put()` returns:

```ts
{
  url: string;          // https://<storeId>.public.blob.vercel-storage.com/runs/<id>-<suffix>.png
  downloadUrl: string;  // same URL with ?download=1 (forces Content-Disposition: attachment)
  pathname: string;     // runs/<id>-<suffix>.png
  contentType: string;
  contentDisposition: string;
  contentLength?: number;
  etag: string;
  uploadedAt: string;   // ISO 8601
}
```

Persist `url` (the canonical, permanent CDN URL). Optionally also persist `pathname` so you can call `del(pathname)` later.

**Streaming caveat:** if the upstream response doesn't send `Content-Length`, the SDK still works because it streams chunked. For images >4.5 MB on Vercel, set `multipart: true` (parallel parts, retries) — see §6.

Confidence: HIGH.

---

## 3. Naming / keys

`pathname` is the only required positional. Folders are virtual (just `/` in the key). Two strategies:

| Strategy | Code | When to use |
|---|---|---|
| **Deterministic** (`addRandomSuffix: false`, the default) | `put('runs/2026-05-03-asics.png', body, { access:'public' })` | You want stable URLs, and you control uniqueness yourself (e.g. UUID in pathname). Throws if blob already exists unless `allowOverwrite: true`. |
| **Random suffix** (`addRandomSuffix: true`) | Pathname becomes `runs/2026-05-03-asics-NoOVGDVcqSPc7VYCUAGnTzLTG2qEM2.png` | Recommended by Vercel. Eliminates collision risk and makes URLs unguessable (security-by-obscurity, see §4). |

Recommendation for this project: **`addRandomSuffix: true` with a meaningful prefix** like `runs/<runId>.png`. You get unguessable URLs *and* a human-readable folder structure when browsing the dashboard.

Confidence: HIGH.

---

## 4. Public access semantics

From the official Security docs (`vercel.com/docs/vercel-blob/security`):

- **Access model:** any holder of the URL can `GET` the blob over HTTPS. There is no per-request auth, no signed URLs for public blobs, no expiry. Public Blob is essentially "S3 + public-read ACL behind Vercel's CDN."
- **Guessability:** URLs are `https://<storeId>.public.blob.vercel-storage.com/<pathname>`. The store ID is a random ~16-char string. With `addRandomSuffix: true`, a ~22-char random ID is appended to the filename, making URLs effectively unguessable. Without it, anyone who knows your store ID + pathname pattern can fetch the file. **Treat public Blob URLs as bearer tokens, not as secrets.**
- **Revocation:** the only way to revoke access is to `del(url | pathname)`. There are no ACL flips and no TTLs. If you need expiring/revocable access, use `access: 'private'` instead and mint signed URLs (different feature, different cost — Private Data Transfer is ~3× more expensive per GB).
- **Built-in security headers** on every public response: `content-security-policy`, `x-frame-options`, `x-content-type-options` — prevents the URL from being abused as a script/iframe origin.

For run-map images (non-sensitive, shareable), `public + addRandomSuffix` is the right call.

Confidence: HIGH.

---

## 5. Pricing reality check

Source: `vercel.com/docs/vercel-blob/usage-and-pricing` (verified 2026-05-03).

**Hobby plan included monthly:** 1 GB storage · 10,000 Simple Ops · 2,000 Advanced Ops · 10 GB data transfer.

**On-demand rates (after included):**

| Metric | Rate |
|---|---|
| Storage | $0.023 / GB-month |
| Simple Operations (cache misses, GET on origin) | $0.40 / 1M |
| Advanced Operations (PUT, LIST, DELETE) | $5.00 / 1M |
| Data Transfer (CDN egress) | $0.05 / GB |

**Back-of-envelope for this project** (2 MB avg per image):

| Scale | Storage | Uploads (Adv Ops) | Estimated monthly cost |
|---|---|---|---|
| 500 images | ~1.0 GB | 500 | **$0.00** (within Hobby free tier) |
| 2,000 images | ~4.0 GB | 2,000 | ~$0.07 storage overage; ops still free → **~$0.07/mo** |
| 10,000 images, 100k views/mo | ~20 GB | 10,000 | ~$0.44 storage + ~$0.05 ops + ~$10 transfer (200 GB @ avg cache hit) → **~$10/mo** |

For personal-use scale (a few hundred to a few thousand 1-3 MB images) you stay within the Hobby allowance or pay literal cents. The line item that bites at scale is **data transfer**, not storage.

Confidence: HIGH (rates current as of 2026-05-03; Vercel revises pricing periodically — re-check before billing-sensitive decisions).

---

## 6. Pitfalls

### 6a. The 4.5 MB body limit is about the **incoming request**, not the Blob upload

Vercel Functions reject incoming request bodies >4.5 MB. This matters for **client → your route handler** uploads, not for **server → Blob** uploads, which are made from inside the function and have no such limit. Our flow (WaveSpeed URL → server fetch → server `put()`) is unaffected: the function never sees the bytes as a request body.

If you ever let users upload images directly through your API, switch to **client uploads** (`@vercel/blob/client` `upload()` with a token-issuing route handler) or **multipart**. For server-to-server fetch-and-put like ours, just `put()` directly.

### 6b. Streaming vs buffering

Passing `Response.body` (a `ReadableStream`) into `put()` is the streaming path — memory stays bounded regardless of image size. If you `await upstream.arrayBuffer()` first, you'll allocate the full image in function RAM, which on Fluid Compute defaults to ~1 GB but still wastes resources. Prefer the stream form shown in §2.

### 6c. Multipart for large files

Vercel recommends `multipart: true` for any upload >4.5 MB to get parallel parts + automatic retry of failed parts. gpt-image-2 PNGs at typical resolutions (~1024×1024) are 1-3 MB so single-part is fine; if you ever generate higher-res or batched outputs, flip the flag:

```ts
await put(`runs/${runId}.png`, upstream.body, {
  access: 'public',
  multipart: true, // safe to always-on; small files just send one part
});
```

### 6d. Cache-Control default is one month

Default `cacheControlMaxAge` is 30 days. For immutable run-map images (URL is unique per generation) bump to 1 year so CDN edges hold them longer and Simple Ops stay near zero. Minimum allowed is 60 seconds.

### 6e. Cleanup / lifecycle

Blob has **no built-in lifecycle policies / TTL**. If a user deletes a run, you must explicitly call `del(blob.url | pathname, { token? })`. Build a Postgres-side cleanup hook from day one — orphaned blobs accrue storage charges silently. There is no "expire after N days" knob.

### 6f. `allowOverwrite` defaults to `false`

If you re-upload the same deterministic pathname, the second call throws. Either use `addRandomSuffix: true` (recommended) or pass `allowOverwrite: true` explicitly.

### 6g. Edge runtime works but Node is safer

`put()` works on both Edge and Node runtimes. Edge has tighter memory/time caps; for fetch-and-pipe of multi-MB images, prefer `runtime: 'nodejs'` on Fluid Compute — you get longer execution windows and Node streams that compose naturally with `Response.body`.

### 6h. Region pricing varies

Most US regions match the canonical $0.023/GB / $0.05/GB-egress numbers. International regions (e.g. `dxb1` Dubai) charge ~10-120 % more. The Blob store lives in the region you pick at creation; pick to match your primary user region and Postgres region.

Confidence: HIGH on 6a–6f; MEDIUM on 6h (verified for `cle1` and `dxb1` only).

---

## Sources

- Context7 `/vercel/storage` — `put()` API reference, multipart, options
- Context7 `/websites/vercel` — full Vercel docs mirror (pricing, security, public storage)
- https://vercel.com/docs/vercel-blob/using-blob-sdk
- https://vercel.com/docs/vercel-blob/public-storage
- https://vercel.com/docs/vercel-blob/security
- https://vercel.com/docs/vercel-blob/usage-and-pricing
- https://vercel.com/docs/cli/blob
- npm registry: `@vercel/blob@2.3.3` (verified 2026-05-03)
