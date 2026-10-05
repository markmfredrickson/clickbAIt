import { describe, it, expect } from "vitest";
import { figureChart } from "../../src/charts/figures.js";
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
/** A section's runs as "[1,3] ×4", bars with no score as "– ×2". */
const runs = (chart: ReturnType<typeof chartOf>, s = 0) =>
  chart.sections[s].runs.map((r) => `${r.draw ? `[${r.scoreBars.join(",")}]` : "–"} ×${r.count}`);
/** Each repeated phrase as its score bars. */
const phrases = (chart: ReturnType<typeof chartOf>) => chart.phrases.map((p) => p.scoreBars.join(","));

// Seven Nation Army's bass by score bar: the riff 1 3 (four bars' worth of it
// and more), the verse ending 4 6, and the instrumental's variant 1 3 1 7.
const riff = [1, 3, 1, 3, 1, 3, 1, 3];
const verse = [...riff, ...riff, 4, 6];
const instrumental = [1, 3, 1, 7, 1, 3, 1, 7, 4, 6];
const bass = () => chartOf(riff, verse, instrumental, riff, verse, [1, 3, 1, 7, 1, 3, 1, 7, 1, 3, 1, 7, 1, 3, 1, 7, 4, 6]);

describe("figureChart", () => {
  it("writes each section as its bars in order, a phrase played back to back drawn once with its count", () => {
    const chart = bass();
    expect([runs(chart, 0), runs(chart, 1), runs(chart, 2)]).toEqual([
      ["[1,3] ×4"],
      ["[1,3] ×8", "[4,6] ×1"],
      ["[1,3,1,7] ×2", "[4,6] ×1"],
    ]);
  });

  it("writes a bar played over and over as that bar and its count", () => {
    expect(runs(chartOf([1, 1, 1, 1, 1, 1, 1, 1]))).toEqual(["[1] ×8"]);
  });

  it("counts bars that play the same thing as the same, whatever their score bar", () => {
    expect(runs(chartOf([1, 2, 5]))).toEqual(["[1] ×3"]);
  });

  it("leaves a bar played twice in its passage, where a count would save nothing", () => {
    expect(runs(chartOf([3, 4, 4, 6]))).toEqual(["[3,4,4,6] ×1"]);
    expect(runs(chartOf([3, 4, 4, 4, 6]))).toEqual(["[3] ×1", "[4] ×3", "[6] ×1"]);
  });

  it("draws bars that don't repeat back to back as passages of up to four bars", () => {
    expect(runs(chartOf([3, 4, 6, 7, 8, 4]))).toEqual(["[3,4,6,7] ×1", "[8,4] ×1"]);
  });

  it("draws every run where it plays, and nothing for song bars with no score bar", () => {
    expect(runs(chartOf([1, null, null, 1]))).toEqual(["[1] ×1", "– ×2", "[1] ×1"]);
    expect(bass().sections.every((s) => s.runs.every((r) => r.draw))).toBe(true);
  });

  it("lists the phrases the part repeats back to back, once each, in the order the song first plays them", () => {
    expect(phrases(bass())).toEqual(["1,3", "1,3,1,7"]);
  });

  it("marks a phrase of nothing but rests", () => {
    expect(chartOf([9, 9, 9, 9], [1, 1, 1]).phrases.map((p) => [p.scoreBars.join(","), p.rest])).toEqual([["9", true], ["1", false]]);
  });

  it("records where each run starts, and its bars", () => {
    const run = bass().sections[1].runs[1];
    expect([run.songBar, run.startBeat, run.scoreBars, run.barBeats]).toEqual([25, 96, [4, 6], [4, 4]]);
  });

  it("leaves sections drawn as scores with no runs, and out of the phrases", () => {
    const { placed, mapped } = bars([1, 3, 1, 3], [6, 6, 6, 6]);
    const chart = figureChart(mapped, SIGS, placed, { asScore: [1] });
    expect(phrases(chart)).toEqual(["1,3"]);
    expect(chart.sections[1].runs).toEqual([]);
  });
});
