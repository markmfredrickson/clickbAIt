import { describe, it, expect } from "vitest";
import { corners } from "../src/gig/crop.js";
import { bandNeed, cropPath, fitOnPicture, lambdaFor, smoothCurve, type CurveCrop, type PeopleSample } from "../src/gig/follow.js";
import type { Similarity } from "../src/gig/motion.js";

const W = 1920;
const H = 1080;
const still: Similarity = { angle: 0, scale: 1, dx: 0, dy: 0 };
const times = (n: number) => Array.from({ length: n }, (_, i) => i / 2);
/** The same people in every sample: [x, y, w, h, confidence], fractions of the frame. */
const band = (n: number, boxes: number[][]): PeopleSample[] => times(n).map((t) => ({ t, boxes }));
const onPicture = (p: { x: number; y: number; size: number; angle: number }) => {
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
};

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

  it("with a floor, stays at or above every sample and still runs smoothly", () => {
    const y = Array.from({ length: 200 }, (_, i) => (i >= 90 && i < 110 ? 0.9 : 0.7));
    const z = smoothCurve(y, y.map(() => 1), [], lambdaFor(6, 2), { floor: true });
    z.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(y[i] - 0.002));
    expect(z[60]).toBeLessThan(0.75);
    // The 0.2 rise is spread over several samples rather than taken in one jump.
    const steps = z.slice(1).map((v, i) => Math.abs(v - z[i]));
    expect(Math.max(...steps)).toBeLessThan(0.1);
  });

  it("joins its pins smoothly when there is nothing else to follow", () => {
    const y = new Array(100).fill(0);
    const z = smoothCurve(y, y.map(() => 0), [{ i: 20, v: 0 }, { i: 80, v: 1 }], lambdaFor(8, 2));
    expect(z[20]).toBeCloseTo(0, 3);
    expect(z[80]).toBeCloseTo(1, 3);
    for (let i = 21; i <= 80; i++) expect(z[i]).toBeGreaterThanOrEqual(z[i - 1] - 1e-9);
  });
});

describe("bandNeed", () => {
  it("is the 16:9 box around everyone found, with a margin", () => {
    const need = bandNeed(band(10, [[0.2, 0.3, 0.1, 0.4, 0.9], [0.6, 0.35, 0.1, 0.4, 0.9]]))[5];
    // Everyone spans 0.2 to 0.7 across and 0.3 to 0.75 down; the box is set by the wider, with margins.
    expect(need.size).toBeGreaterThan(0.5);
    expect(need.cx).toBeCloseTo(0.45, 2);
    expect(need.cy - need.size / 2).toBeLessThan(0.3);
    expect(need.cy + need.size / 2).toBeGreaterThan(0.75);
  });

  it("keeps someone missed for a moment, from the samples either side", () => {
    const people = band(20, [[0.2, 0.3, 0.1, 0.4, 0.9], [0.6, 0.3, 0.1, 0.4, 0.9]]);
    people[10] = { t: people[10].t, boxes: [[0.6, 0.3, 0.1, 0.4, 0.9]] };
    expect(bandNeed(people)[10].size).toBeCloseTo(bandNeed(people)[5].size, 6);
  });

  it("ignores finds it isn't sure of", () => {
    const sure = bandNeed(band(10, [[0.4, 0.3, 0.1, 0.4, 0.9]]))[5];
    const withDoubt = bandNeed(band(10, [[0.4, 0.3, 0.1, 0.4, 0.9], [0.0, 0.8, 0.1, 0.2, 0.1]]))[5];
    expect(withDoubt).toEqual(sure);
  });
});

describe("fitOnPicture", () => {
  it("leaves a box alone that already fits", () => {
    expect(fitOnPicture({ x: 0.1, y: 0.1, size: 0.8, angle: 1 }, W, H)).toEqual({ x: 0.1, y: 0.1, size: 0.8, angle: 1 });
  });

  it("shrinks only as much as the turn needs, sliding toward the middle instead", () => {
    const fit = fitOnPicture({ x: 0, y: 0, size: 0.95, angle: 3 }, W, H);
    const middle = fitOnPicture({ x: 0.025, y: 0.025, size: 0.95, angle: 3 }, W, H);
    expect(fit.size).toBeCloseTo(middle.size, 2);
    expect(fit.size).toBeGreaterThan(0.85);
    onPicture(fit);
  });
});

describe("cropPath", () => {
  const knot = { at: 0, x: 0.05, y: 0.05, size: 0.9, angle: 0 };
  const two = [[0.2, 0.3, 0.1, 0.4, 0.9], [0.6, 0.3, 0.1, 0.4, 0.9]];

  it("frames the band, holding everyone in the shot", () => {
    const crop: CurveCrop = { follow: true, smooth: 4, knots: [] };
    for (const p of cropPath(times(40), times(40).map(() => still), band(40, two), crop, W, H)) {
      expect(p.x).toBeLessThanOrEqual(0.2);
      expect(p.x + p.size).toBeGreaterThanOrEqual(0.7);
      expect(p.y).toBeLessThanOrEqual(0.3);
      expect(p.y + p.size).toBeGreaterThanOrEqual(0.7);
      expect(p.size).toBeLessThan(0.8);
    }
  });

  it("widens when the band spreads out, and never cuts anyone while it does", () => {
    const crop: CurveCrop = { follow: true, smooth: 4, knots: [] };
    const people = times(80).map((t, i) => ({ t, boxes: i < 40 ? two : [[0.05, 0.3, 0.1, 0.4, 0.9], [0.8, 0.3, 0.1, 0.4, 0.9]] }));
    const path = cropPath(times(80), times(80).map(() => still), people, crop, W, H);
    expect(path[70].size).toBeGreaterThan(path[10].size + 0.1);
    for (const i of [40, 45, 50, 60, 79]) {
      expect(path[i].x).toBeLessThanOrEqual(0.05 + 1e-6);
      expect(path[i].x + path[i].size).toBeGreaterThanOrEqual(0.9 - 1e-6);
    }
  });

  it("levels the picture against the camera's turn, from the earliest knot's angle", () => {
    const crop: CurveCrop = { follow: true, smooth: 2, knots: [{ ...knot, angle: 1 }] };
    const motion = times(80).map((t) => ({ ...still, angle: -0.05 * t }));
    const path = cropPath(times(80), motion, band(80, two), crop, W, H);
    expect(path[60].angle).toBeCloseTo(1 + 0.05 * 30, 1);
  });

  it("keeps the box on the picture whatever the turn", () => {
    const crop: CurveCrop = { follow: true, smooth: 4, knots: [] };
    const motion = times(80).map((t) => ({ ...still, angle: 0.08 * t }));
    for (const p of cropPath(times(80), motion, band(80, [[0.0, 0.0, 0.2, 0.9, 0.9], [0.8, 0.1, 0.2, 0.9, 0.9]]), crop, W, H)) onPicture(p);
  });

  it("passes through a knot, which overrides the band framing there", () => {
    const crop: CurveCrop = { follow: true, smooth: 4, knots: [{ at: 20, x: 0.1, y: 0.08, size: 0.85, angle: 1 }] };
    const path = cropPath(times(80), times(80).map(() => still), band(80, two), crop, W, H);
    expect(path[40].size).toBeCloseTo(0.85, 2);
    expect(path[40].angle).toBeCloseTo(1, 2);
  });

  it("without following, runs a smooth curve through the knots", () => {
    const crop: CurveCrop = { follow: false, smooth: 4, knots: [knot, { at: 30, x: 0.1, y: 0.1, size: 0.8, angle: 0 }] };
    const path = cropPath(times(80), null, null, crop, W, H);
    expect(path[0].size).toBeCloseTo(0.9, 3);
    expect(path[60].size).toBeCloseTo(0.8, 3);
    expect(path[30].size).toBeLessThan(0.9);
    expect(path[30].size).toBeGreaterThan(0.8);
  });
});

describe("knot width and strength", () => {
  const two = [[0.2, 0.3, 0.1, 0.4, 0.9], [0.6, 0.3, 0.1, 0.4, 0.9]];

  it("a wide knot holds its box across its width, and lets go outside it", () => {
    const crop: CurveCrop = { follow: true, smooth: 4, knots: [{ at: 20, x: 0.05, y: 0.05, size: 0.9, angle: 0, width: 10 }] };
    const path = cropPath(times(100), times(100).map(() => still), band(100, two), crop, W, H);
    for (const t of [16, 20, 24]) expect(path[t * 2].size).toBeCloseTo(0.9, 2);
    expect(path[45 * 2].size).toBeLessThan(0.7);
  });

  it("a gentle knot nudges the curve toward its box without pinning it", () => {
    const hard: CurveCrop = { follow: true, smooth: 4, knots: [{ at: 20, x: 0.05, y: 0.05, size: 0.9, angle: 0 }] };
    const gentle: CurveCrop = { ...hard, knots: [{ ...hard.knots[0], strength: 0.2 }] };
    const free = cropPath(times(80), times(80).map(() => still), band(80, two), { ...hard, knots: [] }, W, H)[40].size;
    const nudged = cropPath(times(80), times(80).map(() => still), band(80, two), gentle, W, H)[40].size;
    expect(cropPath(times(80), times(80).map(() => still), band(80, two), hard, W, H)[40].size).toBeCloseTo(0.9, 2);
    expect(nudged).toBeGreaterThan(free + 0.01);
    expect(nudged).toBeLessThan(0.88);
  });

  it("a knot may frame tighter than the band needs; that is the user's call", () => {
    const crop: CurveCrop = { follow: true, smooth: 4, knots: [{ at: 20, x: 0.3, y: 0.3, size: 0.4, angle: 0, width: 6 }] };
    expect(cropPath(times(80), times(80).map(() => still), band(80, two), crop, W, H)[40].size).toBeCloseTo(0.4, 2);
  });
});

describe("a knot's pull over time", () => {
  const two = [[0.2, 0.3, 0.1, 0.4, 0.9], [0.6, 0.3, 0.1, 0.4, 0.9]];

  it("falls off like a normal curve: closest to the knot's box at its time, less so further out", () => {
    const crop: CurveCrop = { follow: true, smooth: 2, knots: [{ at: 30, x: 0.05, y: 0.05, size: 0.9, angle: 0, width: 10, strength: 0.4 }] };
    const path = cropPath(times(120), times(120).map(() => still), band(120, two), crop, W, H);
    const off = (t: number) => Math.abs(path[t * 2].size - 0.9);
    expect(off(30)).toBeLessThan(off(34));
    expect(off(34)).toBeLessThan(off(38));
    expect(off(38)).toBeLessThan(off(50));
  });
});

describe("lost camera samples", () => {
  it("hold the turn across them rather than letting it run off", () => {
    const crop: CurveCrop = { follow: true, smooth: 6, knots: [] };
    const motion = times(160).map((t, i) => (i >= 60 && i < 120 ? { angle: -150, scale: 20, dx: 1, dy: 2, lost: true } : { ...still, angle: -1 }));
    const path = cropPath(times(160), motion, band(160, [[0.2, 0.3, 0.1, 0.4, 0.9]]), crop, W, H);
    // The camera holds at -1° from the start, so levelling leaves the turn at 0.
    for (const p of path) expect(Math.abs(p.angle)).toBeLessThan(0.2);
  });
});
