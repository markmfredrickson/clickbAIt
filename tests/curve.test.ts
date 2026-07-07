import { describe, it, expect } from "vitest";
import { Curve, type Anchor } from "../src/core/curve.js";
import { beatToSeconds, secondsToBeat, type TempoPoint } from "../src/core/tempo.js";

describe("Curve", () => {
  // -- #2 Constant BPM -------------------------------------------------------
  describe("constant BPM", () => {
    it("constantBpm matches analytic b·60/bpm in both directions", () => {
      const c = Curve.constantBpm(120);
      // 120 bpm → 2 beats/sec → beat b at t = b/2 seconds.
      expect(c.toTime(0)).toBeCloseTo(0);
      expect(c.toTime(2)).toBeCloseTo(1);
      expect(c.toTime(8)).toBeCloseTo(4);
      expect(c.toBeat(0)).toBeCloseTo(0);
      expect(c.toBeat(1)).toBeCloseTo(2);
      expect(c.toBeat(4)).toBeCloseTo(8);
    });

    it("constantBpm honors a time offset at beat 0", () => {
      const c = Curve.constantBpm(120, { t0: 10 });
      expect(c.toTime(0)).toBeCloseTo(10);
      expect(c.toTime(2)).toBeCloseTo(11);
      expect(c.toBeat(10)).toBeCloseTo(0);
      expect(c.toBeat(11)).toBeCloseTo(2);
    });
  });

  // -- #1 Legacy equivalence (the regression safety net) ---------------------
  describe("legacy equivalence with tempo.ts", () => {
    const maps: Record<string, TempoPoint[]> = {
      single: [{ beat: 0, bpm: 132 }],
      twoSeg: [
        { beat: 0, bpm: 120 },
        { beat: 8, bpm: 140 },
      ],
      threeSeg: [
        { beat: 0, bpm: 90 },
        { beat: 16, bpm: 120 },
        { beat: 48, bpm: 100 },
      ],
    };

    for (const [name, map] of Object.entries(maps)) {
      it(`fromTempoMap matches beatToSeconds across the song (${name})`, () => {
        const c = Curve.fromTempoMap(map);
        for (let beat = 0; beat <= 64; beat += 0.5) {
          expect(c.toTime(beat)).toBeCloseTo(beatToSeconds(beat, map), 9);
        }
      });

      it(`fromTempoMap matches secondsToBeat across the song (${name})`, () => {
        const c = Curve.fromTempoMap(map);
        for (let sec = 0; sec <= 30; sec += 0.25) {
          expect(c.toBeat(sec)).toBeCloseTo(secondsToBeat(sec, map), 9);
        }
      });
    }
  });

  // -- #3 Tempo change: segment selection & continuity -----------------------
  describe("tempo change", () => {
    const anchors: Anchor[] = [
      { t: 0, b: 0 },
      { t: 4, b: 8 }, // 0–4s: 2 beats/sec (120 bpm)
      { t: 8, b: 20 }, // 4–8s: 3 beats/sec (180 bpm)
    ];

    it("selects the correct segment for interior queries", () => {
      const c = new Curve(anchors);
      expect(c.toBeat(2)).toBeCloseTo(4); // first segment
      expect(c.toBeat(6)).toBeCloseTo(14); // second segment: 8 + 3·2
      expect(c.toTime(4)).toBeCloseTo(2);
      expect(c.toTime(14)).toBeCloseTo(6);
    });

    it("is continuous at the interior anchor (no jump)", () => {
      const c = new Curve(anchors);
      const eps = 1e-6;
      expect(c.toBeat(4 - eps)).toBeCloseTo(8, 4);
      expect(c.toBeat(4 + eps)).toBeCloseTo(8, 4);
    });
  });

  // -- #5 Anchor exactness ---------------------------------------------------
  describe("anchor exactness", () => {
    it("querying exactly at an anchor returns the partner coord exactly", () => {
      const anchors: Anchor[] = [
        { t: 0, b: 0 },
        { t: 4, b: 8 },
        { t: 8, b: 20 },
      ];
      const c = new Curve(anchors);
      for (const a of anchors) {
        expect(c.toTime(a.b)).toBe(a.t);
        expect(c.toBeat(a.t)).toBe(a.b);
      }
    });
  });

  // -- #4 Round-trip fuzz ----------------------------------------------------
  describe("round-trip", () => {
    it("toBeat(toTime(b)) ≈ b for random monotonic curves", () => {
      // Deterministic LCG — no Math.random (and keeps the test reproducible).
      let seed = 0x12345;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let trial = 0; trial < 50; trial++) {
        const anchors: Anchor[] = [{ t: 0, b: 0 }];
        let t = 0;
        let b = 0;
        const nSeg = 3 + Math.floor(rand() * 6);
        for (let i = 0; i < nSeg; i++) {
          t += 0.1 + rand() * 5;
          b += 0.1 + rand() * 10;
          anchors.push({ t, b });
        }
        const c = new Curve(anchors);
        for (let k = 0; k < 20; k++) {
          const bq = rand() * b;
          expect(c.toBeat(c.toTime(bq))).toBeCloseTo(bq, 6);
        }
      }
    });
  });

  // -- #6 Monotonicity rejection ---------------------------------------------
  describe("monotonicity validation", () => {
    it("throws on non-monotonic beats", () => {
      expect(
        () => new Curve([{ t: 0, b: 0 }, { t: 4, b: 8 }, { t: 8, b: 6 }]),
      ).toThrow();
    });
    it("throws on non-monotonic time", () => {
      expect(
        () => new Curve([{ t: 0, b: 0 }, { t: 4, b: 8 }, { t: 3, b: 12 }]),
      ).toThrow();
    });
    it("throws on a repeated coordinate (zero-length segment)", () => {
      expect(
        () => new Curve([{ t: 0, b: 0 }, { t: 4, b: 8 }, { t: 4, b: 12 }]),
      ).toThrow();
    });
    it("throws on fewer than two anchors with no explicit slope", () => {
      expect(() => new Curve([{ t: 0, b: 0 }])).toThrow();
    });
  });

  // -- #7 Extrapolation ------------------------------------------------------
  describe("extrapolation", () => {
    it("extends past the last anchor using the trailing slope", () => {
      // Plain curve: trailing slope defaults to the last interior segment.
      const c = new Curve([{ t: 0, b: 0 }, { t: 4, b: 8 }]); // 2 beats/sec
      expect(c.toBeat(6)).toBeCloseTo(12);
      expect(c.toTime(12)).toBeCloseTo(6);
    });

    it("extends before the first anchor using the leading slope", () => {
      const c = new Curve([{ t: 4, b: 8 }, { t: 8, b: 16 }]); // 2 beats/sec
      expect(c.toBeat(0)).toBeCloseTo(0);
      expect(c.toTime(0)).toBeCloseTo(0);
    });

    it("fromTempoMap extrapolates past the last point with that point's bpm", () => {
      // Trailing segment semantics: last point's bpm applies forward.
      const map: TempoPoint[] = [
        { beat: 0, bpm: 120 },
        { beat: 8, bpm: 240 }, // 4 beats/sec from beat 8 onward
      ];
      const c = Curve.fromTempoMap(map);
      // beat 8 lands at t=4 (8 beats @ 120bpm). beat 16 → +8 beats @ 240bpm = +2s.
      expect(c.toTime(8)).toBeCloseTo(4);
      expect(c.toTime(16)).toBeCloseTo(6);
      expect(c.toTime(16)).toBeCloseTo(beatToSeconds(16, map), 9);
    });
  });
});
