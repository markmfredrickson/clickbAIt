import { describe, it, expect } from "vitest";
import { followBundle } from "../src/gig/crop-page.js";
import { cropPath, type CurveCrop } from "../src/gig/follow.js";

describe("followBundle", () => {
  it("runs on its own, as the picker page runs it, and draws the render's curve", () => {
    const pageCropPath = new Function(`${followBundle()}\nreturn cropPath;`)() as typeof cropPath;
    const times = Array.from({ length: 80 }, (_, i) => i / 2);
    const motion = times.map((t) => ({ angle: 0.01 * t, scale: 1 + 0.001 * t, dx: -0.0005 * t, dy: 0 }));
    const crop: CurveCrop = { follow: true, smooth: 4, knots: [{ at: 0, x: 0.05, y: 0.05, size: 0.9, angle: 0 }, { at: 20, x: 0.1, y: 0.08, size: 0.8, angle: 1 }] };
    expect(pageCropPath(times, motion, crop, 1920, 1080)).toEqual(cropPath(times, motion, crop, 1920, 1080));
  });
});
