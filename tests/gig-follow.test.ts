import { describe, it, expect } from "vitest";
import { corners } from "../src/gig/crop.js";
import { cropPath, frameToScene, lambdaFor, sceneToFrame, smoothCurve, type CurveCrop } from "../src/gig/follow.js";
import type { Similarity } from "../src/gig/motion.js";

const W = 1920;
const H = 1080;
const still: Similarity = { angle: 0, scale: 1, dx: 0, dy: 0 };
const times = (n: number) => Array.from({ length: n }, (_, i) => i / 2);

describe("smoothCurve", () => {
  it("passes through its pins and stays smooth between them", () => {
    let seed = 3;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
    const y = Array.from({ length: 200 }, () => 0.5 + noise());
    const z = smoothCurve(y, y.map(() => 1), [{ i: 100, v: 0.6 }], lambdaFor(8, 2));
    expect(z[100]).toBeCloseTo(0.6, 3);
    expect(Math.abs(z[0] - 0.5)).toBeLessThan(0.01);
    // The 0.1 rise to the pin is spread over many samples, not taken in a jump.
    const steps = z.slice(1).map((v, i) => Math.abs(v - z[i]));
    expect(Math.max(...steps)).toBeLessThan(0.02);
  });

  it("isn't pulled by a few samples far from the rest", () => {
    const y = Array.from({ length: 200 }, (_, i) => (i >= 90 && i < 94 ? 3 : 1));
    const z = smoothCurve(y, y.map(() => 1), [], lambdaFor(8, 2));
    expect(z[92]).toBeCloseTo(1, 2);
  });

  it("joins its pins smoothly when there is nothing else to follow", () => {
    const y = new Array(100).fill(0);
    const z = smoothCurve(y, y.map(() => 0), [{ i: 20, v: 0 }, { i: 80, v: 1 }], lambdaFor(8, 2));
    expect(z[20]).toBeCloseTo(0, 3);
    expect(z[80]).toBeCloseTo(1, 3);
    for (let i = 21; i <= 80; i++) expect(z[i]).toBeGreaterThanOrEqual(z[i - 1] - 1e-9);
  });
});

describe("sceneToFrame and frameToScene", () => {
  const m: Similarity = { angle: 2, scale: 1.1, dx: 0.02, dy: -0.01 };
  const box = { x: 0.1, y: 0.12, size: 0.75, angle: 1 };

  it("undo each other", () => {
    const back = frameToScene(sceneToFrame(box, m, W, H), m, W, H);
    for (const k of ["x", "y", "size", "angle"] as const) expect(back[k]).toBeCloseTo(box[k], 9);
  });

  it("put the box over the same part of the scene once the camera has moved", () => {
    // A point of the scene: the box's top-left corner, where the first frame shows it.
    const [sx, sy] = corners(box, W, H)[0];
    const moved = corners(sceneToFrame(box, m, W, H), W, H)[0];
    const a = (m.angle * Math.PI) / 180, zx = sx - W / 2, zy = sy - H / 2;
    expect(moved[0]).toBeCloseTo(m.scale * (Math.cos(a) * zx - Math.sin(a) * zy) + m.dx * W + W / 2, 6);
    expect(moved[1]).toBeCloseTo(m.scale * (Math.sin(a) * zx + Math.cos(a) * zy) + m.dy * H + H / 2, 6);
  });
});

describe("cropPath", () => {
  const knot = { at: 0, x: 0.05, y: 0.05, size: 0.9, angle: 0 };

  it("holds a single knot when the camera doesn't move", () => {
    const crop: CurveCrop = { follow: true, smooth: 8, knots: [knot] };
    const path = cropPath(times(60), times(60).map(() => still), crop, W, H);
    for (const p of path) {
      expect(p.size).toBeCloseTo(0.9, 6);
      expect(p.x).toBeCloseTo(0.05, 6);
    }
  });

  it("follows the scene when the camera pans", () => {
    const crop: CurveCrop = { follow: true, smooth: 2, knots: [knot] };
    const motion = times(80).map((t) => ({ ...still, dx: -0.0005 * t * 2 }));
    const path = cropPath(times(80), motion, crop, W, H);
    // Panning right moves the scene left in the frame; the box goes with it.
    expect(path[60].x).toBeCloseTo(0.05 - 0.0005 * 60, 2);
  });

  it("keeps the box on the picture when following would run it off", () => {
    const crop: CurveCrop = { follow: true, smooth: 4, knots: [knot] };
    const motion = times(80).map((t) => ({ ...still, scale: 1 + 0.004 * t * 2, angle: 0.03 * t * 2 }));
    for (const p of cropPath(times(80), motion, crop, W, H)) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x + p.size).toBeLessThanOrEqual(1 + 1e-9);
      expect(p.y + p.size).toBeLessThanOrEqual(1 + 1e-9);
      for (const [cx, cy] of corners(p, W, H)) {
        expect(cx).toBeGreaterThanOrEqual(-0.5);
        expect(cy).toBeGreaterThanOrEqual(-0.5);
        expect(cx).toBeLessThanOrEqual(W + 0.5);
        expect(cy).toBeLessThanOrEqual(H + 0.5);
      }
    }
  });

  it("passes through a later knot, which bends the followed curve to it", () => {
    const crop: CurveCrop = { follow: true, smooth: 4, knots: [knot, { at: 20, x: 0.1, y: 0.08, size: 0.8, angle: 1 }] };
    const path = cropPath(times(80), times(80).map(() => still), crop, W, H);
    expect(path[40].size).toBeCloseTo(0.8, 2);
    expect(path[40].angle).toBeCloseTo(1, 2);
    expect(path[0].size).toBeCloseTo(0.9, 2);
  });

  it("without following, runs a smooth curve through the knots", () => {
    const crop: CurveCrop = { follow: false, smooth: 4, knots: [knot, { at: 30, x: 0.1, y: 0.1, size: 0.8, angle: 0 }] };
    const path = cropPath(times(80), null, crop, W, H);
    expect(path[0].size).toBeCloseTo(0.9, 3);
    expect(path[60].size).toBeCloseTo(0.8, 3);
    expect(path[30].size).toBeLessThan(0.9);
    expect(path[30].size).toBeGreaterThan(0.8);
  });
});
