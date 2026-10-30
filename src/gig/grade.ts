/**
 * The final video's grade: each song's brightness levels matched to a common
 * target as the light changes through it, then a warmer, more colourful look
 * over the whole gig.
 *
 * Levels are the 5th, 50th and 95th percentiles of a frame's brightness (luma,
 * as the video stores it, over 255), measured inside the crop twice a second
 * (see levels-cli.ts). At each sample, ffmpeg's `eq` filter is set so those
 * three land on the target. `eq` maps a brightness x to
 *
 *   (contrast * (x - 0.5) + 0.5 + brightness) ^ (1 / gamma)
 *
 * which has three settings, so it can take any three increasing levels to any
 * other three. The settings move in straight lines from one sample to the next.
 */

import { num, sum } from "./crop.js";
import { lambdaFor, smoothCurve } from "./follow.js";

export interface Levels {
  low: number;
  mid: number;
  high: number;
}

export interface LevelsSample extends Levels {
  /** Seconds into the phone video. */
  t: number;
}

/** The settings of ffmpeg's `eq` filter that shape brightness. */
export interface Eq {
  contrast: number;
  brightness: number;
  gamma: number;
}

export interface Grade extends Levels {
  /** Colour saturation, 1 for unchanged. */
  saturation: number;
  /** The light the picture is shifted towards, in kelvin; 6500 for unchanged, lower for warmer. */
  temperature: number;
}

/**
 * The grade unless gig.json changes it. The targets suit this gig's iPhone
 * footage: shadows a little deeper and midtones a little brighter than the
 * songs typically were, for less haze and more sun, then a touch warmer and
 * more colourful. `smooth` is how many seconds the levels change over.
 */
export const DEFAULT_GRADE: Grade & { smooth: number } = { low: 0.2, mid: 0.47, high: 0.72, saturation: 1.08, temperature: 5900, smooth: 20 };

/** What `eq` does to a brightness from 0 to 1, as ffmpeg computes it (vf_eq.c, before rounding to a code). */
export function eqCurve(e: Eq, x: number): number {
  const v = e.contrast * (x - 0.5) + 0.5 + e.brightness;
  return v <= 0 ? 0 : Math.min(1, v ** (1 / e.gamma));
}

/**
 * The `eq` settings that take three increasing levels `from` to `to`. With y
 * raised to gamma, the curve is a straight line in x, so gamma is the power
 * that puts the three targets on one line; contrast and brightness are that line.
 */
export function fitEq(from: [number, number, number], to: [number, number, number]): Eq {
  const [x1, x2, x3] = from;
  const bend = (g: number) => (to[1] ** g - to[0] ** g) / (x2 - x1) - (to[2] ** g - to[1] ** g) / (x3 - x2);
  // A smaller gamma bends the line one way and a larger the other, so the root is bracketed.
  let [lo, hi] = [0.2, 5];
  if (Math.sign(bend(lo)) === Math.sign(bend(hi))) {
    // No exact fit (the targets bend too far for `eq`): take the closest on a grid.
    let best = 1;
    for (let g = lo; g <= hi; g += 0.01) if (Math.abs(bend(g)) < Math.abs(bend(best))) best = g;
    [lo, hi] = [best, best];
  }
  for (let k = 0; k < 60 && hi - lo > 1e-12; k++) {
    const m = (lo + hi) / 2;
    if (Math.sign(bend(m)) === Math.sign(bend(lo))) lo = m;
    else hi = m;
  }
  const gamma = (lo + hi) / 2;
  // The least-squares line through the three points, exact when gamma is.
  const ys = to.map((y) => y ** gamma);
  const mx = (x1 + x2 + x3) / 3, my = (ys[0] + ys[1] + ys[2]) / 3;
  const slope = from.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / from.reduce((s, x) => s + (x - mx) ** 2, 0);
  const intercept = my - slope * mx;
  return { contrast: slope, brightness: intercept - 0.5 + 0.5 * slope, gamma };
}

/** A frame's levels, from its brightness codes. */
export function levelsOf(frame: Uint8Array): Levels {
  const sorted = Uint8Array.from(frame).sort();
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] / 255;
  return { low: at(0.05), mid: at(0.5), high: at(0.95) };
}

/**
 * Levels that change only as fast as the light does, over about `seconds`:
 * a running median of five samples drops frames where something passes the
 * lens, then a smoother turns steps into ramps.
 */
export function smoothLevels(samples: LevelsSample[], seconds: number): LevelsSample[] {
  if (samples.length < 3) return samples;
  const rate = (samples.length - 1) / (samples[samples.length - 1].t - samples[0].t);
  const lambda = lambdaFor(seconds, rate);
  const one = (get: (s: LevelsSample) => number) => {
    const y = samples.map((_, i) => {
      const near = samples.slice(Math.max(0, i - 2), i + 3).map(get).sort((a, b) => a - b);
      return near[near.length >> 1];
    });
    return smoothCurve(y, y.map(() => 1), [], lambda, { robust: false });
  };
  const [low, mid, high] = [one((s) => s.low), one((s) => s.mid), one((s) => s.high)];
  return samples.map((s, i) => ({ t: s.t, low: low[i], mid: mid[i], high: high[i] }));
}

/**
 * The `eq` filter that brings each sample's levels to `target`. `start` is the
 * phone video's time at the cut's first frame, where ffmpeg's frame count `n`
 * starts from 0.
 */
export function levelsFilter(samples: LevelsSample[], target: Levels, v: { start: number; fps: number }, saturation = 1): string {
  const eqs = samples.map((s) => fitEq([s.low, s.mid, s.high], [target.low, target.mid, target.high]));
  const frames = samples.map((s) => (s.t - v.start) * v.fps);
  const over = (get: (e: Eq) => number) => {
    const terms = [num(get(eqs[0]))];
    for (let k = 1; k < eqs.length; k++) {
      const d = get(eqs[k]) - get(eqs[k - 1]);
      if (d !== 0) terms.push(`${num(d)}*clip((n-${num(frames[k - 1])})/${num(frames[k] - frames[k - 1])},0,1)`);
    }
    return sum(terms);
  };
  const opts = [`contrast='${over((e) => e.contrast)}'`, `brightness='${over((e) => e.brightness)}'`, `gamma='${over((e) => e.gamma)}'`];
  if (saturation !== 1) opts.push(`saturation=${num(saturation)}`);
  return `eq=${opts.join(":")}:eval=${eqs.length > 1 ? "frame" : "init"}`;
}

/** The whole grade's filters: matched levels (when measured), saturation, then warmth; undefined when it changes nothing. */
export function gradeFilter(samples: LevelsSample[] | null, g: Grade, v: { start: number; fps: number }): string | undefined {
  const filters: string[] = [];
  if (samples?.length) filters.push(levelsFilter(samples, g, v, g.saturation));
  else if (g.saturation !== 1) filters.push(`eq=saturation=${num(g.saturation)}`);
  if (g.temperature !== 6500) filters.push(`colortemperature=temperature=${num(g.temperature)}:pl=1`);
  return filters.length ? filters.join(",") : undefined;
}
