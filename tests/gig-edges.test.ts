import { describe, it, expect } from "vitest";
import { checkCut, cutLines, edgePhrases, edgeWindows, levels, musicRuns, musicSpan, spokenText } from "../src/gig/edges.js";
import type { CaptionLine } from "../src/gig/srt.js";

/** Aligned words as align.json has them: milliseconds in the vocal's own time. */
const aligned = {
  words: [
    { text: "a", startMs: 20000, endMs: 20400 },
    { text: "b", startMs: 21000, endMs: 21400 },
    { text: "c", startMs: 150000, endMs: 150600 },
  ],
  lines: [
    { text: "lost", wordRange: [0, 0] as [number, number] },
    { text: "a b", wordRange: [0, 2] as [number, number] },
    { text: "c", wordRange: [2, 3] as [number, number] },
  ],
};

describe("edgeWindows", () => {
  it("runs the head from the start to the first sung word and the tail from the last sung word to the end", () => {
    expect(edgeWindows(aligned, 180)).toEqual({ head: { start: 0, end: 20 }, tail: { start: 150.6, end: 180 } });
  });

  it("ignores words no line claims", () => {
    const words = [{ text: "x", startMs: 5000, endMs: 5200 }, ...aligned.words];
    const lines = [
      { text: "a b", wordRange: [1, 3] as [number, number] },
      { text: "c", wordRange: [3, 4] as [number, number] },
    ];
    expect(edgeWindows({ words, lines }, 180).head.end).toBe(20);
  });

  it("refuses a song with no sung words", () => {
    expect(() => edgeWindows({ words: [], lines: [{ text: "lost", wordRange: [0, 0] }] }, 180)).toThrow(/no aligned words/);
  });
});

describe("edgePhrases", () => {
  /** Whisper's words for a window, in milliseconds from the window's start. */
  const heard = [
    { text: "thank", startMs: 1000, endMs: 1300 },
    { text: "you", startMs: 1300, endMs: 1600 },
    { text: "one", startMs: 2300, endMs: 2500 },
    { text: "two", startMs: 2900, endMs: 3100 },
  ];

  it("puts Whisper's words on the video's timeline, the way the captions do", () => {
    const sync = { offset: 100, drift_ppm: 50 };
    const [first] = edgePhrases(heard, { start: 150, end: 180 }, sync);
    expect(first.start).toBeCloseTo(151 / (1 + 50e-6), 3);
  });

  it("starts a new phrase at a pause of 0.7 seconds or more", () => {
    expect(edgePhrases(heard, { start: 10, end: 20 }, null)).toEqual([
      { start: 11, end: 11.6, text: "thank you" },
      { start: 12.3, end: 13.1, text: "one two" },
    ]);
  });

  it("keeps only words inside the window", () => {
    const over = [...heard, { text: "late", startMs: 9800, endMs: 10400 }];
    expect(edgePhrases(over, { start: 10, end: 20 }, null).map((p) => p.text)).toEqual(["thank you", "one two"]);
  });
});

describe("checkCut", () => {
  const lines: CaptionLine[] = [
    { text: "a b", words: [{ start: 20, end: 20.4 }, { start: 21, end: 21.4 }] },
    { text: "lost", words: [] },
    { text: "c", words: [{ start: 150, end: 150.6 }] },
  ];

  it("accepts a cut around every sung word, from either end or both", () => {
    expect(() => checkCut({ in: 15, out: 170 }, lines)).not.toThrow();
    expect(() => checkCut({ in: 15 }, lines)).not.toThrow();
    expect(() => checkCut({ out: 170 }, lines)).not.toThrow();
    expect(() => checkCut({}, lines)).not.toThrow();
  });

  it("rejects an in after the first sung word", () => {
    expect(() => checkCut({ in: 20.2 }, lines)).toThrow(/in/);
  });

  it("rejects an out before the last sung word ends", () => {
    expect(() => checkCut({ out: 150.5 }, lines)).toThrow(/out/);
  });
});

describe("cutLines", () => {
  const lines: CaptionLine[] = [
    { text: "early", words: [{ start: 2, end: 2.5 }] },
    { text: "a b", words: [{ start: 20, end: 20.4 }, { start: 21, end: 21.4 }] },
    { text: "late", words: [{ start: 175, end: 176 }] },
  ];

  it("moves every word back by in", () => {
    expect(cutLines(lines.slice(1, 2), { in: 15 })[0].words).toEqual([{ start: 5, end: 5.4 }, { start: 6, end: 6.4 }]);
  });

  it("drops lines entirely outside the cut", () => {
    expect(cutLines(lines, { in: 15, out: 170 }).map((l) => l.text)).toEqual(["a b"]);
  });

  it("leaves the lines alone with no cut", () => {
    expect(cutLines(lines, {})).toEqual(lines);
  });
});

describe("spokenText", () => {
  const words = (...t: string[]) => t.map((text) => ({ text }));

  it("drops tokens with no letters", () => {
    expect(spokenText(words("♪", "Hey", "♪", "-", "...", "you"))).toBe("Hey you");
  });

  it("spells out counts up to twenty, keeping their punctuation off", () => {
    expect(spokenText(words("1,", "2,", "3,", "4", "20"))).toBe("one two three four twenty");
    expect(spokenText(words("One,", "two,"))).toBe("One, two,");
  });

  it("keeps apostrophes", () => {
    expect(spokenText(words("Steve's", "gonna"))).toBe("Steve's gonna");
  });

  it("gives nothing to align when nothing is left", () => {
    expect(spokenText(words("♪", "-"))).toBeNull();
    expect(spokenText([])).toBeNull();
  });
});

describe("levels", () => {
  it("measures each half second's RMS in dB", () => {
    const sr = 1000;
    const samples = new Float32Array(sr * 2);
    // One second of silence, then a full-scale sine (RMS 1/√2, -3 dB).
    for (let i = sr; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * 50 * i) / sr);
    const l = levels(samples, sr);
    expect(l).toHaveLength(4);
    expect(l[0]).toBeLessThan(-100);
    expect(l[1]).toBeLessThan(-100);
    expect(l[2]).toBeCloseTo(-3.01, 1);
    expect(l[3]).toBeCloseTo(-3.01, 1);
  });
});

describe("musicRuns", () => {
  /** Half-second levels from a string: "#" loud (-10 dB), "." quiet (-60 dB), "-" in between (-25 dB). */
  const steps = (s: string) => [...s].map((c) => (c === "#" ? -10 : c === "-" ? -25 : -60));

  it("counts a half second as music within 20 dB of the median while singing", () => {
    // Sung from 2 s to 6 s: the median there is -10, so -25 counts and -60 doesn't.
    expect(musicRuns(steps("....--##########......"), 0.5, { start: 2, end: 6 })).toEqual([{ start: 2, end: 8 }]);
  });

  it("fills gaps shorter than a second and drops runs shorter than a second", () => {
    expect(musicRuns(steps("##.###..####...#....##"), 0.5, { start: 0, end: 6 })).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 6 },
      { start: 10, end: 11 },
    ]);
  });
});

describe("musicSpan", () => {
  const runs = [
    { start: 3, end: 40 },
    { start: 42, end: 200 },
    { start: 205, end: 210 },
  ];

  it("covers every run that overlaps the sung words, reaching past them into an intro or outro", () => {
    expect(musicSpan(runs, 10, 190)).toEqual({ start: 3, end: 200 });
  });

  it("ignores a stray word in the quiet before or after the band", () => {
    expect(musicSpan(runs, 1, 202)).toEqual({ start: 3, end: 200 });
  });

  it("falls back to the sung words when the band never plays under them", () => {
    expect(musicSpan(runs, 212, 230)).toEqual({ start: 212, end: 230 });
  });
});
