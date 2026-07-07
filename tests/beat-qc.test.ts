import { describe, it, expect } from "vitest";
import { analyzeBeatStretches, type BeatLike } from "../src/authoring/beat-qc.js";

/** Build a beat grid from a list of inter-beat intervals (seconds). */
function gridFromIbis(ibis: number[], start = 0): BeatLike[] {
  const beats: BeatLike[] = [{ time: start }];
  let t = start;
  for (const d of ibis) {
    t += d;
    beats.push({ time: t });
  }
  return beats;
}

/** n even beats at the given ibi. */
function evenGrid(n: number, ibi: number): BeatLike[] {
  return gridFromIbis(Array(n - 1).fill(ibi));
}

describe("analyzeBeatStretches", () => {
  it("perfectly even grid → no flags, relChange ≈ 0", () => {
    const r = analyzeBeatStretches(evenGrid(50, 0.5));
    expect(r.flagCount).toBe(0);
    expect(r.bpm).toBeCloseTo(120);
    for (const iv of r.intervals) expect(Math.abs(iv.relChange)).toBeLessThan(1e-9);
  });

  it("one short (inserted) beat → flags exactly that interval, correct sign", () => {
    // 60 even 0.5s intervals, but make interval 20 short (0.3s) — a beat too early.
    const ibis = Array(60).fill(0.5);
    ibis[20] = 0.3;
    const r = analyzeBeatStretches(gridFromIbis(ibis));
    const flagged = r.flags.map((f) => f.i);
    expect(flagged).toContain(20);
    // 0.3 vs ~0.5 median → about −40%, and it's the only big one.
    expect(r.flagCount).toBe(1);
    expect(r.intervals[20].relChange).toBeLessThan(-0.05);
  });

  it("gradual ritard (~2%/beat) → no flags (real slow drift is not a jump)", () => {
    const ibis: number[] = [];
    let d = 0.5;
    for (let i = 0; i < 40; i++) {
      ibis.push(d);
      d *= 1.02; // each interval 2% longer than the last
    }
    const r = analyzeBeatStretches(ibis.length ? gridFromIbis(ibis) : [], { threshold: 0.05 });
    // Median sits mid-drift; extremes are ±~40% over the whole span, so the ENDS
    // do exceed 5% vs the global constant — that's intended (a constant click
    // would not match a big ritard). But no single-beat spike. Assert the
    // per-interval STEP (change between neighbours) stays small everywhere.
    for (let i = 1; i < r.intervals.length; i++) {
      const step = Math.abs(r.intervals[i].relChange - r.intervals[i - 1].relChange);
      expect(step).toBeLessThan(0.05);
    }
  });

  it("SUSTAINED ~8%-off region flags EVERY interval in it (global ref, not local)", () => {
    // 40 beats at 0.5s, then a 15-beat stretch all at 0.54s (8% long), then back.
    const ibis = [
      ...Array(40).fill(0.5),
      ...Array(15).fill(0.54),
      ...Array(40).fill(0.5),
    ];
    const r = analyzeBeatStretches(gridFromIbis(ibis));
    // median IBI is dominated by the 0.5s majority → ~0.5.
    expect(r.nominalIbi).toBeCloseTo(0.5, 3);
    // every one of the 15 stretched intervals must flag (indices 40..54).
    for (let i = 40; i < 55; i++) {
      expect(r.intervals[i].relChange).toBeCloseTo(0.08, 2);
      expect(r.flags.some((f) => f.i === i)).toBe(true);
    }
    expect(r.flagCount).toBe(15);
  });

  it("one sudden 10% jump → flagged", () => {
    const ibis = Array(30).fill(0.5);
    ibis[15] = 0.55; // 10% long
    const r = analyzeBeatStretches(gridFromIbis(ibis));
    expect(r.flags.map((f) => f.i)).toContain(15);
  });

  it("custom threshold respected", () => {
    const ibis = Array(30).fill(0.5);
    ibis[10] = 0.53; // 6% long
    expect(analyzeBeatStretches(gridFromIbis(ibis), { threshold: 0.05 }).flagCount).toBe(1);
    expect(analyzeBeatStretches(gridFromIbis(ibis), { threshold: 0.1 }).flagCount).toBe(0);
  });

  it("bpm override sets nominal to 60/bpm and drives relChange", () => {
    // even 0.5s grid (120 bpm) but told the song is 125 bpm (nominal 0.48).
    const r = analyzeBeatStretches(evenGrid(20, 0.5), { bpm: 125 });
    expect(r.reference).toBe("bpm");
    expect(r.nominalIbi).toBeCloseTo(0.48);
    // 0.5/0.48 − 1 ≈ +4.17% → under 5%, no flags.
    expect(r.flagCount).toBe(0);
    for (const iv of r.intervals) expect(iv.relChange).toBeCloseTo(0.0417, 3);
  });

  it("anchor produces 1-based bar numbers", () => {
    const r = analyzeBeatStretches(evenGrid(20, 0.5), { anchor: 0, beatsPerBar: 4 });
    expect(r.intervals[0].bar).toBe(1); // beat 0 → bar 1
    expect(r.intervals[4].bar).toBe(2); // beat 4 → bar 2
  });
});
