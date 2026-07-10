import { describe, it, expect } from "vitest";
import { pCenterSeconds, type AlignChar } from "../src/build/pcenter.js";

/** Build a char list from [letter, startMs] pairs. */
const chars = (pairs: [string, number][]): AlignChar[] =>
  pairs.map(([text, startMs]) => ({ text, startMs }));

describe("pCenterSeconds", () => {
  it("puts a stop-onset cluster's attack on the beat (two → T)", () => {
    // T@0 W@40 O@80 — the whole onset attacks on the beat.
    const p = pCenterSeconds(chars([["t", 0], ["w", 40], ["o", 80]]), "first");
    expect(p).toBeCloseTo(0, 6);
  });

  it("resolves onto the consonant after a fricative digraph (three → R)", () => {
    // T@0 H@30 R@60 E@90 E@120 — 'th' leads in, the R onset is on the beat and is
    // NOT pulled back into the fricative (R is a real onset between th and the vowel).
    const p = pCenterSeconds(chars([["t", 0], ["h", 30], ["r", 60], ["e", 90], ["e", 120]]), "first");
    expect(p).toBeCloseTo(0.06, 6);
  });

  it("pulls a fricative-onset syllable partway into the fricative (four)", () => {
    // F@0 O@60 U@120 R@180 — vowel onset is 60ms. Old rule landed the vowel on the
    // beat (0.060). New rule lands a point inside the 'f' (earlier than the vowel,
    // later than the fricative's start).
    const p = pCenterSeconds(chars([["f", 0], ["o", 60], ["u", 120], ["r", 180]]), "first");
    expect(p).toBeLessThan(0.06); // earlier than the pure vowel onset
    expect(p).toBeGreaterThan(0); // later than the fricative's start
    expect(p).toBeCloseTo(0.03, 6); // fricative midpoint at the default lead
  });

  it("applies the same pull to other fricative-initial counts (six)", () => {
    // S@0 I@50 X@100
    const p = pCenterSeconds(chars([["s", 0], ["i", 50], ["x", 100]]), "first");
    expect(p).toBeLessThan(0.05);
    expect(p).toBeGreaterThan(0);
  });

  it("ignores a silent trailing e when finding the vowel (five)", () => {
    // F@0 I@50 V@100 E@150 (silent e) — vowel is I; fricative-onset pull applies.
    const p = pCenterSeconds(chars([["f", 0], ["i", 50], ["v", 100], ["e", 150]]), "first");
    expect(p).toBeLessThan(0.05);
    expect(p).toBeGreaterThan(0);
  });
});
