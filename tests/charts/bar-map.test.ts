import { describe, it, expect } from "vitest";
import { mapScore, songSections } from "../../src/charts/bar-map.js";
import type { ScoreInfo } from "../../src/charts/score-info.js";
import type { ScoreSpec } from "../../src/manifest.js";

// Seven Nation Army's shape: Riff/Verse/Instrumental pairs, then a 1-bar Hit
// the transcription doesn't have. 4/4 throughout, 117 bars.
const SECTIONS = songSections(
  [
    { name: "Riff", bars: 8 },
    { name: "Verse", bars: 18 },
    { name: "Instrumental", bars: 10 },
    { name: "Riff", bars: 8 },
    { name: "Verse", bars: 18 },
    { name: "Guitar Solo", bars: 18 },
    { name: "Riff", bars: 8 },
    { name: "Verse", bars: 18 },
    { name: "Outro", bars: 8 },
    { name: "End", bars: 2 },
    { name: "Hit", bars: 1 },
  ],
  [4, 4],
);

const SCORE: ScoreInfo = {
  bars: 116,
  tracks: [
    { name: "Vocals", kind: "tab" },
    { name: "Lead Guitar", kind: "tab" },
    { name: "Rhythm Guitar", kind: "tab" },
  ],
  markers: [],
};

const score = (sections: ScoreSpec["sections"]): ScoreSpec => ({ id: "ug", file: "song.gp5", sections });

/** Score bars for a run of song bars (1-based, inclusive). */
const scoreBars = (bars: ReturnType<typeof mapScore>["bars"], from: number, to: number) =>
  bars.filter((b) => b.songBar >= from && b.songBar <= to).map((b) => b.scoreBar);

describe("songSections", () => {
  it("places sections back to back from beat 0, with their first bar", () => {
    expect(SECTIONS[0]).toMatchObject({ name: "Riff", occurrence: 1, firstBar: 1, startBeat: 0, beatsPerBar: 4 });
    expect(SECTIONS[1]).toMatchObject({ name: "Verse", occurrence: 1, firstBar: 9, startBeat: 32 });
    expect(SECTIONS[4]).toMatchObject({ name: "Verse", occurrence: 2, firstBar: 45, startBeat: 176 });
    expect(SECTIONS[10]).toMatchObject({ name: "Hit", occurrence: 1, firstBar: 117, startBeat: 464 });
  });
});

describe("mapScore", () => {
  it("maps a section occurrence's bars onto the score bars given for it", () => {
    const { bars, errors } = mapScore(score([{ section: "Verse", occurrence: 2, bars: [45, 62] }]), SECTIONS, SCORE);
    expect(errors).toEqual([]);
    const first = bars.find((b) => b.songBar === 45)!;
    expect(first).toMatchObject({ scoreBar: 45, startBeat: 176, beats: 4, section: 4 });
    expect(scoreBars(bars, 45, 62)).toEqual(Array.from({ length: 18 }, (_, i) => 45 + i));
  });

  it("covers every song bar, with null where the chart has nothing", () => {
    const { bars } = mapScore(score([{ section: "Verse", occurrence: 2, bars: [45, 62] }]), SECTIONS, SCORE);
    expect(bars).toHaveLength(117);
    expect(bars[0]).toMatchObject({ songBar: 1, scoreBar: null });
    expect(bars[116]).toMatchObject({ songBar: 117, scoreBar: null }); // the Hit
  });

  it("applies a name-wide entry to every occurrence, and a per-occurrence entry overrides it", () => {
    const { bars } = mapScore(score([
      { section: "Riff", bars: [1, 8] },
      { section: "Riff", occurrence: 3, bars: [81, 88] },
    ]), SECTIONS, SCORE);
    expect(scoreBars(bars, 1, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(scoreBars(bars, 37, 44)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // shared range
    expect(scoreBars(bars, 81, 88)).toEqual([81, 82, 83, 84, 85, 86, 87, 88]); // override
  });

  it("plays a repeated range at the beats where each repetition falls", () => {
    const { bars } = mapScore(score([{ section: "Riff", occurrence: 1, bars: [1, 2], repeat: 4 }]), SECTIONS, SCORE);
    expect(scoreBars(bars, 1, 8)).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
    expect(bars.find((b) => b.songBar === 3)).toMatchObject({ scoreBar: 1, startBeat: 8 });
  });

  it("reports score bars past the end of the score", () => {
    const { errors } = mapScore(score([{ section: "Hit", bars: [117, 117] }]), SECTIONS, SCORE);
    expect(errors.join("\n")).toMatch(/Hit.*117.*116/);
  });

  it("honors a per-section meter", () => {
    const sections = songSections([{ name: "Pickup", bars: 1, timeSignature: [2, 4] }, { name: "Verse", bars: 2 }], [4, 4]);
    const { bars } = mapScore(score([{ section: "Verse", bars: [2, 3] }]), sections, { ...SCORE, bars: 3 });
    expect(bars.map((b) => [b.songBar, b.startBeat, b.beats])).toEqual([[1, 0, 2], [2, 2, 4], [3, 6, 4]]);
  });
});
