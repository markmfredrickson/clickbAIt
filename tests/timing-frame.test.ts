import { describe, it, expect } from "vitest";
import { downbeatFrame } from "../src/core/timing-frame.js";

// The invariant docs/timing-frames.md pins: the RPP's PROJOFFS measure offset
// and the LyricsDisplay curve's t0 are TWO encodings of the SAME padding, and
// must agree. This is the drift that caused a whole-song constant offset live
// (bug: PROJOFFS used the slug, the curve used the real padding).

describe("downbeatFrame", () => {
  it("encodes whole-bar padding as measure offset and t0 that agree", () => {
    // 8 beats padding, 120 BPM, 4/4 → 2 bars back; 8 beats = 4s.
    const f = downbeatFrame(8, 120, 4);
    expect(f.measureOffset).toBe(-2);
    expect(f.downbeatSeconds).toBeCloseTo(4);
    expect(f.wholeBars).toBe(true);
    // Consistency: measureOffset (in bars) reconstructs the padding beats,
    // and the curve slope maps that back to downbeatSeconds.
    const barsBack = -f.measureOffset;
    expect(barsBack * 4).toBe(8); // bars → beats
    expect((barsBack * 4 * 60) / 120).toBeCloseTo(f.downbeatSeconds);
  });

  it("rounds a longer count-in the same way both sides see it", () => {
    // 16 beats (Lonely Boy's case) → 4 bars, 8s at 120.
    const f = downbeatFrame(16, 120, 4);
    expect(f.measureOffset).toBe(-4);
    expect(f.downbeatSeconds).toBeCloseTo(8);
    expect(f.wholeBars).toBe(true);
  });

  it("flags a fractional-bar pickup (downbeat off the bar line)", () => {
    // 10 beats in 4/4 = 2.5 bars — not a whole number of bars.
    const f = downbeatFrame(10, 120, 4);
    expect(f.wholeBars).toBe(false);
    expect(f.measureOffset).toBe(-3); // rounds to nearest bar for the grid
    expect(f.downbeatSeconds).toBeCloseTo(5); // t0 stays exact regardless
  });

  it("uses the meter, not a hardcoded 4", () => {
    // 3/4: 9 beats = 3 bars.
    const f = downbeatFrame(9, 90, 3);
    expect(f.measureOffset).toBe(-3);
    expect(f.wholeBars).toBe(true);
    expect(f.downbeatSeconds).toBeCloseTo((9 * 60) / 90); // 6s
  });
});
