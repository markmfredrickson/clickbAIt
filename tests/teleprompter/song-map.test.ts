import { describe, it, expect } from "vitest";
import { songMap, songProgress } from "../../src/teleprompter/song-map.js";

// 8 beats of 4/4, a 2/4 bar, 8 beats of 4/4: 18 beats in all.
const SECTIONS = [
  { startBeat: 0, bars: 2, beatsPerBar: 4 },
  { startBeat: 8, bars: 1, beatsPerBar: 2 },
  { startBeat: 10, bars: 2, beatsPerBar: 4 },
];

describe("songMap", () => {
  it("gives each section its share of the song's length, in order", () => {
    expect(songMap(SECTIONS)).toEqual([
      { start: 0, width: 8 / 18 },
      { start: 8 / 18, width: 2 / 18 },
      { start: 10 / 18, width: 8 / 18 },
    ]);
  });

  it("is empty for a song with no sections", () => {
    expect(songMap([])).toEqual([]);
  });
});

describe("songProgress", () => {
  it("is the section playing and how far through it and the song", () => {
    expect(songProgress(SECTIONS, 4)).toEqual({ section: 0, inSection: 0.5, inSong: 4 / 18 });
    expect(songProgress(SECTIONS, 9)).toEqual({ section: 1, inSection: 0.5, inSong: 9 / 18 });
  });

  it("is nothing yet before the downbeat", () => {
    expect(songProgress(SECTIONS, -2)).toEqual({ section: -1, inSection: 0, inSong: 0 });
  });

  it("stays full at the end", () => {
    expect(songProgress(SECTIONS, 30)).toEqual({ section: 2, inSection: 1, inSong: 1 });
  });
});

describe("songMap — bars in their own meter", () => {
  it("sizes a section by its real bar lengths", () => {
    const sections = [
      { startBeat: 0, bars: 4, beatsPerBar: 4, barBeats: [4, 2, 4, 4] },
      { startBeat: 14, bars: 2, beatsPerBar: 3 },
    ];
    expect(songMap(sections)).toEqual([
      { start: 0, width: 14 / 20 },
      { start: 14 / 20, width: 6 / 20 },
    ]);
    expect(songProgress(sections, 7).inSection).toBe(0.5);
  });
});
