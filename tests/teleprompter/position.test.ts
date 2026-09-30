import { describe, it, expect } from "vitest";
import { songPosition, sectionMeters } from "../../src/teleprompter/position.js";

// Verse (2 bars of 4/4), a 2/4 bar, Chorus (2 bars of 4/4): beats 0, 8, 10.
const SECTIONS = [
  { startBeat: 0, bars: 2, beatsPerBar: 4 },
  { startBeat: 8, bars: 1, beatsPerBar: 2 },
  { startBeat: 10, bars: 2, beatsPerBar: 4 },
];
const at = (beat: number) => songPosition(SECTIONS, beat, 4);

describe("songPosition", () => {
  it("is bar 1 beat 1 of the first section at the downbeat", () => {
    expect(at(0)).toEqual({ section: 0, bar: 1, beat: 1, measure: 1 });
  });

  it("counts bars within the section and beats within the bar", () => {
    expect(at(5.5)).toEqual({ section: 0, bar: 2, beat: 2, measure: 2 });
  });

  it("counts each section in its own meter", () => {
    expect(at(9.2)).toEqual({ section: 1, bar: 1, beat: 2, measure: 3 });
    expect(at(10)).toEqual({ section: 2, bar: 1, beat: 1, measure: 4 });
  });

  it("keeps counting in the last section's meter past the end", () => {
    expect(at(20)).toEqual({ section: 2, bar: 3, beat: 3, measure: 6 });
  });

  it("counts the count-in back from the downbeat, outside any section", () => {
    expect(at(-3)).toEqual({ section: -1, bar: 0, beat: 2, measure: 0 });
    expect(at(-5)).toEqual({ section: -1, bar: -1, beat: 4, measure: -1 });
  });
});

describe("sectionMeters", () => {
  it("takes each section's meter from where the next one starts", () => {
    const display = {
      timeSignature: [4, 4] as [number, number],
      display: { sections: [{ startBeat: 0, bars: 2 }, { startBeat: 8, bars: 1 }, { startBeat: 10, bars: 2 }] },
    };
    expect(sectionMeters(display).map((s) => s.beatsPerBar)).toEqual([4, 2, 4]);
  });

  it("takes the last section's meter from the meter map, or the time signature", () => {
    const sections = [{ startBeat: 0, bars: 2 }, { startBeat: 8, bars: 1 }];
    const withMap = {
      timeSignature: [4, 4] as [number, number],
      meterMap: [{ fromMeasure: 1, beatsPerBar: 4, beatsBefore: 0 }, { fromMeasure: 3, beatsPerBar: 3, beatsBefore: 8 }],
      display: { sections },
    };
    expect(sectionMeters(withMap).map((s) => s.beatsPerBar)).toEqual([4, 3]);
    expect(sectionMeters({ timeSignature: [4, 4], display: { sections } }).map((s) => s.beatsPerBar)).toEqual([4, 4]);
  });
});

describe("songPosition — bars in their own meter", () => {
  // Verse: 4 bars with bar 2 in 2/4 (14 beats), then Chorus in 4/4.
  const sections = [
    { startBeat: 0, bars: 4, beatsPerBar: 4, barBeats: [4, 2, 4, 4] },
    { startBeat: 14, bars: 2, beatsPerBar: 4 },
  ];
  const at = (beat: number) => songPosition(sections, beat, 4);

  it("counts each bar in its own length", () => {
    expect(at(4.5)).toEqual({ section: 0, bar: 2, beat: 1, measure: 2 });
    expect(at(5)).toEqual({ section: 0, bar: 2, beat: 2, measure: 2 });
    expect(at(6)).toEqual({ section: 0, bar: 3, beat: 1, measure: 3 });
    expect(at(13)).toEqual({ section: 0, bar: 4, beat: 4, measure: 4 });
  });

  it("keeps the song's bar count right after it", () => {
    expect(at(14)).toEqual({ section: 1, bar: 1, beat: 1, measure: 5 });
  });

  it("is passed along by sectionMeters", () => {
    const display = {
      timeSignature: [4, 4] as [number, number],
      display: { sections: [{ startBeat: 0, bars: 4, barBeats: [4, 2, 4, 4] }, { startBeat: 14, bars: 2 }] },
    };
    expect(sectionMeters(display)).toEqual([
      { startBeat: 0, bars: 4, beatsPerBar: 4, barBeats: [4, 2, 4, 4] },
      { startBeat: 14, bars: 2, beatsPerBar: 4 },
    ]);
  });
});
