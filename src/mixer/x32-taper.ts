/**
 * The X32 fader taper: a 0..1 float on a four-segment piecewise-linear dB
 * scale, from -90 dB (shown on the board as -∞) at 0 to +10 dB at 1.
 *
 *   fader   0      0.0625   0.25   0.5    0.75   1
 *   dB     -90    -60      -30    -10     0     +10
 *
 * Ported from Bitfocus Companion's X32 module (src/util.ts, MIT), with
 * clamping added on the dB side: theirs turns -120 dB into a negative fader.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function faderToDb(f: number): number {
  const x = clamp(f, 0, 1);
  if (x >= 0.5) return x * 40 - 30;
  if (x >= 0.25) return x * 80 - 50;
  if (x >= 0.0625) return x * 160 - 70;
  return x * 480 - 90;
}

export function dbToFader(db: number): number {
  const d = clamp(db, -90, 10);
  if (d < -60) return (d + 90) / 480;
  if (d < -30) return (d + 70) / 160;
  if (d < -10) return (d + 50) / 80;
  return (d + 30) / 40;
}
