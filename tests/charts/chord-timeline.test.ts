import { describe, it, expect } from "vitest";
import { chordBeats, sourceTime, type ChordTiming } from "../../src/charts/chord-timeline.js";
import { beatMapCurve } from "../../src/core/beat-map.js";

// A 60 bpm recording pinned one beat per second, so source seconds = beats.
const beatMap = [{ startBeat: 0, times: Array.from({ length: 21 }, (_, i) => i) }];
const timing = (clips?: ChordTiming["clips"]): ChordTiming => ({
  curve: beatMapCurve(beatMap, 60),
  clips,
  offset: 0,
  bpm: 60,
});
const seg = (start: number, end: number) => ({ start, end });

describe("chordBeats", () => {
  it("puts each segment's start on the recording's beat when the recording plays straight", () => {
    expect(chordBeats([seg(0, 2), seg(2, 5.5), seg(5.5, 8)], timing())).toEqual([
      { segment: 0, beat: 0 },
      { segment: 1, beat: 2 },
      { segment: 2, beat: 5.5 },
    ]);
  });

  it("repeats a chord in a replayed clip at each replay", () => {
    const clips = [{ from: 4, seconds: 4 }, { from: 4, seconds: 4 }];
    expect(chordBeats([seg(5, 6)], timing(clips))).toEqual([{ segment: 0, beat: 1 }, { segment: 0, beat: 5 }]);
  });

  it("drops chords outside every clip", () => {
    const clips = [{ from: 4, seconds: 4 }];
    expect(chordBeats([seg(1, 2), seg(9, 10)], timing(clips))).toEqual([]);
  });

  it("puts a chord already sounding when a clip starts on the clip's first beat", () => {
    const clips = [{ from: 4, seconds: 4 }];
    expect(chordBeats([seg(3, 6), seg(6, 7)], timing(clips))).toEqual([{ segment: 0, beat: 0 }, { segment: 1, beat: 2 }]);
  });

  it("counts silence clips on the timeline", () => {
    const clips = [{ silence: 2 }, { from: 4, seconds: 4 }];
    expect(chordBeats([seg(5, 6)], timing(clips))).toEqual([{ segment: 0, beat: 3 }]);
  });

  it("returns chords in beat order when clips rearrange the recording", () => {
    const clips = [{ from: 8, seconds: 2 }, { from: 0, seconds: 2 }];
    expect(chordBeats([seg(0, 1), seg(8, 9)], timing(clips))).toEqual([{ segment: 1, beat: 0 }, { segment: 0, beat: 2 }]);
  });
});

describe("sourceTime", () => {
  it("inverts the straight mapping", () => {
    expect(sourceTime(5.5, timing())).toBe(5.5);
  });

  it("finds the clip that plays a beat", () => {
    const clips = [{ from: 4, seconds: 4 }, { from: 12, seconds: 4 }];
    expect(sourceTime(1, timing(clips))).toBe(5);
    expect(sourceTime(5, timing(clips))).toBe(13);
  });

  it("is null for a beat in silence or past the last clip", () => {
    const clips = [{ silence: 2 }, { from: 4, seconds: 4 }];
    expect(sourceTime(1, timing(clips))).toBeNull();
    expect(sourceTime(7, timing(clips))).toBeNull();
  });
});
