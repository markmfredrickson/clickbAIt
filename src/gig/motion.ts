/**
 * How the phone moved during a song, measured against the frame at the cut's
 * start: for each sample, the similarity (turn, zoom, shift) that carries a
 * point of that first frame to where it shows up later. A reference point z,
 * measured from the frame's centre, shows up at scale · R(angle) · z + shift,
 * with the angle in degrees, clockwise when positive (y points down), and the
 * shift as fractions of the frame's width and height.
 *
 * Every sample is aligned to the same first frame, so errors don't build up
 * from one sample to the next; each starts from the previous sample's answer.
 * A match that jumps further than a camera plausibly moves, or that leaves the
 * pictures disagreeing, is not trusted: the sample is matched against the last
 * good frame instead, which becomes the new reference if that works, and is
 * marked lost if it doesn't (see `track`).
 * The alignment works on gray frames, coarse to fine, and down-weights pixels that don't fit, such
 * as the band moving.
 */

import { spawn } from "node:child_process";

export interface Similarity {
  angle: number;
  scale: number;
  dx: number;
  dy: number;
}

export interface MotionSample extends Similarity {
  /** Seconds into the phone video. */
  t: number;
  /** No match could be trusted here; the values are the last good sample's. */
  lost?: boolean;
}

/** The size frames are measured at. */
export const MOTION_W = 384;
export const MOTION_H = 216;

interface Level {
  img: Float32Array;
  w: number;
  h: number;
}

function boxBlur(img: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0, n = 0;
    for (let x = -r; x < w + r; x++) {
      if (x + r < w) { s += img[y * w + x + r]; n++; }
      if (x - r - 1 >= 0) { s -= img[y * w + x - r - 1]; n--; }
      if (x >= 0 && x < w) tmp[y * w + x] = s / n;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let y = -r; y < h + r; y++) {
      if (y + r < h) { s += tmp[(y + r) * w + x]; n++; }
      if (y - r - 1 >= 0) { s -= tmp[(y - r - 1) * w + x]; n--; }
      if (y >= 0 && y < h) out[y * w + x] = s / n;
    }
  }
  return out;
}

/** Four levels, coarsest first, of the frame lightly blurred. */
export function pyramid(img: Float32Array, w: number, h: number): Level[] {
  const top = boxBlur(img, w, h, 1);
  const levels: Level[] = [{ img: top, w, h }];
  while (levels.length < 4) {
    const { img: a, w: aw, h: ah } = levels[levels.length - 1];
    const bw = aw >> 1, bh = ah >> 1, b = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = 2 * y * aw + 2 * x;
      b[y * bw + x] = (a[i] + a[i + 1] + a[i + aw] + a[i + aw + 1]) / 4;
    }
    levels.push({ img: b, w: bw, h: bh });
  }
  return levels.reverse();
}

function sample(l: Level, x: number, y: number): number {
  if (x < 0 || y < 0 || x > l.w - 2 || y > l.h - 2) return NaN;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * l.w + x0;
  return l.img[i] * (1 - fx) * (1 - fy) + l.img[i + 1] * fx * (1 - fy) + l.img[i + l.w] * (1 - fx) * fy + l.img[i + l.w + 1] * fx * fy;
}

/** Solve the n×n system A x = b (A row-major) by Gauss-Jordan with pivoting. */
function solve(A: Float64Array, b: Float64Array, n: number): number[] | null {
  const M = Array.from({ length: n }, (_, i) => [...A.subarray(i * n, i * n + n), b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * The similarity that carries `ref` onto `cur` (both from `pyramid`), refined
 * from `guess` by Gauss-Newton at each level, with Tukey weights so pixels
 * that disagree with the rest drop out. A gain and an offset on the brightness
 * are fitted alongside, so the phone changing its exposure isn't taken for
 * motion.
 */
export function alignTo(ref: Level[], cur: Level[], guess: Similarity): Similarity & { misfit: number } {
  const W = ref[ref.length - 1].w, H = ref[ref.length - 1].h;
  const g0 = (guess.angle * Math.PI) / 180;
  // p = [a, b, tx, ty]: x' = (1+a)u - b v + tx, y' = b u + (1+a) v + ty, in full-size pixels about the centre.
  let p = [guess.scale * Math.cos(g0) - 1, guess.scale * Math.sin(g0), guess.dx * W, guess.dy * H];
  let misfit = Infinity;
  for (let li = 0; li < ref.length; li++) {
    const R = ref[li], C = cur[li], k = R.w / W, cx = R.w / 2, cy = R.h / 2;
    const t = [p[0], p[1], p[2] * k, p[3] * k];
    // The brightness change: ref ≈ (1 + gain) · cur + offset.
    let gain = 0, offset = 0;
    const step = li === ref.length - 1 ? 2 : 1;
    for (let it = 0; it < 25; it++) {
      const res: number[] = [];
      const rows: number[][] = [];
      for (let y = 3; y < R.h - 3; y += step) for (let x = 3; x < R.w - 3; x += step) {
        const u = x - cx, v = y - cy;
        const X = (1 + t[0]) * u - t[1] * v + t[2] + cx, Y = t[1] * u + (1 + t[0]) * v + t[3] + cy;
        const I = sample(C, X, Y);
        const Ix = (sample(C, X + 1, Y) - sample(C, X - 1, Y)) / 2, Iy = (sample(C, X, Y + 1) - sample(C, X, Y - 1)) / 2;
        if (Number.isNaN(I) || Number.isNaN(Ix) || Number.isNaN(Iy)) continue;
        const e = (1 + gain) * I + offset - R.img[y * R.w + x];
        res.push(Math.abs(e));
        const gx = (1 + gain) * Ix, gy = (1 + gain) * Iy;
        rows.push([gx * u + gy * v, -gx * v + gy * u, gx, gy, I, 1, e]);
      }
      if (rows.length < 50) break;
      const sigma = 1.4826 * res.sort((a, b) => a - b)[res.length >> 1] + 1e-6;
      if (li === ref.length - 1) misfit = sigma / spread(R);
      const A = new Float64Array(36), g = new Float64Array(6);
      for (const row of rows) {
        const e = row[6], r = e / (4.685 * sigma);
        if (Math.abs(r) >= 1) continue;
        const w = (1 - r * r) ** 2;
        for (let i = 0; i < 6; i++) {
          g[i] += w * row[i] * e;
          for (let j = 0; j < 6; j++) A[i * 6 + j] += w * row[i] * row[j];
        }
      }
      const d = solve(A, g, 6);
      if (!d) break;
      for (let i = 0; i < 4; i++) t[i] -= d[i];
      gain -= d[4];
      offset -= d[5];
      if (Math.abs(d[2]) + Math.abs(d[3]) < 0.002 && Math.abs(d[0]) + Math.abs(d[1]) < 1e-5) break;
    }
    p = [t[0], t[1], t[2] / k, t[3] / k];
  }
  return { angle: (Math.atan2(p[1], 1 + p[0]) * 180) / Math.PI, scale: Math.hypot(1 + p[0], p[1]), dx: p[2] / W, dy: p[3] / H, misfit };
}

/** How much a level's brightness varies about its middle, so a misfit can be judged against the picture's own contrast. */
function spread(l: Level): number {
  const v = Array.from(l.img).sort((a, b) => a - b), mid = v[v.length >> 1];
  return 1.4826 * v.map((x) => Math.abs(x - mid)).sort((a, b) => a - b)[v.length >> 1] + 1e-6;
}

/** First `a` (the first frame to some frame), then `b` (that frame to a later one). */
export function compose(a: Similarity, b: Similarity, width: number, height: number): Similarity {
  const ra = (a.angle * Math.PI) / 180, rb = (b.angle * Math.PI) / 180;
  const cb = { re: b.scale * Math.cos(rb), im: b.scale * Math.sin(rb) };
  const da = { re: a.dx * width, im: a.dy * height };
  return {
    angle: ((ra + rb) * 180) / Math.PI,
    scale: a.scale * b.scale,
    dx: (cb.re * da.re - cb.im * da.im) / width + b.dx,
    dy: (cb.im * da.re + cb.re * da.im) / height + b.dy,
  };
}

/** The most a camera plausibly moves per second, and the worst misfit trusted. */
export const LIMITS = { degreesPerSecond: 8, zoomPerSecond: 0.3, shiftPerSecond: 0.3, misfit: 0.8 };

function plausible(from: Similarity, to: Similarity & { misfit: number }, seconds: number): boolean {
  const s = Math.max(seconds, 0.5);
  return (
    to.misfit <= LIMITS.misfit &&
    Math.abs(to.angle - from.angle) <= LIMITS.degreesPerSecond * s &&
    Math.abs(Math.log(to.scale / from.scale)) <= LIMITS.zoomPerSecond * s &&
    Math.abs(to.dx - from.dx) <= LIMITS.shiftPerSecond * s &&
    Math.abs(to.dy - from.dy) <= LIMITS.shiftPerSecond * s
  );
}

/** Track gray frames (`rate` a second from `start`) against the first; see the top of this file. */
export function track(frames: Float32Array[], width: number, height: number, start: number, rate: number): MotionSample[] {
  const identity: Similarity = { angle: 0, scale: 1, dx: 0, dy: 0 };
  const samples: MotionSample[] = [];
  let ref: Level[] | null = null, refM = identity, rel = identity;
  let good: { levels: Level[]; m: Similarity; t: number } | null = null;
  frames.forEach((frame, i) => {
    const t = Number((start + i / rate).toFixed(3));
    const levels = pyramid(frame, width, height);
    if (!ref || !good) {
      ref = levels;
      good = { levels, m: identity, t };
      samples.push({ t, ...identity });
      return;
    }
    const direct = alignTo(ref, levels, rel);
    const viaRef = { ...compose(refM, direct, width, height), misfit: direct.misfit };
    if (plausible(good.m, viaRef, t - good.t)) {
      rel = direct;
      good = { levels, m: viaRef, t };
      samples.push({ t, angle: viaRef.angle, scale: viaRef.scale, dx: viaRef.dx, dy: viaRef.dy });
      return;
    }
    // Try the last good frame as the reference instead.
    const near = alignTo(good.levels, levels, identity);
    const viaGood = { ...compose(good.m, near, width, height), misfit: near.misfit };
    if (plausible(good.m, viaGood, t - good.t)) {
      ref = good.levels;
      refM = good.m;
      rel = near;
      good = { levels, m: viaGood, t };
      samples.push({ t, angle: viaGood.angle, scale: viaGood.scale, dx: viaGood.dx, dy: viaGood.dy });
      return;
    }
    samples.push({ t, ...good.m, lost: true });
  });
  return samples;
}

/** Measure a stretch of a video, `rate` samples a second, against its first sample. */
export async function measureMotion(video: string, start: number, end: number, rate: number): Promise<MotionSample[]> {
  const W = MOTION_W, H = MOTION_H;
  const ff = spawn("ffmpeg", ["-v", "error", "-ss", String(start), "-to", String(end), "-i", video, "-vf", `fps=${rate},scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"]);
  const frames: Float32Array[] = [];
  let buf = Buffer.alloc(0);
  for await (const chunk of ff.stdout) {
    buf = Buffer.concat([buf, chunk as Buffer]);
    while (buf.length >= W * H) {
      frames.push(Float32Array.from(buf.subarray(0, W * H)));
      buf = buf.subarray(W * H);
    }
  }
  return track(frames, W, H, start, rate);
}
