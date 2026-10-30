/**
 * Crop curves: the box as smooth functions of time (centre, size, turn), which
 * can follow the band and are pinned by knots the user places.
 *
 * With `follow`, the box is framed on the band: the smallest 16:9 box holding
 * everyone found nearby in time (see people.swift), smoothed but never tighter
 * than that, so nobody is cut. Its turn follows the camera's measured roll
 * (see motion.ts), so the picture stays level; the earliest knot's angle sets
 * the level. Without `follow`, the curves just run smoothly from knot to knot.
 * Either way the curves pass through every knot, and the box is kept on the
 * picture. The picker page runs these same functions, bundled for the browser,
 * so what you see there is what the render cuts.
 */

import { corners } from "./crop.js";
import type { MotionSample, Similarity } from "./motion.js";

/** People found in a frame (see people.swift): [x, y, w, h, confidence], fractions of the frame from its top-left. */
export interface PeopleSample {
  t: number;
  boxes: number[][];
}

/** How the band is framed: everyone found within `window` seconds, with margins, ignoring finds below `minConfidence`. */
export const BAND = { window: 2, marginX: 0.04, marginTop: 0.06, marginBottom: 0.04, minConfidence: 0.4 };

export interface Box {
  x: number;
  y: number;
  size: number;
  angle: number;
}

export interface Knot extends Box {
  /** Seconds into the phone video. */
  at: number;
  /**
   * How far the knot's pull reaches, in seconds: it falls off like a normal
   * curve around `at`, `width` being twice its standard deviation. 0 (the
   * default) pulls at a single moment.
   */
  width?: number;
  /** How hard the knot pulls at its peak, 0 to 1: 1 (the default) pins the curve, less only nudges it. */
  strength?: number;
}

/** A knot's weight in the curve fit for its strength: from about the samples' own weight up to a pin. */
export function knotWeight(strength = 1): number {
  return 10 ** (6 * Math.min(Math.max(strength, 0), 1));
}

export interface CurveCrop {
  follow: boolean;
  /** The curves' time scale, in seconds: how far a knot's pull spreads, and how much camera wobble is smoothed away. */
  smooth: number;
  knots: Knot[];
}

export interface PathPoint extends Box {
  t: number;
}

/** How many seconds a curve crop smooths over unless gig.json says otherwise. */
export const DEFAULT_SMOOTH = 12;

/** The Whittaker smoother's weight for a curve that smooths over `seconds`, sampled `rate` times a second. */
export function lambdaFor(seconds: number, rate: number): number {
  return ((seconds * rate) / (2 * Math.PI)) ** 4;
}

/**
 * A smooth curve through samples `y` (with weights `w`) that passes through
 * each pin: it minimises the weighted misfit plus `lambda` times the squared
 * second differences. Samples far from the curve are down-weighted and it is
 * refitted, so a few bad ones don't pull it; `robust: false` skips that and fits
 * once. With `floor`, it is instead kept at or above the samples.
 */
export function smoothCurve(y: number[], w: number[], pins: { i: number; v: number; w?: number }[], lambda: number, opts: { floor?: boolean; robust?: boolean } = {}): number[] {
  const n = y.length;
  const PIN = 1e6;
  // Where a pin holds the curve, the floor doesn't: there the user has chosen.
  const pinned = new Set(pins.map((p) => p.i));
  let weights = w.slice();
  let z = y.slice();
  for (let pass = 0; pass < (opts.floor ? 12 : opts.robust === false ? 1 : 4); pass++) {
    // The system is symmetric with two bands either side of the diagonal.
    const d0 = new Float64Array(n), d1 = new Float64Array(n), d2 = new Float64Array(n), b = new Float64Array(n);
    for (let i = 0; i < n; i++) { d0[i] = weights[i]; b[i] = weights[i] * y[i]; }
    for (const p of pins) { const pw = p.w ?? PIN; d0[p.i] += pw; b[p.i] += pw * p.v; }
    for (let i = 0; i + 2 < n; i++) {
      const c = [1, -2, 1];
      for (let a = 0; a < 3; a++) {
        d0[i + a] += lambda * c[a] * c[a];
        if (a < 2) d1[i + a] += lambda * c[a] * c[a + 1];
        if (a < 1) d2[i + a] += lambda * c[a] * c[a + 2];
      }
    }
    // Banded Cholesky: A = L D L', L unit lower with two sub-diagonals.
    const D = new Float64Array(n), l1 = new Float64Array(n), l2 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      D[i] = d0[i] - (i >= 1 ? l1[i - 1] ** 2 * D[i - 1] : 0) - (i >= 2 ? l2[i - 2] ** 2 * D[i - 2] : 0);
      if (i + 1 < n) l1[i] = (d1[i] - (i >= 1 ? l2[i - 1] * l1[i - 1] * D[i - 1] : 0)) / D[i];
      if (i + 2 < n) l2[i] = d2[i] / D[i];
    }
    const u = new Float64Array(n);
    for (let i = 0; i < n; i++) u[i] = b[i] - (i >= 1 ? l1[i - 1] * u[i - 1] : 0) - (i >= 2 ? l2[i - 2] * u[i - 2] : 0);
    z = new Array(n);
    for (let i = n - 1; i >= 0; i--) z[i] = u[i] / D[i] - (i + 1 < n ? l1[i] * z[i + 1] : 0) - (i + 2 < n ? l2[i] * z[i + 2] : 0);
    // With a floor, samples the curve dips below count heavily, so it settles at or above them.
    if (opts.floor) {
      weights = w.map((wi, i) => (z[i] < y[i] && !pinned.has(i) ? wi * 1000 : wi));
      continue;
    }
    const used = y.map((v, i) => ({ r: Math.abs(v - z[i]), i })).filter(({ i }) => w[i] > 0);
    if (!used.length) break;
    const sigma = Math.max(1.4826 * used.map((u) => u.r).sort((a, c) => a - c)[used.length >> 1], 1e-6);
    weights = w.map((wi, i) => { const r = Math.abs(y[i] - z[i]) / (4.685 * sigma); return r < 1 ? wi * (1 - r * r) ** 2 : 0; });
  }
  return z;
}

/** For each sample, the box that holds the band: everyone found within BAND.window seconds, with margins. */
export function bandNeed(people: PeopleSample[]): { size: number; cx: number; cy: number }[] {
  return people.map((p) => {
    const near = people.filter((q) => Math.abs(q.t - p.t) <= BAND.window).flatMap((q) => q.boxes.filter((b) => b[4] >= BAND.minConfidence));
    if (!near.length) return { size: 1, cx: 0.5, cy: 0.5 };
    const left = Math.min(...near.map((b) => b[0])), right = Math.max(...near.map((b) => b[0] + b[2]));
    const top = Math.min(...near.map((b) => b[1])) - BAND.marginTop, bottom = Math.max(...near.map((b) => b[1] + b[3])) + BAND.marginBottom;
    // A box of size s is s of the width and s of the height, so the wider need sets it.
    return { size: Math.min(1, Math.max(right - left + 2 * BAND.marginX, bottom - top)), cx: (left + right) / 2, cy: (top + bottom) / 2 };
  });
}

/**
 * The box kept on the picture: as wide as asked, unless the turn means only a
 * smaller box fits even in the middle of the frame; then placed as near where
 * asked as fits, sliding toward the middle rather than shrinking further.
 */
export function fitOnPicture(box: Box, width: number, height: number): Box {
  const fits = (b: Box) =>
    b.x >= -1e-9 && b.y >= -1e-9 && b.x + b.size <= 1 + 1e-9 && b.y + b.size <= 1 + 1e-9 &&
    corners(b, width, height).every(([px, py]) => px >= -0.5 && py >= -0.5 && px <= width + 0.5 && py <= height + 0.5);
  if (fits(box)) return box;
  const at = (cx: number, cy: number, size: number): Box => ({ x: Math.min(Math.max(cx - size / 2, 0), 1 - size), y: Math.min(Math.max(cy - size / 2, 0), 1 - size), size, angle: box.angle });
  let size = Math.min(box.size, 1);
  if (!fits(at(0.5, 0.5, size))) {
    let lo = 0.2, hi = size;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(at(0.5, 0.5, mid))) lo = mid; else hi = mid; }
    size = lo;
  }
  const cx = box.x + box.size / 2, cy = box.y + box.size / 2;
  const toward = (u: number) => at(cx + (0.5 - cx) * u, cy + (0.5 - cy) * u, size);
  if (fits(toward(0))) return toward(0);
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(toward(mid))) hi = mid; else lo = mid; }
  return toward(hi);
}

/** The crop at each of `times` (evenly spaced), with the camera's motion and the people found at each if following. */
export function cropPath(times: number[], motion: (Similarity & Pick<MotionSample, "lost">)[] | null, people: PeopleSample[] | null, crop: CurveCrop, width: number, height: number): PathPoint[] {
  const n = times.length, rate = n > 1 ? 1 / (times[1] - times[0]) : 1;
  const index = (t: number) => Math.min(n - 1, Math.max(0, Math.round((t - times[0]) * rate)));
  const knots = [...crop.knots].sort((a, b) => a.at - b.at);
  const first = knots[0];
  const lambda = lambdaFor(crop.smooth, rate);
  /** Each knot's pull on a curve: its strength at its time, falling off like a normal curve out to three standard deviations. */
  const pins = (get: (b: Box) => number) =>
    knots.flatMap((k) => {
      const sd = (k.width ?? 0) / 2;
      if (sd === 0) return [{ i: index(k.at), v: get(k), w: knotWeight(k.strength) }];
      const from = index(k.at - 3 * sd), to = index(k.at + 3 * sd);
      return Array.from({ length: to - from + 1 }, (_, j) => {
        const t = times[from + j];
        return { i: from + j, v: get(k), w: knotWeight(k.strength) * Math.exp(-((t - k.at) ** 2) / (2 * sd * sd)) };
      });
    });
  let cx: number[], cy: number[], size: number[], angle: number[];
  if (crop.follow && people) {
    const need = bandNeed(people);
    const at = (i: number) => need[Math.min(need.length - 1, i)];
    const w = times.map(() => 1);
    size = smoothCurve(times.map((_, i) => at(i).size), w, pins((b) => b.size), lambda, { floor: true });
    cx = smoothCurve(times.map((_, i) => at(i).cx), w, pins((b) => b.x + b.size / 2), lambda);
    cy = smoothCurve(times.map((_, i) => at(i).cy), w, pins((b) => b.y + b.size / 2), lambda);
  } else {
    // Hold each knot until halfway to the next; the smoothing rounds the steps off.
    const held = first ? times.map((t) => knots.reduce((best, k) => (Math.abs(k.at - t) < Math.abs(best.at - t) ? k : best))) : times.map(() => ({ x: 0, y: 0, size: 1, angle: 0 }));
    const w = times.map(() => 0.05);
    size = smoothCurve(held.map((b) => b.size), w, pins((b) => b.size), lambda);
    cx = smoothCurve(held.map((b) => b.x + b.size / 2), w, pins((b) => b.x + b.size / 2), lambda);
    cy = smoothCurve(held.map((b) => b.y + b.size / 2), w, pins((b) => b.y + b.size / 2), lambda);
  }
  if (crop.follow && motion) {
    // Level: undo the camera's roll since the earliest knot (or the start), at that knot's angle.
    // Where the camera fit was lost, hold the last good turn, lightly, rather than letting the curve run off.
    const good = (i: number) => { for (let j = i; j >= 0; j--) if (!motion[j].lost) return motion[j]; return motion.find((m) => !m.lost) ?? motion[0]; };
    const ref = good(first ? index(first.at) : 0).angle, level = first ? first.angle : 0;
    angle = smoothCurve(motion.map((_, i) => level - (good(i).angle - ref)), motion.map((m) => (m.lost ? 0.05 : 1)), pins((b) => b.angle), lambda);
  } else {
    const held = first ? times.map((t) => knots.reduce((best, k) => (Math.abs(k.at - t) < Math.abs(best.at - t) ? k : best)).angle) : times.map(() => 0);
    angle = smoothCurve(held, times.map(() => 0.05), pins((b) => b.angle), lambda);
  }
  return times.map((t, i) => ({ t, ...fitOnPicture({ x: cx[i] - size[i] / 2, y: cy[i] - size[i] / 2, size: Math.min(size[i], 1), angle: angle[i] }, width, height) }));
}
