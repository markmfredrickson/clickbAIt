import { describe, it, expect } from "vitest";
import { figureChart, figureLetter, unrepeatedSections } from "../../src/charts/figures.js";
import { songSections, type MappedBar } from "../../src/charts/bar-map.js";

/**
 * Score bars for each section's song bars, 4/4 throughout. A score bar's
 * contents are its number's entry in SIGS, so bars 1, 2 and 5 play the same.
 */
function chartOf(...sections: (number | null)[][]) {
  const placed = songSections(sections.map((bars, i) => ({ name: `S${i}`, bars: bars.length })), [4, 4]);
  const bars: MappedBar[] = [];
  sections.forEach((scoreBars, section) =>
    scoreBars.forEach((scoreBar) => bars.push({ songBar: bars.length + 1, section, startBeat: bars.length * 4, beats: 4, scoreBar })),
  );
  return figureChart(bars, SIGS, placed);
}
// Score bars 1, 2 and 5 are the same; 3, 4, 6 and 7 each differ.
const SIGS = ["a", "a", "b", "c", "a", "d", "e"];
const phrases = (chart: ReturnType<typeof chartOf>, s = 0) =>
  chart.sections[s].runs.map((r) => `${r.letters.map((l) => l ?? "–").join(" ")} ×${r.count}`);

describe("figureChart: letters", () => {
  it("names each distinct bar with a letter, in the order the song first plays it", () => {
    expect(chartOf([1, 2, 3], [5, 4]).figures).toEqual([
      { letter: "A", scoreBar: 1 },
      { letter: "B", scoreBar: 3 },
      { letter: "C", scoreBar: 4 },
    ]);
  });

  it("merges a bar's repeats within a section, but not across sections", () => {
    const chart = chartOf([1, 2, 5, 3], [1, 1, 4]);
    expect([phrases(chart, 0), phrases(chart, 1)]).toEqual([["A ×3", "B ×1"], ["A ×2", "C ×1"]]);
  });

  it("gives song bars with no score bar no letter", () => {
    expect(phrases(chartOf([1, null, null, 1]))).toEqual(["A ×1", "– ×2", "A ×1"]);
  });
});

describe("figureChart: phrases", () => {
  it("groups a phrase of bars that repeats back to back", () => {
    expect(phrases(chartOf([1, 3, 1, 3, 1, 3]))).toEqual(["A B ×3"]);
  });

  it("keeps one bar repeating as one bar, not a longer phrase", () => {
    expect(phrases(chartOf([1, 1, 1, 1, 1, 1, 1, 1]))).toEqual(["A ×8"]);
  });

  it("leaves bars that don't fit a repeat on their own", () => {
    expect(phrases(chartOf([1, 3, 1, 3, 4]))).toEqual(["A B ×2", "C ×1"]);
  });

  it("prefers the phrase that covers the most bars", () => {
    expect(phrases(chartOf([1, 1, 3, 1, 1, 3]))).toEqual(["A A B ×2"]);
  });

  it("groups up to four bars: E E E F, four times", () => {
    const solo = Array.from({ length: 4 }, () => [1, 1, 1, 3]).flat();
    expect(phrases(chartOf(solo))).toEqual(["A A A B ×4"]);
  });

  it("records where each run starts, and its bars", () => {
    const run = chartOf([4], [1, 3, 1, 3]).sections[1].runs[0];
    expect([run.songBar, run.startBeat, run.barBeats, run.scoreBars]).toEqual([2, 4, [4, 4], [1, 3]]);
  });
});

describe("figureChart: what to draw", () => {
  it("draws each letter the first time its section plays it", () => {
    const chart = chartOf([1, 3, 1, 3, 4, 1]);
    expect(chart.sections[0].runs.map((r) => r.draw)).toEqual([[true, true], [true], [false]]);
  });

  it("draws a letter once inside a phrase that repeats it", () => {
    expect(chartOf([1, 1, 3, 1, 1, 3]).sections[0].runs[0].draw).toEqual([true, false, true]);
  });

  it("draws again in the next section, so each section's line reads on its own", () => {
    const chart = chartOf([1, 1], [1, 1]);
    expect(chart.sections.map((s) => s.runs[0].draw)).toEqual([[true], [true]]);
  });
});

describe("figureLetter", () => {
  it("goes A to Z, then AA, AB and on", () => {
    expect([0, 25, 26, 27, 52].map(figureLetter)).toEqual(["A", "Z", "AA", "AB", "BA"]);
  });
});

describe("unrepeatedSections", () => {
  it("finds the sections of two or more bars where no bar repeats", () => {
    // A riff that repeats, a solo that doesn't, a one-bar hit, and a rest that has no score.
    const chart = chartOf([1, 3, 1, 3], [4, 6, 7, 3], [4], [null, null]);
    expect(unrepeatedSections(chart)).toEqual([1]);
  });

  it("doesn't count a section that comes back to a bar, however late", () => {
    expect(unrepeatedSections(chartOf([3, 4, 6, 3]))).toEqual([]);
  });
});
