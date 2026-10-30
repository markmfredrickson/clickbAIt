import { describe, it, expect } from "vitest";
import { boxAt, corners, perspectiveFilter, type CropKey } from "../src/gig/crop.js";

const W = 1920;
const H = 1080;
const A: CropKey = { at: 0, x: 0.1, y: 0.1, size: 0.8 };
const B: CropKey = { at: 20, x: 0.05, y: 0.15, size: 0.7, angle: 3, glide: 4 };

describe("boxAt", () => {
  it("keeps a single box for the whole song", () => {
    expect(boxAt([A], 0)).toEqual({ x: 0.1, y: 0.1, size: 0.8, angle: 0 });
    expect(boxAt([A], 300)).toEqual({ x: 0.1, y: 0.1, size: 0.8, angle: 0 });
  });

  it("holds a box until the next one's glide starts, and reaches the next box at its time", () => {
    expect(boxAt([A, B], 15.9)).toEqual({ x: 0.1, y: 0.1, size: 0.8, angle: 0 });
    expect(boxAt([A, B], 20)).toEqual({ x: 0.05, y: 0.15, size: 0.7, angle: 3 });
    expect(boxAt([A, B], 60)).toEqual({ x: 0.05, y: 0.15, size: 0.7, angle: 3 });
  });

  it("is halfway at the middle of a glide, and eases in and out of it", () => {
    expect(boxAt([A, B], 18).size).toBeCloseTo(0.75, 9);
    expect(boxAt([A, B], 17).size).toBeGreaterThan(0.8 - 0.25 * 0.1);
  });

  it("glides for 2 seconds unless told otherwise", () => {
    const C: CropKey = { at: 20, x: 0, y: 0, size: 1 };
    expect(boxAt([A, C], 17.99).size).toBe(0.8);
    expect(boxAt([A, C], 19).size).toBeCloseTo(0.9, 9);
  });
});

describe("corners", () => {
  it("are the box's corners in pixels when it isn't turned", () => {
    expect(corners({ x: 0.1, y: 0.2, size: 0.5, angle: 0 }, W, H)).toEqual([
      [192, 216], [192 + 960, 216], [192, 216 + 540], [192 + 960, 216 + 540],
    ]);
  });

  it("turn about the frame's centre and keep the box's shape", () => {
    const [tl, tr, bl] = corners({ x: 0.25, y: 0.25, size: 0.5, angle: 7 }, W, H);
    expect(Math.hypot(tr[0] - tl[0], tr[1] - tl[1])).toBeCloseTo(960, 6);
    expect(Math.hypot(bl[0] - tl[0], bl[1] - tl[1])).toBeCloseTo(540, 6);
    const [, , , br] = corners({ x: 0.25, y: 0.25, size: 0.5, angle: 7 }, W, H);
    expect((tl[0] + br[0]) / 2).toBeCloseTo(W / 2, 6);
    expect((tl[1] + br[1]) / 2).toBeCloseTo(H / 2, 6);
  });

  it("take the top-left corner from lower down when the picture is turned clockwise", () => {
    const level = corners({ x: 0.1, y: 0.1, size: 0.8, angle: 0 }, W, H)[0];
    const turned = corners({ x: 0.1, y: 0.1, size: 0.8, angle: 3 }, W, H)[0];
    expect(turned[1]).toBeGreaterThan(level[1]);
  });
});

/** Evaluate one of the filter's corner expressions the way ffmpeg would, at frame `n`. */
function evaluate(expr: string, n: number): number {
  const clip = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return new Function("W", "H", "n", "clip", "sin", "cos", "PI", `return ${expr.replace(/\bin\b/g, "n")};`)(W, H, n, clip, Math.sin, Math.cos, Math.PI);
}

/** The filter's eight corner expressions, x0 to y3. */
function expressions(filter: string): string[] {
  return ["x0", "y0", "x1", "y1", "x2", "y2", "x3", "y3"].map((k) => filter.match(new RegExp(`${k}='([^']*)'`))![1]);
}

describe("perspectiveFilter", () => {
  it("sends the box's corners to the frame's, with cubic interpolation", () => {
    const f = perspectiveFilter([A], { start: 0, fps: 30 });
    expect(f).toMatch(/^perspective=/);
    expect(f).toContain("sense=source");
    expect(f).toContain("interpolation=cubic");
    expect(expressions(f).map((e) => evaluate(e, 0))).toEqual(corners(boxAt([A], 0), W, H).flat().map((v) => expect.closeTo(v, 6)));
  });

  it("works out every frame's corners during a glide, counting frames from the cut", () => {
    const start = 5;
    const f = perspectiveFilter([A, B], { start, fps: 30 });
    expect(f).toContain("eval=frame");
    for (const t of [5, 15, 16, 17.5, 18, 19.9, 20, 40]) {
      const n = Math.round((t - start) * 30);
      expect(expressions(f).map((e) => evaluate(e, n))).toEqual(corners(boxAt([A, B], start + n / 30), W, H).flat().map((v) => expect.closeTo(v, 4)));
    }
  });
});
