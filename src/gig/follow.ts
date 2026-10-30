/**
 * Crop curves: the box as smooth functions of time (centre, size, turn), which
 * can follow the camera and are pinned by knots the user places.
 *
 * With `follow`, the first knot's box is carried through the measured camera
 * motion (see motion.ts) so it stays over the same part of the scene, kept on
 * the picture where that would run it off; the curves are then smoothed over
 * `smooth` seconds, passing through every knot. Without it, the curves just run
 * smoothly from knot to knot. The picker page runs these same functions, bundled
 * for the browser, so what you see there is what the render cuts.
 */

import { corners } from "./crop.js";
import type { Similarity } from "./motion.js";

export interface Box {
  x: number;
  y: number;
  size: number;
  angle: number;
}

export interface Knot extends Box {
  /** Seconds into the phone video. */
  at: number;
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
 * refitted, so a few bad ones don't pull it.
 */
export function smoothCurve(y: number[], w: number[], pins: { i: number; v: number }[], lambda: number): number[] {
  const n = y.length;
  const PIN = 1e6;
  let weights = w.slice();
  let z = y.slice();
  for (let pass = 0; pass < 4; pass++) {
    // The system is symmetric with two bands either side of the diagonal.
    const d0 = new Float64Array(n), d1 = new Float64Array(n), d2 = new Float64Array(n), b = new Float64Array(n);
    for (let i = 0; i < n; i++) { d0[i] = weights[i]; b[i] = weights[i] * y[i]; }
    for (const p of pins) { d0[p.i] += PIN; b[p.i] += PIN * p.v; }
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
    const used = y.map((v, i) => ({ r: Math.abs(v - z[i]), i })).filter(({ i }) => w[i] > 0);
    if (!used.length) break;
    const sigma = Math.max(1.4826 * used.map((u) => u.r).sort((a, c) => a - c)[used.length >> 1], 1e-6);
    weights = w.map((wi, i) => { const r = Math.abs(y[i] - z[i]) / (4.685 * sigma); return r < 1 ? wi * (1 - r * r) ** 2 : 0; });
  }
  return z;
}

/** A box set against the song's first frame, placed on a frame the camera reached by `m` (see motion.ts). */
export function sceneToFrame(box: Box, m: Similarity, width: number, height: number): Box {
  const angle = box.angle - m.angle;
  const a = (angle * Math.PI) / 180, sx = m.dx * width, sy = m.dy * height;
  const rx = Math.cos(a) * sx - Math.sin(a) * sy, ry = Math.sin(a) * sx + Math.cos(a) * sy;
  return { x: 0.5 + m.scale * (box.x - 0.5) + rx / width, y: 0.5 + m.scale * (box.y - 0.5) + ry / height, size: box.size * m.scale, angle };
}

/** The inverse of `sceneToFrame`: a box on a frame, as set against the song's first frame. */
export function frameToScene(box: Box, m: Similarity, width: number, height: number): Box {
  const a = (box.angle * Math.PI) / 180, sx = m.dx * width, sy = m.dy * height;
  const rx = Math.cos(a) * sx - Math.sin(a) * sy, ry = Math.sin(a) * sx + Math.cos(a) * sy;
  return { x: 0.5 + (box.x - 0.5 - rx / width) / m.scale, y: 0.5 + (box.y - 0.5 - ry / height) / m.scale, size: box.size / m.scale, angle: box.angle + m.angle };
}

/** The box moved inside the frame, and shrunk about its centre if need be, until its corners are all on the picture. */
export function fitOnPicture(box: Box, width: number, height: number): Box {
  const cx = box.x + box.size / 2, cy = box.y + box.size / 2;
  let size = Math.min(box.size, 1);
  for (;;) {
    const x = Math.min(Math.max(cx - size / 2, 0), 1 - size), y = Math.min(Math.max(cy - size / 2, 0), 1 - size);
    const b = { x, y, size, angle: box.angle };
    if (size <= 0.2 || corners(b, width, height).every(([px, py]) => px >= -0.5 && py >= -0.5 && px <= width + 0.5 && py <= height + 0.5)) return b;
    size -= 0.002;
  }
}

/** The crop at each of `times` (evenly spaced), with the camera motion at each if following. */
export function cropPath(times: number[], motion: Similarity[] | null, crop: CurveCrop, width: number, height: number): PathPoint[] {
  const n = times.length, rate = n > 1 ? 1 / (times[1] - times[0]) : 1;
  const index = (t: number) => Math.min(n - 1, Math.max(0, Math.round((t - times[0]) * rate)));
  const knots = [...crop.knots].sort((a, b) => a.at - b.at);
  const follow = crop.follow && motion !== null;
  let raw: Box[], w: number[];
  if (follow) {
    const scene = frameToScene(knots[0], motion![index(knots[0].at)], width, height);
    raw = motion!.map((m) => fitOnPicture(sceneToFrame(scene, m, width, height), width, height));
    w = raw.map(() => 1);
  } else {
    // Hold each knot until halfway to the next; the smoothing rounds the steps off.
    raw = times.map((t) => knots.reduce((best, k) => (Math.abs(k.at - t) < Math.abs(best.at - t) ? k : best)));
    w = raw.map(() => 0.05);
  }
  const lambda = lambdaFor(crop.smooth, rate);
  const curve = (get: (b: Box) => number) => smoothCurve(raw.map(get), w, knots.map((k) => ({ i: index(k.at), v: get(k) })), lambda);
  const cx = curve((b) => b.x + b.size / 2), cy = curve((b) => b.y + b.size / 2), size = curve((b) => b.size), angle = curve((b) => b.angle);
  return times.map((t, i) => ({ t, ...fitOnPicture({ x: cx[i] - size[i] / 2, y: cy[i] - size[i] / 2, size: size[i], angle: angle[i] }, width, height) }));
}
