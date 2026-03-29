import { describe, it, expect } from "vitest";
import { getHighlightState, getBarPosition } from "../../src/teleprompter/highlight.js";
import type { SongPayload } from "../../src/teleprompter/types.js";

const payload: SongPayload = {
  title: "Test",
  bpm: 120,
  slug: "test",
  tempoMap: [{ beat: 0, seconds: 0, bpm: 120 }],
  sections: [
    {
      name: "Intro",
      beat: 0,
      seconds: 0,
      durationBeats: 8,
      durationSeconds: 4,
      lyrics: [],
      chords: [{ chord: "C", beat: 0, seconds: 0 }],
    },
    {
      name: "Verse 1",
      beat: 8,
      seconds: 4,
      durationBeats: 16,
      durationSeconds: 8,
      lyrics: [
        { text: "First line", beat: 8, seconds: 4 },
        { text: "Second line", beat: 12, seconds: 6 },
        { text: "Third line", beat: 16, seconds: 8 },
        { text: "Fourth line", beat: 20, seconds: 10 },
      ],
      chords: [],
    },
    {
      name: "Chorus",
      beat: 24,
      seconds: 12,
      durationBeats: 16,
      durationSeconds: 8,
      lyrics: [
        { text: "Chorus line", beat: 24, seconds: 12 },
      ],
      chords: [],
    },
  ],
};

describe("getHighlightState", () => {
  it("returns -1 before first section", () => {
    const state = getHighlightState(payload, -1);
    expect(state.sectionIndex).toBe(-1);
    expect(state.lyricIndex).toBe(-1);
  });

  it("highlights intro with no lyrics", () => {
    const state = getHighlightState(payload, 0);
    expect(state.sectionIndex).toBe(0);
    expect(state.lyricIndex).toBe(-1); // Intro has no lyrics
    expect(state.sectionProgress).toBeCloseTo(0);
  });

  it("highlights first lyric of verse", () => {
    const state = getHighlightState(payload, 8);
    expect(state.sectionIndex).toBe(1);
    expect(state.lyricIndex).toBe(0);
    expect(state.sectionProgress).toBeCloseTo(0);
  });

  it("highlights second lyric mid-verse", () => {
    const state = getHighlightState(payload, 13);
    expect(state.sectionIndex).toBe(1);
    expect(state.lyricIndex).toBe(1); // beat 13 > lyric at 12
  });

  it("tracks progress through section", () => {
    // Beat 16 is halfway through verse (beats 8–24, duration 16)
    const state = getHighlightState(payload, 16);
    expect(state.sectionProgress).toBeCloseTo(0.5);
  });

  it("clamps progress at 1", () => {
    // Beat 24 is exactly at the end of verse / start of chorus
    const state = getHighlightState(payload, 24);
    expect(state.sectionIndex).toBe(2); // now in chorus
    expect(state.sectionProgress).toBeCloseTo(0);
  });

  it("handles beat between lyrics", () => {
    // Beat 15: after second lyric (12) but before third (16)
    const state = getHighlightState(payload, 15);
    expect(state.lyricIndex).toBe(1);
  });
});

describe("getBarPosition", () => {
  const verse = payload.sections[1]; // starts at beat 8

  it("returns bar 0 at section start", () => {
    const pos = getBarPosition(verse, 8, 4);
    expect(pos.bar).toBe(0);
    expect(pos.barProgress).toBeCloseTo(0);
  });

  it("returns mid-bar progress", () => {
    const pos = getBarPosition(verse, 10, 4);
    expect(pos.bar).toBe(0);
    expect(pos.barProgress).toBeCloseTo(0.5); // 2 beats into a 4-beat bar
  });

  it("advances to next bar", () => {
    const pos = getBarPosition(verse, 12, 4);
    expect(pos.bar).toBe(1);
    expect(pos.barProgress).toBeCloseTo(0);
  });

  it("handles third bar with progress", () => {
    const pos = getBarPosition(verse, 17, 4);
    expect(pos.bar).toBe(2);
    expect(pos.barProgress).toBeCloseTo(0.25); // 1 beat into bar
  });
});
