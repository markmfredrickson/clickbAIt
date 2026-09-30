import { describe, it, expect } from "vitest";
import { grooveChart, grooveLetter, runAt } from "../../src/charts/grooves.js";
import { songSections, type MappedBar } from "../../src/charts/bar-map.js";

// Verse (4 bars) and Chorus (3 bars), 4/4. Each song bar plays one score bar.
const SECTIONS = songSections([{ name: "Verse", bars: 4 }, { name: "Chorus", bars: 3 }], [4, 4]);
const mapped = (scoreBars: (number | null)[]): MappedBar[] =>
  scoreBars.map((scoreBar, i) => ({
    songBar: i + 1,
    section: i < 4 ? 0 : 1,
    startBeat: i * 4,
    beats: 4,
    scoreBar,
  }));
// Score bars 1, 2 and 5 are the same groove; 3 is a fill; 4 is a stop.
const SIGS = ["groove", "groove", "fill", "stop", "groove"];

describe("grooveChart", () => {
  const chart = grooveChart(mapped([1, 2, 5, 3, 1, 1, 4]), SIGS, SECTIONS);

  it("names each distinct bar with a letter, in the order the song first plays it", () => {
    expect(chart.grooves).toEqual([
      { letter: "A", scoreBar: 1 },
      { letter: "B", scoreBar: 3 },
      { letter: "C", scoreBar: 4 },
    ]);
  });

  it("merges repeats of a bar within a section, but not across sections", () => {
    expect(chart.sections.map((s) => s.runs.map((r) => `${r.letter}×${r.count}`))).toEqual([
      ["A×3", "B×1"],
      ["A×2", "C×1"],
    ]);
  });

  it("marks where each letter is first played in each section, for drawing it there", () => {
    // The Chorus draws A again: a section's line reads on its own.
    expect(chart.sections.flatMap((s) => s.runs.map((r) => r.first))).toEqual([true, true, true, true]);
  });

  it("draws a letter once per section, however often the section comes back to it", () => {
    const back = grooveChart(mapped([1, 3, 1, 3, 1, 1, 4]), SIGS, SECTIONS);
    expect(back.sections[0].runs.map((r) => [r.letter, r.first])).toEqual([["A", true], ["B", true], ["A", false], ["B", false]]);
  });

  it("records where each run starts on the timeline", () => {
    expect(chart.sections[1].runs.map((r) => [r.songBar, r.startBeat, r.beats])).toEqual([[5, 16, 4], [7, 24, 4]]);
  });

  it("gives song bars with no score bar no letter", () => {
    const gaps = grooveChart(mapped([1, null, null, 1, 1, 1, 1]), SIGS, SECTIONS);
    expect(gaps.sections[0].runs.map((r) => [r.letter, r.count])).toEqual([["A", 1], [null, 2], ["A", 1]]);
  });
});

describe("grooveLetter", () => {
  it("goes A to Z, then AA, AB and on", () => {
    expect([0, 25, 26, 27, 52].map(grooveLetter)).toEqual(["A", "Z", "AA", "AB", "BA"]);
  });
});

describe("runAt", () => {
  const chart = grooveChart(mapped([1, 2, 5, 3, 1, 1, 4]), SIGS, SECTIONS);

  it("finds the run playing at a beat, and which of its bars", () => {
    expect(runAt(chart, 9)).toEqual({ section: 0, run: 0, bar: 3 });
    expect(runAt(chart, 12)).toEqual({ section: 0, run: 1, bar: 1 });
    expect(runAt(chart, 27.5)).toEqual({ section: 1, run: 1, bar: 1 });
  });

  it("is null before the first bar and after the last", () => {
    expect(runAt(chart, -1)).toBeNull();
    expect(runAt(chart, 28)).toBeNull();
  });
});
