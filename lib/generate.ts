// Pure value generation + prompt construction. No I/O, no network — easy to test.

export type Values = {
  screenshot_time_from: { h: number; m: number };
  screenshot_time_to: { h: number; m: number };
  battery_pct: number;
  distance_from_km: number;
  distance_to_km: number;
  pace_from_sec_per_km: number;
  pace_to_sec_per_km: number;
  timing_from_sec: number;
  timing_to_sec: number;
  elevation_from_m: number;
  elevation_to_m: number;
  cadence_from_spm: number;
  cadence_to_spm: number;
  green_marker_px: number;
  red_marker_px: number;
};

export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickValues(rng: () => number = Math.random): Values {
  const randInt = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
  const randFloat = (min: number, max: number) => rng() * (max - min) + min;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

  const hFrom = randInt(5, 22);
  const mFrom = randInt(0, 59);
  const bumpMin = randInt(1, 5);
  const totalMinTo = (hFrom * 60 + mFrom + bumpMin) % (24 * 60);
  const hTo = Math.floor(totalMinTo / 60);
  const mTo = totalMinTo % 60;

  const battery_pct = randInt(25, 65);

  const distance_to_km = Math.round(randFloat(2.5, 5.0) * 10) / 10;
  const pace_to_sec_per_km = randInt(330, 690);
  const timing_to_sec = Math.round(distance_to_km * pace_to_sec_per_km);

  const distFromRaw = distance_to_km + (rng() < 0.5 ? -1 : 1) * randFloat(0.4, 1.2);
  const distance_from_km = Math.round(clamp(distFromRaw, 2.5, 5.0) * 10) / 10;
  const paceFromRaw = pace_to_sec_per_km + (rng() < 0.5 ? -1 : 1) * randInt(60, 240);
  const pace_from_sec_per_km = clamp(paceFromRaw, 330, 690);
  const timing_from_sec = Math.round(distance_from_km * pace_from_sec_per_km);

  const elevation_from_m = randInt(2, 5);
  let elevation_to_m = randInt(2, 5);
  while (elevation_to_m === elevation_from_m) elevation_to_m = randInt(2, 5);

  const cadence_from_spm = randInt(80, 130);
  const cadence_to_spm = randInt(140, 200);

  const green_marker_px = randInt(20, 200);
  const red_marker_px = randInt(20, 100);

  return {
    screenshot_time_from: { h: hFrom, m: mFrom },
    screenshot_time_to: { h: hTo, m: mTo },
    battery_pct,
    distance_from_km,
    distance_to_km,
    pace_from_sec_per_km,
    pace_to_sec_per_km,
    timing_from_sec,
    timing_to_sec,
    elevation_from_m,
    elevation_to_m,
    cadence_from_spm,
    cadence_to_spm,
    green_marker_px,
    red_marker_px,
  };
}

const pad2 = (n: number) => n.toString().padStart(2, '0');
export const formatHHMM = (t: { h: number; m: number }) => `${t.h}:${pad2(t.m)}`;
export const formatClock = (sec: number) => {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}:${pad2(m)}:${pad2(s)}`;
  }
  return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`;
};
export const formatPace = (sec: number) => `${pad2(Math.floor(sec / 60))}'${pad2(sec % 60)}"`;

export function buildPrompt(v: Values): string {
  return [
    `change screenshot time from ${formatHHMM(v.screenshot_time_from)} to ${formatHHMM(v.screenshot_time_to)},`,
    `battery percentage to ${v.battery_pct}%,`,
    `Distance covered from ${v.distance_from_km}km to ${v.distance_to_km}km,`,
    `timing from ${formatClock(v.timing_from_sec)} to ${formatClock(v.timing_to_sec)}.`,
    `Move the green circle slightly back. Do not change the aspect ratio for the image. add black padding to compensate.`,
    `Move the green circular start/position marker ${v.green_marker_px}px along the blue route.`,
    `Move the red circular end marker back ${v.red_marker_px}px along the blue route, blue route should end at the new red marker position.`,
    `Elevation gain ${v.elevation_from_m}m to ${v.elevation_to_m}m`,
    `Pace average from ${formatPace(v.pace_from_sec_per_km)} to ${formatPace(v.pace_to_sec_per_km)}`,
    `Cadence average from ${v.cadence_from_spm}spm to ${v.cadence_to_spm}spm`,
    `fill the green and blue bars empty gaps, add variance in height equally at the same timings for pace and cadence blue bars.`,
  ].join(' ');
}
