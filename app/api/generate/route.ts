import { NextRequest, NextResponse } from 'next/server';
import { pickValues, buildPrompt, formatHHMM, formatClock, formatPace } from '@/lib/generate';

export const runtime = 'nodejs';
export const maxDuration = 300;

const WAVESPEED_ENDPOINT = 'https://api.wavespeed.ai/api/v3/openai/gpt-image-2/edit';

type WaveSpeedResponse = {
  code: number;
  message: string;
  data?: {
    id: string;
    status: 'created' | 'processing' | 'completed' | 'failed';
    outputs?: string[];
    error?: string;
  };
};

export async function POST(req: NextRequest) {
  const password = req.headers.get('x-generate-password') ?? '';
  const expected = process.env.GENERATE_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: 'Server misconfigured: GENERATE_PASSWORD not set' }, { status: 500 });
  }
  if (password !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.WAVESPEED_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Server misconfigured: WAVESPEED_API_KEY not set' }, { status: 500 });
  }

  const values = pickValues();
  const prompt = buildPrompt(values);

  // WaveSpeed needs a publicly accessible image URL.
  // public/base.jpg is served at <origin>/base.jpg by Next.js.
  const origin = req.nextUrl.origin;
  const baseImageUrl = `${origin}/base.jpg`;

  let pngBuf: Buffer;
  try {
    // Step 1: submit async task
    const submit = await fetch(WAVESPEED_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        images: [baseImageUrl],
        prompt,
        aspect_ratio: '9:16',
        resolution: '1k',
        quality: 'high',
        enable_sync_mode: false,
        enable_base64_output: true,
      }),
    });

    if (!submit.ok) {
      const text = await submit.text();
      return NextResponse.json(
        { error: `WaveSpeed HTTP ${submit.status}: ${text.slice(0, 500)}` },
        { status: 502 },
      );
    }

    const submitJson = (await submit.json()) as WaveSpeedResponse;
    if (submitJson.code !== 200 || !submitJson.data?.id) {
      return NextResponse.json(
        { error: `WaveSpeed submit failed: code ${submitJson.code}, msg "${submitJson.message}"` },
        { status: 502 },
      );
    }

    const taskId = submitJson.data.id;

    // Step 2: poll for result (Vercel maxDuration=300s, leave headroom)
    const pollUrl = `https://api.wavespeed.ai/api/v3/predictions/${taskId}/result`;
    const deadline = Date.now() + 270_000;
    const pollIntervalMs = 3000;
    let final: WaveSpeedResponse['data'] | null = null;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const poll = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!poll.ok) {
        const text = await poll.text();
        return NextResponse.json(
          { error: `WaveSpeed poll HTTP ${poll.status}: ${text.slice(0, 300)}` },
          { status: 502 },
        );
      }
      const pollJson = (await poll.json()) as WaveSpeedResponse;
      if (pollJson.code !== 200 || !pollJson.data) {
        return NextResponse.json(
          { error: `WaveSpeed poll code ${pollJson.code}: ${pollJson.message}` },
          { status: 502 },
        );
      }
      const status = pollJson.data.status;
      if (status === 'completed') {
        final = pollJson.data;
        break;
      }
      if (status === 'failed') {
        return NextResponse.json(
          { error: `WaveSpeed task failed: ${pollJson.data.error ?? 'unknown'}` },
          { status: 502 },
        );
      }
      // 'created' or 'processing' → keep polling
    }

    if (!final || !final.outputs?.[0]) {
      return NextResponse.json(
        { error: `WaveSpeed task did not complete within 270s (id=${taskId})` },
        { status: 504 },
      );
    }

    const output = final.outputs[0];
    // With enable_base64_output: true, output is a base64 string (with or without data: prefix).
    // With enable_base64_output: false, output is a URL — handle both for safety.
    if (output.startsWith('http://') || output.startsWith('https://')) {
      const imgRes = await fetch(output);
      if (!imgRes.ok) {
        return NextResponse.json({ error: `Failed to fetch image: ${imgRes.status}` }, { status: 502 });
      }
      pngBuf = Buffer.from(await imgRes.arrayBuffer());
    } else {
      const b64 = output.replace(/^data:[^;]+;base64,/, '');
      pngBuf = Buffer.from(b64, 'base64');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `WaveSpeed error: ${message}` }, { status: 502 });
  }

  const meta = {
    values: {
      ...values,
      formatted: {
        screenshot_time_from: formatHHMM(values.screenshot_time_from),
        screenshot_time_to: formatHHMM(values.screenshot_time_to),
        timing_from: formatClock(values.timing_from_sec),
        timing_to: formatClock(values.timing_to_sec),
        pace_from: formatPace(values.pace_from_sec_per_km),
        pace_to: formatPace(values.pace_to_sec_per_km),
      },
    },
    prompt,
  };

  return new NextResponse(new Uint8Array(pngBuf), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="run-map-${Date.now()}.png"`,
      'X-Generate-Meta': Buffer.from(JSON.stringify(meta)).toString('base64'),
    },
  });
}
