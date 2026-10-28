import { describe, it, expect } from "vitest";
import { beatIndex, beatTime, liveBeatMap, mapWords, pairWords, showToLive } from "../src/gig/beatmap.js";

/** A live beat every half second from `from` seconds, `n` of them. */
const grid = (n: number, from = 0, every = 0.5) => Array.from({ length: n }, (_, i) => from + i * every);

describe("pairWords", () => {
  it("pairs words by text in order, ignoring case and punctuation", () => {
    const live = ["WELL", "I'M", "SO", "ABOVE"].map((text) => ({ text }));
    const show = ["Well,", "I'm", "so", "above"].map((text) => ({ text }));
    expect(pairWords(live, show)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });

  it("skips words only one side has", () => {
    const live = ["a", "b", "x", "c"].map((text) => ({ text }));
    const show = ["a", "b", "c", "d"].map((text) => ({ text }));
    expect(pairWords(live, show)).toEqual([[0, 0], [1, 1], [3, 2]]);
  });
});

describe("beatIndex and beatTime", () => {
  const beats = [10, 10.5, 11, 12];

  it("counts live beats fractionally between two beats", () => {
    expect(beatIndex(beats, 10.25)).toBeCloseTo(0.5);
    expect(beatIndex(beats, 11.5)).toBeCloseTo(2.5);
  });

  it("goes back from a beat count to a time, at the nearest beats' spacing outside the grid", () => {
    expect(beatTime(beats, 2.5)).toBeCloseTo(11.5);
    expect(beatTime(beats, -2)).toBeCloseTo(9);
    expect(beatTime(beats, 5)).toBeCloseTo(14);
  });
});

describe("liveBeatMap", () => {
  const beats = grid(200, 5); // live beats at 5, 5.5, 6, ...
  /** A word sung at show beat `b`, with live beats `shift` ahead of the show track. */
  const sung = (b: number, shift: number, text = "la") => ({
    live: { text, start: beatTime(beats, b + shift), end: beatTime(beats, b + shift) + 0.2 },
    show: { text, startBeat: b, endBeat: b + 0.4 },
  });
  const map = (words: { live: { text: string; start: number; end: number }; show: { text: string; startBeat: number; endBeat: number } }[]) =>
    liveBeatMap(beats, words.map((w) => w.live), words.map((w) => w.show));

  it("finds one shift when the band stays on the click", () => {
    const words = Array.from({ length: 20 }, (_, i) => sung(4 + i * 2, 10));
    const { pieces } = map(words);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].shift).toBeCloseTo(10);
  });

  it("starts a new piece where the band repeated or skipped beats", () => {
    const words = [
      ...Array.from({ length: 12 }, (_, i) => sung(4 + i * 2, 10)),
      ...Array.from({ length: 12 }, (_, i) => sung(40 + i * 2, 18)),
    ];
    const { pieces } = map(words);
    expect(pieces.map((p) => Math.round(p.shift))).toEqual([10, 18]);
    expect(pieces[0].toBeat).toBeLessThanOrEqual(40);
    expect(pieces[1].fromBeat).toBeGreaterThan(26);
  });

  it("is not moved by a few badly aligned words", () => {
    const words = Array.from({ length: 20 }, (_, i) => sung(4 + i * 2, i === 7 || i === 13 ? 13 : 10));
    expect(map(words).pieces).toHaveLength(1);
  });

  it("ignores stretched words", () => {
    const words = Array.from({ length: 20 }, (_, i) => sung(4 + i * 2, 10));
    words[0].live = { ...words[0].live, start: 0, end: 30 };
    expect(map(words).pieces[0].shift).toBeCloseTo(10);
  });
});

describe("showToLive", () => {
  const beats = grid(100, 5);
  const pieces = [
    { fromBeat: -Infinity, toBeat: 20, shift: 4 },
    { fromBeat: 30, toBeat: Infinity, shift: 12 },
  ];

  it("places a show beat through the piece that covers it", () => {
    expect(showToLive(beats, pieces, 0)).toBeCloseTo(7);
    expect(showToLive(beats, pieces, 40)).toBeCloseTo(31);
  });

  it("has no place for a beat between pieces", () => {
    expect(showToLive(beats, pieces, 25)).toBeNull();
  });
});

describe("mapWords", () => {
  const beats = grid(100, 5);
  const pieces = [{ fromBeat: -Infinity, toBeat: 20, shift: 4 }];

  it("times each paired word from the show track inside a piece and keeps the live timing outside", () => {
    const live = [
      { text: "one", start: 7.1, end: 7.3 },
      { text: "two", start: 30, end: 31 },
    ];
    const show = [
      { text: "one", startBeat: 0, endBeat: 0.5 },
      { text: "two", startBeat: 24, endBeat: 25 },
    ];
    expect(mapWords(beats, pieces, live, show)).toEqual([
      { text: "one", start: 7, end: 7.25 },
      { text: "two", start: 30, end: 31 },
    ]);
  });
});
