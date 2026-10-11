import { describe, it, expect } from "vitest";
import { answer, clearAnswer, playWindow, stemFor } from "../../src/charts/review.js";
import type { MappedBar } from "../../src/charts/bar-map.js";

type Entry = { id: string; kind: string; instrument: string; score: string; track: number; sameAs?: Record<string, number>; distinct?: number[] };
const manifest = (): { title: string; charts: Entry[] } => ({
  title: "Song",
  charts: [
    { id: "bass", kind: "tab", instrument: "bass", score: "gp", track: 3 },
    { id: "drums", kind: "drums", instrument: "drums", score: "gp", track: 4, distinct: [7] },
  ],
});

describe("answer", () => {
  it("writes a same answer as sameAs in the chart's entry", () => {
    expect(answer(manifest(), "bass", 21, 15).charts[0]).toEqual({ id: "bass", kind: "tab", instrument: "bass", score: "gp", track: 3, sameAs: { "21": 15 } });
  });

  it("writes a different answer as distinct, in bar order", () => {
    expect(answer(manifest(), "drums", 3, null).charts[1].distinct).toEqual([3, 7]);
  });

  it("replaces the bar's other answer", () => {
    const m = answer(manifest(), "drums", 7, 5);
    expect([m.charts[1].sameAs, m.charts[1].distinct]).toEqual([{ "7": 5 }, undefined]);
  });

  it("leaves the manifest it was given alone", () => {
    const m = manifest();
    answer(m, "bass", 21, 15);
    expect(m).toEqual(manifest());
  });

  it("reports a chart the manifest doesn't have", () => {
    expect(() => answer(manifest(), "keys", 1, null)).toThrow(/no chart "keys"/);
  });
});

describe("clearAnswer", () => {
  it("takes a bar's answer out, and the field with it when it's the last", () => {
    expect(clearAnswer(manifest(), "drums", 7).charts[1]).toEqual({ id: "drums", kind: "drums", instrument: "drums", score: "gp", track: 4 });
    const twice = answer(answer(manifest(), "bass", 21, 15), "bass", 43, 37);
    expect(clearAnswer(twice, "bass", 21).charts[0].sameAs).toEqual({ "43": 37 });
  });
});

describe("stemFor", () => {
  const four = { vocals: "v.wav", drums: "d.wav", bass: "b.wav", other: "o.wav" };

  it("takes the stem named for the part's instrument", () => {
    expect([stemFor("bass", four), stemFor("drums", four), stemFor("vocals", four)]).toEqual(["bass", "drums", "vocals"]);
  });

  it("takes `other` for an instrument with no stem of its own", () => {
    expect(stemFor("guitar", four)).toBe("other");
    expect(stemFor("guitar", { ...four, guitar: "g.wav" })).toBe("guitar");
  });

  it("has none without stems", () => {
    expect(stemFor("bass", undefined)).toBeNull();
    expect(stemFor("guitar", { vocals: "v.wav" })).toBeNull();
  });
});

describe("playWindow", () => {
  // Five 4/4 bars over two sections; one beat a second.
  const bars: MappedBar[] = [1, 2, 3, 4, 5].map((scoreBar, i) => ({ songBar: i + 1, section: i < 3 ? 0 : 1, startBeat: i * 4, beats: 4, scoreBar }));
  const toTime = (beat: number) => (beat >= 0 && beat <= 20 ? beat : null);

  it("plays the bar with a bar before and after", () => {
    expect(playWindow(bars, 0, 2, toTime)).toEqual({ start: 0, end: 12 });
  });

  it("starts on the bar itself at the start of the song, and stops at the end", () => {
    expect(playWindow(bars, 0, 1, toTime)).toEqual({ start: 0, end: 8 });
    expect(playWindow(bars, 1, 5, toTime)).toEqual({ start: 12, end: 20 });
  });

  it("looks for the bar in the section asked about", () => {
    expect(playWindow(bars, 1, 2, toTime)).toBeNull();
  });
});
