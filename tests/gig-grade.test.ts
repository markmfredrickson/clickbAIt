import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { eqCurve, fitEq, gradeFilter, levelsFilter, levelsOf, smoothLevels, type LevelsSample } from "../src/gig/grade.js";

const TARGET = { low: 0.2, mid: 0.5, high: 0.82 };

describe("fitEq", () => {
  it("passes through the three measured levels", () => {
    const from: [number, number, number] = [0.25, 0.45, 0.8];
    const eq = fitEq(from, [TARGET.low, TARGET.mid, TARGET.high]);
    expect(eqCurve(eq, 0.25)).toBeCloseTo(TARGET.low, 3);
    expect(eqCurve(eq, 0.45)).toBeCloseTo(TARGET.mid, 3);
    expect(eqCurve(eq, 0.8)).toBeCloseTo(TARGET.high, 3);
  });

  it("never darkens a brighter value below a darker one", () => {
    for (const from of [[0.3, 0.55, 0.8], [0.08, 0.4, 0.78], [0.32, 0.56, 0.83]] as [number, number, number][]) {
      const eq = fitEq(from, [TARGET.low, TARGET.mid, TARGET.high]);
      let last = -1;
      for (let x = 0; x <= 1; x += 0.01) {
        const y = eqCurve(eq, x);
        expect(y).toBeGreaterThanOrEqual(last);
        last = y;
      }
    }
  });

  it("changes nothing when the levels are already on target", () => {
    const eq = fitEq([0.2, 0.5, 0.82], [0.2, 0.5, 0.82]);
    expect(eq.contrast).toBeCloseTo(1, 3);
    expect(eq.brightness).toBeCloseTo(0, 3);
    expect(eq.gamma).toBeCloseTo(1, 3);
  });
});

describe("smoothLevels", () => {
  // The light changes at 60 s, from one level to another.
  const samples: LevelsSample[] = Array.from({ length: 121 }, (_, t) => ({ t, low: 0.25, mid: t < 60 ? 0.4 : 0.5, high: 0.8 }));
  const smooth = smoothLevels(samples, 10);

  it("turns a sudden change of light into a gradual one", () => {
    // No one second carries more than a quarter of the 0.1 change.
    for (let i = 1; i < smooth.length; i++) expect(Math.abs(smooth[i].mid - smooth[i - 1].mid)).toBeLessThan(0.025);
    expect(smooth[60].mid).toBeGreaterThan(0.42);
    expect(smooth[60].mid).toBeLessThan(0.48);
  });

  it("keeps the level well away from the change", () => {
    expect(smooth[5].mid).toBeCloseTo(0.4, 2);
    expect(smooth[115].mid).toBeCloseTo(0.5, 2);
    expect(smooth[30].low).toBeCloseTo(0.25, 6);
  });
});

describe("levelsOf", () => {
  it("finds the 5th, 50th and 95th percentiles of a frame's brightness", () => {
    const frame = Uint8Array.from({ length: 1000 }, (_, i) => Math.floor((i / 1000) * 256));
    const l = levelsOf(frame);
    expect(l.low).toBeCloseTo(0.05 * 256 / 255, 2);
    expect(l.mid).toBeCloseTo(0.5 * 256 / 255, 2);
    expect(l.high).toBeCloseTo(0.95 * 256 / 255, 2);
  });
});

describe("levelsFilter", () => {
  // A 2.1 s ramp of every brightness, 10 frames a second, through the filter.
  const fps = 10;
  const samples: LevelsSample[] = [
    { t: 0, low: 0.3, mid: 0.55, high: 0.8 },
    { t: 2, low: 0.1, mid: 0.4, high: 0.75 },
  ];
  const run = (filter: string): Buffer =>
    execFileSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", `nullsrc=s=256x2:r=${fps}:d=2.1,format=yuv444p,geq=lum='X':cb=128:cr=128`,
      "-vf", filter, "-f", "rawvideo", "-pix_fmt", "yuv444p", "-",
    ]);
  const out = run(levelsFilter(samples, TARGET, { start: 0, fps }));
  const lumaAt = (frame: number, x: number) => out[frame * 256 * 2 * 3 + x];

  it("brings each sample time's measured levels to the target", () => {
    for (const [frame, s] of [[0, samples[0]], [20, samples[1]]] as const) {
      expect(Math.abs(lumaAt(frame, Math.round(s.low * 255)) - TARGET.low * 255)).toBeLessThanOrEqual(2);
      expect(Math.abs(lumaAt(frame, Math.round(s.mid * 255)) - TARGET.mid * 255)).toBeLessThanOrEqual(2);
      expect(Math.abs(lumaAt(frame, Math.round(s.high * 255)) - TARGET.high * 255)).toBeLessThanOrEqual(2);
    }
  });

  it("follows ffmpeg's own curve between samples", () => {
    const [a, b] = samples.map((s) => fitEq([s.low, s.mid, s.high], [TARGET.low, TARGET.mid, TARGET.high]));
    const half = { contrast: (a.contrast + b.contrast) / 2, brightness: (a.brightness + b.brightness) / 2, gamma: (a.gamma + b.gamma) / 2 };
    for (const x of [40, 100, 160, 220]) expect(Math.abs(lumaAt(10, x) - Math.floor(256 * eqCurve(half, x / 255)))).toBeLessThanOrEqual(2);
  });
});

describe("gradeFilter", () => {
  const samples: LevelsSample[] = [{ t: 0, low: 0.3, mid: 0.55, high: 0.8 }];

  it("is nothing at all for a neutral grade with no levels to match", () => {
    expect(gradeFilter(null, { ...TARGET, saturation: 1, temperature: 6500 }, { start: 0, fps: 30 })).toBeUndefined();
  });

  it("warms the picture and lifts the colour when asked", () => {
    const f = gradeFilter(null, { ...TARGET, saturation: 1.1, temperature: 5600 }, { start: 0, fps: 30 })!;
    expect(f).toContain("saturation=1.1");
    expect(f).toContain("colortemperature=temperature=5600");
  });

  it("matches the levels before warming", () => {
    const f = gradeFilter(samples, { ...TARGET, saturation: 1, temperature: 5600 }, { start: 0, fps: 30 })!;
    expect(f.indexOf("eq=")).toBeLessThan(f.indexOf("colortemperature"));
  });
});
