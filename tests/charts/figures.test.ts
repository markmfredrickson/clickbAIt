import { describe, it, expect } from "vitest";
import { figureChart, unrepeatedSections } from "../../src/charts/figures.js";
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
/** A section's runs as "1,3 ×4": the score bars of one time through, and the count. */
const runs = (chart: ReturnType<typeof chartOf>, s = 0) =>
  chart.sections[s].runs.map((r) => `${r.scoreBars.every((b) => b === null) ? "–" : r.scoreBars.join(",")} ×${r.count}`);

// Seven Nation Army's bass by score bar: the riff 1 3 (four bars' worth of it
// and more), the verse ending 4 6, and the instrumental's variant 1 3 1 7.
const riff = [1, 3, 1, 3, 1, 3, 1, 3];
const verse = [...riff, ...riff, 4, 6];
const instrumental = [1, 3, 1, 7, 1, 3, 1, 7, 4, 6];
const bass = () => chartOf(riff, verse, instrumental);

describe("figureChart: runs", () => {
  it("writes a section's back-to-back repeats as one run, counted", () => {
    expect(runs(bass(), 0)).toEqual(["1,3 ×4"]);
    expect(runs(bass(), 2)).toEqual(["1,3,1,7 ×2", "4,6 ×1"]);
  });

  it("writes every section out in full, even when an earlier section played the same bars", () => {
    expect(runs(bass(), 1)).toEqual(["1,3 ×8", "4,6 ×1"]);
  });

  it("chooses each section's runs on its own, not to match another section's", () => {
    // Song-wide, the riff 1 3 would be reused: 3, then 1 3, then 1.
    expect(runs(chartOf([1, 3, 1, 3], [3, 1, 3, 1]), 1)).toEqual(["3,1 ×2"]);
  });

  it("keeps a bar played over and over a run of its own, counted", () => {
    expect(runs(chartOf([1, 1, 1, 1, 1, 1, 1, 1]))).toEqual(["1 ×8"]);
  });

  it("counts bars that play the same as repeats, whichever score bar they come from", () => {
    expect(runs(chartOf([1, 2, 5, 1]))).toEqual(["1 ×4"]);
  });

  it("doesn't count repeats that aren't back to back: every bar is written out", () => {
    const written = chartOf([1, 3, 4, 1, 3, 6]).sections[0].runs;
    expect(written.every((r) => r.count === 1)).toBe(true);
    expect(written.flatMap((r) => r.scoreBars)).toEqual([1, 3, 4, 1, 3, 6]);
  });

  it("groups bars played once into runs of at most four bars", () => {
    const written = chartOf([3, 4, 6, 7, 8]).sections[0].runs;
    expect(written.flatMap((r) => r.scoreBars)).toEqual([3, 4, 6, 7, 8]);
    expect(written.every((r) => r.scoreBars.length <= 4)).toBe(true);
  });

  it("gives song bars with no score bar a run of their own", () => {
    expect(runs(chartOf([1, null, null, 1]))).toEqual(["1 ×1", "– ×2", "1 ×1"]);
  });

  it("records where each run starts, and its bars", () => {
    const run = bass().sections[1].runs[1];
    expect([run.songBar, run.startBeat, run.scoreBars, run.barBeats]).toEqual([25, 96, [4, 6], [4, 4]]);
  });
});

describe("figureChart: sections drawn as scores", () => {
  it("gives them no runs", () => {
    const { placed, mapped } = bars([1, 3, 1, 3], [6, 7, 8, 4]);
    const chart = figureChart(mapped, SIGS, placed, { asScore: [1] });
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
