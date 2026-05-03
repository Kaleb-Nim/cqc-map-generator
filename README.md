# Run Map Generator

A small Next.js app that generates randomized variants of a fitness-tracker workout-details screenshot via OpenAI's `gpt-image-2` edit endpoint.

Click **Generate** → server picks believable random values (distance, pace, timing, elevation, cadence, battery, time-of-day) with `distance × pace = elapsed` math consistency → calls GPT Image with a prompt template + the base screenshot → returns a PNG to download.

## Stack

- Next.js 16 (App Router) on Vercel Functions
- WaveSpeed AI gateway → OpenAI `gpt-image-2` edit endpoint
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
| `WAVESPEED_API_KEY` | WaveSpeed AI key (provides gpt-image-2 access without OpenAI org verification) |
| `GENERATE_PASSWORD` | Long random string — gates the API |

Function `maxDuration` is set to 300s in `app/api/generate/route.ts`. Vercel Hobby plan supports this.

## Cost

Each generation is one WaveSpeed `gpt-image-2/edit` call at `aspect_ratio: 9:16`, `resolution: 1k`, `quality: high`. Pricing per WaveSpeed's published rates.

## Security

- The `/api/generate` endpoint requires `x-generate-password` header matching `GENERATE_PASSWORD`. The UI stores the password in `localStorage` after first entry.
- The repo is private. The Vercel deployment URL is public — protection comes from the password.
- A 401 response automatically clears the cached password client-side.

## Files

- `app/page.tsx` — single-button UI with password gate
- `app/api/generate/route.ts` — POST endpoint that calls OpenAI
- `lib/generate.ts` — pure value-picking + prompt builder (no I/O, easy to test)
- `public/base.jpg` — the base screenshot used for every edit
