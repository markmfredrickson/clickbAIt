import { describe, it, expect } from "vitest";
import { barDifference, beatsDiffer, checkSameAs, nearRepeats, questionGroup, sameAsBars } from "../../src/charts/near-repeats.js";
import { figureChart } from "../../src/charts/figures.js";
import { songSections, type MappedBar } from "../../src/charts/bar-map.js";

/**
 * A part from its score bars, section by section, 4/4 throughout. Score bar
 * N plays SIGS[N - 1], four quarter-note beats:
 *   1  the riff          2  the riff, last beat changed   3  the riff, two beats changed
 *   4  the answer        5  the riff, three beats changed 6  something else entirely
 *   7, 8  the riff again (other score bars playing the same)
 *   9  a rest bar        10  one hit, then rests      11  the riff, first beat changed
 */
const SIGS = [
  "4[40] 4[43] 4[45] 4[40]",
  "4[40] 4[43] 4[45] 4[47]",
  "4[40] 4[43] 4[50] 4[52]",
  "4[38] 4[38] 4[38] 4[38]",
  "4[40] 4[50] 4[52] 4[55]",
  "4[60] 4[62] 4[64] 4[65]",
  "4[40] 4[43] 4[45] 4[40]",
  "4[40] 4[43] 4[45] 4[40]",
  "4r[] 4r[] 4r[] 4r[]",
  "4[36] 4r[] 4r[] 4r[]",
  "4[41] 4[43] 4[45] 4[40]",
];
function bars(...sections: (number | null)[][]) {
  const placed = songSections(sections.map((b, i) => ({ name: `S${i}`, bars: b.length })), [4, 4]);
  const mapped: MappedBar[] = [];
  sections.forEach((scoreBars, section) =>
    scoreBars.forEach((scoreBar) => mapped.push({ songBar: mapped.length + 1, section, startBeat: mapped.length * 4, beats: 4, scoreBar })),
  );
  return { placed, mapped };
}
const questionsFor = (sections: (number | null)[][], opts: { distinct?: number[] } = {}) => {
  const { placed, mapped } = bars(...sections);
  return nearRepeats(mapped, SIGS, placed, opts);
};

describe("beatsDiffer", () => {
  it("is 0 for bars that play the same", () => {
    expect(beatsDiffer(SIGS[0], SIGS[0])).toBe(0);
  });

  it("counts the beats that changed", () => {
    expect(beatsDiffer(SIGS[0], SIGS[1])).toBe(1);
    expect(beatsDiffer(SIGS[0], SIGS[2])).toBe(2);
  });

  it("counts a changed rhythm beat by beat: two eighths in place of a quarter is two beats", () => {
    expect(beatsDiffer("4[40] 4[43] 4[45] 4[40]", "4[40] 4[43] 8[45] 8[45] 4[40]")).toBe(2);
  });

  it("compares every voice", () => {
    expect(beatsDiffer("4[40] 4[43] | 2[30]", "4[40] 4[43] | 2[31]")).toBe(1);
  });
});

describe("barDifference", () => {
  it("leaves out a voice that only rests in both bars", () => {
    expect(barDifference("1[36,49] | 4r[]", "1[36,41,49] | 4r[]")).toEqual({ differ: 1, of: 1 });
  });

  it("counts a voice that plays in either bar", () => {
    expect(barDifference("4[40] 4[43] | 4r[]", "4[40] 4[43] | 4[30]")).toEqual({ differ: 1, of: 3 });
  });
});

describe("nearRepeats", () => {
  it("asks about a bar that blocks a repeat, saying what counting it the same gains", () => {
    // The riff three times, then its variant: [1]×3 [2] could be [1]×4.
    const qs = questionsFor([[1, 1, 1, 2]]);
    expect(qs).toEqual([
      { scoreBar: 2, like: 1, differ: 1, of: 4, section: 0, before: "[1]×3 [2]", after: "[1]×4" },
    ]);
  });

  it("finds the variant inside a longer run", () => {
    // Riff and answer four times, the last riff varied.
    const qs = questionsFor([[1, 4, 1, 4, 1, 4, 2, 4]]);
    expect(qs.map((q) => [q.scoreBar, q.like, q.before, q.after])).toEqual([[2, 1, "[1 4]×3 [2 4]", "[1 4]×4"]]);
  });

  it("doesn't ask when counting the bar the same removes nothing", () => {
    // Four bars played once: snapping 2 to 1 still leaves four bars to draw.
    expect(questionsFor([[1, 2, 4, 6]])).toEqual([]);
  });

  it("weighs a bar everywhere the song plays it", () => {
    // Bar 2 ends the riff in both sections, so counting it as 1 helps twice;
    // it's asked once, about the first section it helps.
    const qs = questionsFor([[1, 1, 1, 2], [1, 1, 1, 2]]);
    expect(qs.map((q) => [q.scoreBar, q.section])).toEqual([[2, 0]]);
  });

  it("asks about the bar played less often, not the one it's like", () => {
    // Bar 1 plays three times, bar 2 once: only bar 2 is asked about.
    expect(questionsFor([[1, 1, 1, 2]]).map((q) => q.scoreBar)).toEqual([2]);
  });

  it("counts how often a bar plays by what it plays, not its score bar number", () => {
    // Bars 1, 7 and 8 all play the riff, so the riff plays three times and bar 2 once.
    expect(questionsFor([[2, 1, 7, 8]]).map((q) => [q.scoreBar, q.like, q.after])).toEqual([[2, 1, "[1]×4"]]);
  });

  it("names the bar it's like from the same section", () => {
    // Bar 7 plays the riff, first played as bar 1 in another section.
    expect(questionsFor([[1, 4], [7, 7, 7, 2]]).map((q) => [q.scoreBar, q.like, q.after])).toEqual([[2, 7, "[7]×4"]]);
  });

  it("never counts a bar that plays as like a rest bar, or the other way round", () => {
    // One hit, then three rests: one beat from a rest bar, but playing or not is never noise.
    expect(questionsFor([[9, 9, 9, 10]])).toEqual([]);
  });

  it("doesn't ask about bars that differ in half their beats or more: those are different bars", () => {
    // Bar 3 changes two of the riff's four beats, bar 5 three.
    expect(questionsFor([[1, 1, 1, 3]])).toEqual([]);
    expect(questionsFor([[1, 1, 1, 5]])).toEqual([]);
  });

  it("asks only when counting the bar the same extends a repeat already there", () => {
    // [1 2] [4]×2 would become [1]×2 [4]×2: shorter, but a new repeat, not a longer one.
    expect(questionsFor([[1, 2, 4, 4]])).toEqual([]);
  });

  it("asks nothing about a bar already answered as distinct", () => {
    expect(questionsFor([[1, 1, 1, 2]], { distinct: [2] })).toEqual([]);
  });

  it("asks nothing about sections drawn as scores", () => {
    const { placed, mapped } = bars([1, 1, 1, 2]);
    expect(nearRepeats(mapped, SIGS, placed, { asScore: [0] })).toEqual([]);
  });

  it("orders questions by the song's bars", () => {
    const qs = questionsFor([[1, 1, 1, 11], [4, 4, 4, 1, 1, 1, 2]]);
    expect(qs.map((q) => q.scoreBar)).toEqual([11, 2]);
  });
});

describe("questionGroup", () => {
  it("groups questions by how much the bars differ", () => {
    const q = (differ: number) => ({ scoreBar: 1, like: 2, differ, of: 8, section: 0, before: "", after: "" });
    expect([1, 2, 3, 4].map((d) => questionGroup(q(d)))).toEqual([
      "1 beat different",
      "2 beats different",
      "3 or more beats different",
      "3 or more beats different",
    ]);
  });
});

describe("sameAs", () => {
  it("draws and counts a bar as the bar it's the same as", () => {
    const { placed, mapped } = bars([1, 1, 1, 2]);
    const chart = figureChart(sameAsBars(mapped, { "2": 1 }), SIGS, placed);
    expect(chart.sections[0].runs.map((r) => [r.scoreBars, r.count])).toEqual([[[1], 4]]);
  });

  it("leaves the bars alone without answers", () => {
    const { mapped } = bars([1, 1, 1, 2]);
    expect(sameAsBars(mapped, {})).toEqual(mapped);
  });
});

describe("checkSameAs", () => {
  const { mapped } = bars([1, 1, 1, 2], [4, 4]);

  it("accepts answers about bars the part plays", () => {
    expect(checkSameAs(mapped, SIGS.length, { "2": 1 }, [4])).toEqual([]);
  });

  it("reports a bar past the end of the score", () => {
    expect(checkSameAs(mapped, SIGS.length, { "19": 1 }, [22])).toEqual([
      "sameAs: the score has no bar 19",
      "distinct: the score has no bar 22",
    ]);
  });

  it("reports a bar answered both ways", () => {
    expect(checkSameAs(mapped, SIGS.length, { "2": 1 }, [2])).toEqual(["bar 2 is in both sameAs and distinct"]);
  });

  it("reports a chain: the bar it's the same as must not be in sameAs itself", () => {
    expect(checkSameAs(mapped, SIGS.length, { "2": 1, "1": 4 }, [])).toContain("sameAs: bar 2 is the same as bar 1, which is itself the same as bar 4");
  });

  it("reports a bar the part doesn't play", () => {
    expect(checkSameAs(mapped, SIGS.length, { "2": 6 }, [])).toEqual(["sameAs: bar 2 is the same as bar 6, which this part doesn't play"]);
  });

  it("reports bars of different lengths", () => {
    const mixed = mapped.map((b) => (b.scoreBar === 4 ? { ...b, beats: 3 } : b));
    expect(checkSameAs(mixed, SIGS.length, { "2": 4 }, [])).toEqual(["sameAs: bar 2 has 4 beats, but bar 4 has 3"]);
  });
});
