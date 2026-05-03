# Run Map Generator

A small Next.js app that generates randomized variants of a fitness-tracker workout-details screenshot via OpenAI's `gpt-image-2` edit endpoint.

Click **Generate** → server picks believable random values (distance, pace, timing, elevation, cadence, battery, time-of-day) with `distance × pace = elapsed` math consistency → calls GPT Image with a prompt template + the base screenshot → returns a PNG to download.

## Stack

- Next.js 16 (App Router) on Vercel Functions
- OpenAI SDK (`gpt-image-2`, `input_fidelity: high`)
- Tailwind CSS
- Bun

## Local development

```bash
bun install
cp .env.example .env.local
# fill in OPENAI_API_KEY and GENERATE_PASSWORD
bun dev
```

Open <http://localhost:3000>, enter the password, click Generate.

## Deployment

Set on Vercel (Project → Settings → Environment Variables):

| Name | Value |
|------|-------|
| `OPENAI_API_KEY` | OpenAI key from a verified org (gpt-image-2 requires org verification) |
| `GENERATE_PASSWORD` | Long random string — gates the API |

Function `maxDuration` is set to 300s in `app/api/generate/route.ts`. Vercel Hobby plan supports this.

## Cost

Each generation is one `gpt-image-2` `images.edit` call at `1024x1536`, `quality: high`, `input_fidelity: high`. Roughly **$0.10 – $0.20 per image** depending on token usage.

## Security

- The `/api/generate` endpoint requires `x-generate-password` header matching `GENERATE_PASSWORD`. The UI stores the password in `localStorage` after first entry.
- The repo is private. The Vercel deployment URL is public — protection comes from the password.
- A 401 response automatically clears the cached password client-side.

## Files

- `app/page.tsx` — single-button UI with password gate
- `app/api/generate/route.ts` — POST endpoint that calls OpenAI
- `lib/generate.ts` — pure value-picking + prompt builder (no I/O, easy to test)
- `public/base.jpg` — the base screenshot used for every edit
