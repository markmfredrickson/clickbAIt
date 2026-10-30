import { describe, it, expect } from "vitest";
import { alignTo, pyramid, track, type Similarity } from "../src/gig/motion.js";

const W = 384;
const H = 216;

/** A textured test picture: smooth blobs of different sizes, like a scene with edges at many scales. */
function scene(): Float32Array {
  const img = new Float32Array(W * H);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blobs = Array.from({ length: 140 }, () => ({ x: rand() * W * 1.4 - W * 0.2, y: rand() * H * 1.4 - H * 0.2, r: 3 + rand() * 18, v: rand() * 200 - 100 }));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 128;
    for (const b of blobs) v += b.v * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.r * b.r));
    img[y * W + x] = v;
  }
  return img;
}

/** The scene as the camera sees it after a move: a reference point z (from the centre) shows up at s R(angle) z + shift. */
function moved(img: Float32Array, m: Similarity): Float32Array {
  const out = new Float32Array(W * H);
  const a = (m.angle * Math.PI) / 180, c = Math.cos(a) * m.scale, s = Math.sin(a) * m.scale, det = c * c + s * s;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // Invert: z = R(-angle)/scale (p - shift).
    const px = x - W / 2 - m.dx * W, py = y - H / 2 - m.dy * H;
    const zx = (c * px + s * py) / det + W / 2, zy = (-s * px + c * py) / det + H / 2;
    const x0 = Math.floor(zx), y0 = Math.floor(zy), fx = zx - x0, fy = zy - y0;
    const at = (xx: number, yy: number) => img[Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))];
    out[y * W + x] = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
  }
  return out;
}

describe("alignTo", () => {
  const ref = scene();
  const identity: Similarity = { angle: 0, scale: 1, dx: 0, dy: 0 };

  it("finds a turn, a zoom and a shift together, to a small fraction of a pixel", () => {
    const truth: Similarity = { angle: 2.5, scale: 1.06, dx: 0.021, dy: -0.013 };
    const got = alignTo(pyramid(ref, W, H), pyramid(moved(ref, truth), W, H), identity);
    expect(got.angle).toBeCloseTo(truth.angle, 1);
    expect(got.scale).toBeCloseTo(truth.scale, 3);
    expect(got.dx * W).toBeCloseTo(truth.dx * W, 0);
    expect(got.dy * H).toBeCloseTo(truth.dy * H, 0);
  });

  it("is not thrown off by something moving across part of the picture", () => {
    const truth: Similarity = { angle: -1.5, scale: 0.97, dx: -0.015, dy: 0.01 };
    const cur = moved(ref, truth);
    // A bright figure that moved on its own, over a fifth of the frame.
    for (let y = 60; y < 180; y++) for (let x = 150; x < 230; x++) cur[y * W + x] = 255 - cur[y * W + x];
    const got = alignTo(pyramid(ref, W, H), pyramid(cur, W, H), identity);
    expect(got.angle).toBeCloseTo(truth.angle, 1);
    expect(got.scale).toBeCloseTo(truth.scale, 2);
    expect(Math.abs(got.dx - truth.dx) * W).toBeLessThan(1);
  });

  it("starts from a guess, so a big move tracked over time still lands", () => {
    const truth: Similarity = { angle: 4, scale: 1.2, dx: 0.06, dy: 0.04 };
    const near: Similarity = { angle: 3.5, scale: 1.17, dx: 0.05, dy: 0.035 };
    const got = alignTo(pyramid(ref, W, H), pyramid(moved(ref, truth), W, H), near);
    expect(got.scale).toBeCloseTo(truth.scale, 2);
    expect(got.angle).toBeCloseTo(truth.angle, 1);
  });
});

describe("track", () => {
  const ref = scene();
  const steps: Similarity[] = Array.from({ length: 8 }, (_, i) => ({ angle: 0.4 * i, scale: 1 + 0.01 * i, dx: 0.004 * i, dy: -0.003 * i }));

  it("follows a camera that moves a little at a time", () => {
    const samples = track(steps.map((m) => moved(ref, m)), W, H, 0, 2);
    samples.forEach((s, i) => {
      expect(s.lost).toBeFalsy();
      expect(s.angle).toBeCloseTo(steps[i].angle, 1);
      expect(s.scale).toBeCloseTo(steps[i].scale, 2);
    });
  });

  it("marks a frame it can't match as lost, and picks up again after it", () => {
    let seed = 11;
    const noise = Float32Array.from({ length: W * H }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 255);
    const frames = steps.map((m) => moved(ref, m));
    frames[4] = noise;
    const samples = track(frames, W, H, 0, 2);
    expect(samples[4].lost).toBe(true);
    for (const i of [5, 6, 7]) {
      expect(samples[i].lost).toBeFalsy();
      expect(samples[i].angle).toBeCloseTo(steps[i].angle, 1);
    }
  }, 30000); // aligns several full frames; slow when the whole suite runs at once

  it("gives each sample its time", () => {
    expect(track(steps.slice(0, 3).map((m) => moved(ref, m)), W, H, 10, 2).map((s) => s.t)).toEqual([10, 10.5, 11]);
  });
});
