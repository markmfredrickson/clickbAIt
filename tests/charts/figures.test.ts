import { describe, it, expect } from "vitest";
import { figureChart, figureLetter, unrepeatedSections } from "../../src/charts/figures.js";
import { songSections, type MappedBar } from "../../src/charts/bar-map.js";

/**
 * A part from its score bars, section by section, 4/4 throughout. A score
 * bar plays SIGS[bar - 1]: bars 1, 2 and 5 play the same; 9 is a rest.
 */
function bars(...sections: (number | null)[][]) {
  const placed = songSections(sections.map((b, i) => ({ name: `S${i}`, bars: b.length })), [4, 4]);
  const mapped: MappedBar[] = [];
  sections.forEach((scoreBars, section) =>
    scoreBars.forEach((scoreBar) => mapped.push({ songBar: mapped.length + 1, section, startBeat: mapped.length * 4, beats: 4, scoreBar })),
  );
  return { placed, mapped };
}
const SIGS = ["a[1]", "a[1]", "b[2]", "c[3]", "a[1]", "d[4]", "e[5]", "f[6]", "4r[]"];
function chartOf(...sections: (number | null)[][]) {
  const { placed, mapped } = bars(...sections);
  return figureChart(mapped, SIGS, placed);
}
/** A section's runs as "A ×8". */
const runs = (chart: ReturnType<typeof chartOf>, s = 0) => chart.sections[s].runs.map((r) => `${r.letter ?? "–"} ×${r.count}`);
/** Each snippet as its score bars. */
const snippets = (chart: ReturnType<typeof chartOf>) => chart.snippets.map((sn) => `${sn.letter}=${sn.scoreBars.join(",")}`);

// Seven Nation Army's bass by score bar: the riff 1 3 (four bars' worth of it
// and more), the verse ending 4 6, and the instrumental's variant 1 3 1 7.
const riff = [1, 3, 1, 3, 1, 3, 1, 3];
const verse = [...riff, ...riff, 4, 6];
const instrumental = [1, 3, 1, 7, 1, 3, 1, 7, 4, 6];
const bass = () => chartOf(riff, verse, instrumental, riff, verse, [1, 3, 1, 7, 1, 3, 1, 7, 1, 3, 1, 7, 1, 3, 1, 7, 4, 6]);

describe("figureChart: snippets", () => {
  it("picks the snippets that keep the drawing and the reading both short", () => {
    // The riff, the verse ending, and the riff's 4-bar variant: 8 bars drawn,
    // and every section a symbol or two.
    expect(snippets(bass())).toEqual(["A=1,3", "B=4,6", "C=1,3,1,7"]);
  });

  it("writes each section as its snippets, repeats counted", () => {
    const chart = bass();
    expect([runs(chart, 0), runs(chart, 1), runs(chart, 2)]).toEqual([["A ×4"], ["A ×8", "B ×1"], ["C ×2", "B ×1"]]);
  });

  it("names snippets A, B, C… in the order the song first plays them", () => {
    expect(chartOf([4, 6, 4, 6], [1, 3, 1, 3]).snippets.map((s) => s.letter)).toEqual(["A", "B"]);
  });

  it("keeps a bar played over and over a snippet of its own, counted", () => {
    expect(runs(chartOf([1, 1, 1, 1, 1, 1, 1, 1]))).toEqual(["A ×8"]);
    expect(snippets(chartOf([1, 1, 1, 1, 1, 1, 1, 1]))).toEqual(["A=1"]);
  });

  it("doesn't make a snippet of bars played together only once: a snippet is something that comes back", () => {
    expect(snippets(chartOf([3, 4, 6]))).toEqual(["A=3", "B=4", "C=6"]);
  });

  it("gives song bars with no score bar no letter", () => {
    expect(runs(chartOf([1, null, null, 1]))).toEqual(["A ×1", "– ×2", "A ×1"]);
  });

  it("marks a snippet of nothing but rests", () => {
    expect(chartOf([9, 9, 9, 9], [1, 1]).snippets.map((s) => [s.letter, s.rest])).toEqual([["A", true], ["B", false]]);
  });

  it("records where each run starts, and its bars", () => {
    const run = bass().sections[1].runs[1];
    expect([run.songBar, run.startBeat, run.scoreBars, run.barBeats]).toEqual([25, 96, [4, 6], [4, 4]]);
  });
});

describe("figureChart: what to draw", () => {
  it("draws a snippet the first time each section plays it", () => {
    const chart = chartOf([1, 3, 1, 3, 4, 4, 1, 3], [1, 3, 1, 3]);
    expect(chart.sections.map((s) => s.runs.map((r) => `${r.letter}${r.draw ? "*" : ""}`))).toEqual([["A*", "B*", "A"], ["A*"]]);
  });
});

describe("figureChart: sections drawn as scores", () => {
  it("leaves them out of the snippets, with no runs of their own", () => {
    const { placed, mapped } = bars([1, 3, 1, 3], [6, 7, 8, 4]);
    const chart = figureChart(mapped, SIGS, placed, { asScore: [1] });
    expect(snippets(chart)).toEqual(["A=1,3"]);
    expect(chart.sections[1].runs).toEqual([]);
  });
});

describe("unrepeatedSections", () => {
  it("finds the sections of two or more bars where no bar repeats", () => {
    // A riff that repeats, a solo that doesn't, a one-bar hit, and bars with no score.
    const { placed, mapped } = bars([1, 3, 1, 3], [4, 6, 7, 3], [4], [null, null]);
    expect(unrepeatedSections(mapped, SIGS, placed)).toEqual([1]);
  });

  it("doesn't count a section that comes back to a bar, however late", () => {
    const { placed, mapped } = bars([3, 4, 6, 3]);
    expect(unrepeatedSections(mapped, SIGS, placed)).toEqual([]);
  });
});

describe("figureLetter", () => {
  it("goes A to Z, then AA, AB and on", () => {
    expect([0, 25, 26, 27, 52].map(figureLetter)).toEqual(["A", "Z", "AA", "AB", "BA"]);
  });
});
