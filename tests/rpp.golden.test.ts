/**
 * Golden master test: generate RPP matching examples/basic.RPP
 * and compare tempo map + region markers (GUIDs and boilerplate excluded).
 *
 * basic.RPP structure:
 *   120 BPM, 4/4
 *   Region 1:              beat 0  → 8   (2 bars × 4 beats)
 *   8 Bar Region:          beat 8  → 24  (4 bars × 4 beats)
 *   Tempo and Time Change: beat 24 → 28.5 (160 BPM, 3/4, user-dragged end)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { generateRpp } from "../src/rpp.js";
import type { Song } from "@clickbait/dsongl";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const goldenPath = resolve(__dirname, "../examples/basic.RPP");

/** Strip GUIDs and normalize whitespace for comparison. */
function normalize(line: string): string {
  return line
    .trim()
    .replace(/\{[0-9A-F-]+\}/gi, "{GUID}")
    .replace(/\s+/g, " ");
}

/** Extract PT and MARKER lines from an RPP string. */
function extractKeyLines(rpp: string): string[] {
  return rpp
    .split("\n")
    .map(normalize)
    .filter((l) => l.startsWith("PT ") || l.startsWith("MARKER ") || l.startsWith("TEMPO "));
}

/** Parse a number from RPP string (strips trailing zeros). */
function n(s: string): number {
  return parseFloat(s);
}

const basicSong: Song = {
  title: "basic",
  masterBpm: 120,
  defaultBeats: 4,
  sections: [
    // 4 bars × 4 beats ÷ 120 BPM × 60 = 8 seconds (0→8)
    { name: "Region 1",              bars: [{ beats: 4, repeat: 4 }] },
    // 8 bars = 16 seconds (8→24)
    { name: "8 Bar Region",          bars: [{ beats: 4, repeat: 8 }] },
    // 160 BPM, 3/4. 4 bars × 3 beats ÷ 160 BPM × 60 = 4.5 seconds (24→28.5)
    { name: "Tempo and Time Change", bars: [{ beats: 3, repeat: 4, bpmMultiplier: 160 / 120 }],
      color: 9 },
  ],
};

describe("golden master — basic.RPP", () => {
  it("TEMPO line matches", () => {
    const rpp = generateRpp(basicSong);
    const ourTempo = extractKeyLines(rpp).find((l) => l.startsWith("TEMPO"));
    expect(ourTempo).toBe("TEMPO 120 4 4 0");
  });

  it("PT entries match golden beat positions and BPM", () => {
    const golden = readFileSync(goldenPath, "utf-8");
    const goldenPts = golden.split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("PT "))
      .map((l) => {
        const [, pos, bpm] = l.split(" ");
        return { pos: n(pos), bpm: n(bpm) };
      });

    const rpp = generateRpp(basicSong);
    const ourPts = rpp.split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("PT "))
      .map((l) => {
        const [, pos, bpm] = l.split(" ");
        return { pos: n(pos), bpm: n(bpm) };
      });

    expect(ourPts).toHaveLength(goldenPts.length);
    for (let i = 0; i < goldenPts.length; i++) {
      expect(ourPts[i].pos).toBeCloseTo(goldenPts[i].pos, 6);
      expect(ourPts[i].bpm).toBeCloseTo(goldenPts[i].bpm, 4);
    }
  });

  it("region start positions and names match golden", () => {
    const golden = readFileSync(goldenPath, "utf-8");
    const goldenStarts = golden.split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("MARKER") && !l.includes('""'))
      .map((l) => {
        const parts = l.match(/MARKER \d+ ([\d.]+) "([^"]+)"/);
        return parts ? { pos: n(parts[1]), name: parts[2] } : null;
      })
      .filter(Boolean);

    const rpp = generateRpp(basicSong);
    const ourStarts = rpp.split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("MARKER") && !l.includes('""'))
      .map((l) => {
        const parts = l.match(/MARKER \d+ ([\d.]+) "([^"]+)"/);
        return parts ? { pos: n(parts[1]), name: parts[2] } : null;
      })
      .filter(Boolean);

    expect(ourStarts).toHaveLength(goldenStarts.length);
    for (let i = 0; i < goldenStarts.length; i++) {
      expect(ourStarts[i]!.name).toBe(goldenStarts[i]!.name);
      expect(ourStarts[i]!.pos).toBeCloseTo(goldenStarts[i]!.pos, 6);
    }
  });

  it("region end positions match golden", () => {
    const golden = readFileSync(goldenPath, "utf-8");
    const goldenEnds = golden.split("\n")
      .map((l) => l.trim())
      .filter((l) => l.match(/^MARKER \d+ [\d.]+ ""/))
      .map((l) => {
        const parts = l.match(/MARKER \d+ ([\d.]+)/);
        return parts ? n(parts[1]) : null;
      })
      .filter(Boolean);

    const rpp = generateRpp(basicSong);
    const ourEnds = rpp.split("\n")
      .map((l) => l.trim())
      .filter((l) => l.match(/^MARKER \d+ [\d.]+ ""/))
      .map((l) => {
        const parts = l.match(/MARKER \d+ ([\d.]+)/);
        return parts ? n(parts[1]) : null;
      })
      .filter(Boolean);

    expect(ourEnds).toHaveLength(goldenEnds.length);
    for (let i = 0; i < goldenEnds.length; i++) {
      expect(ourEnds[i]).toBeCloseTo(goldenEnds[i]!, 6);
    }
  });
});
