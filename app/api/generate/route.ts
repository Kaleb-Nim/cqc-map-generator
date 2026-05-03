import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickValues, buildPrompt, formatHHMM, formatClock, formatPace } from '@/lib/generate';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const password = req.headers.get('x-generate-password') ?? '';
  const expected = process.env.GENERATE_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: 'Server misconfigured: GENERATE_PASSWORD not set' }, { status: 500 });
  }
  if (password !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Server misconfigured: OPENAI_API_KEY not set' }, { status: 500 });
  }

  const values = pickValues();
  const prompt = buildPrompt(values);

  const baseImagePath = join(process.cwd(), 'public', 'base.jpg');
  const baseImageBytes = readFileSync(baseImagePath);

  const client = new OpenAI({ apiKey });

  let pngBuf: Buffer;
  try {
    const imageFile = await toFile(new Blob([new Uint8Array(baseImageBytes)]), 'base.jpg', { type: 'image/jpeg' });
    const response = await client.images.edit({
      model: 'gpt-image-2' as never,
      image: imageFile,
      prompt,
      size: '1024x1536',
      quality: 'high' as never,
      input_fidelity: 'high' as never,
      output_format: 'png' as never,
      n: 1,
    });
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json({ error: 'No image returned from OpenAI' }, { status: 502 });
    }
    pngBuf = Buffer.from(b64, 'base64');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `OpenAI error: ${message}` }, { status: 502 });
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
