import { describe, it, expect } from "vitest";
import { loadScore, scoreLayout, type ScoreLayout } from "../../src/charts/score-info.js";
import { draftSections } from "../../src/charts/score-draft.js";

const tex = (body: string) => loadScore(new TextEncoder().encode(body), "t.atex");
const GUITAR = (bars: string) => `\\tempo 120\n\\track "Gtr"\n\\staff {tabs}\n${bars}`;

describe("scoreLayout", () => {
  it("lists written bars in play order, expanding repeats and alternate endings", () => {
    // 1 |: 2 | 3 |1. 4 :| 2. 5 | 6
    const score = tex(GUITAR("0.6.1 | \\ro 0.6.1 | 0.6.1 | \\ae 1 \\rc 2 0.6.1 | \\ae 2 0.6.1 | 0.6.1"));
    expect(scoreLayout(score).playOrder).toEqual([1, 2, 3, 4, 2, 3, 5, 6]);
  });

  it("marks bars where every track rests", () => {
    const score = tex(GUITAR("r.1 | r.1 | 0.6.1 | r.4 0.6.4 r.2"));
    expect(scoreLayout(score).silent).toEqual([true, true, false, false]);
  });

  it("reads markers and meters per written bar", () => {
    const score = tex(GUITAR('\\section "Intro" 0.6.1 | \\ts 3 4 \\section "Verse" 0.6.2.'));
    const layout = scoreLayout(score);
    expect(layout.markers).toEqual([{ bar: 1, text: "Intro" }, { bar: 2, text: "Verse" }]);
    expect(layout.meters).toEqual([[4, 4], [3, 4]]);
  });
});

/** A layout with every bar in 4/4, played once in order, none silent. */
function layout(bars: number, markers: [number, string][], extra: Partial<ScoreLayout> = {}): ScoreLayout {
  return {
    playOrder: Array.from({ length: bars }, (_, i) => i + 1),
    markers: markers.map(([bar, text]) => ({ bar, text })),
    meters: Array.from({ length: bars }, () => [4, 4] as [number, number]),
    silent: Array.from({ length: bars }, () => false),
    ...extra,
  };
}

describe("draftSections", () => {
  it("takes section boundaries from the markers in play order", () => {
    // Verse (bars 3-4) is written once and played twice.
    const l = layout(6, [[1, "Intro"], [3, "Verse"], [5, "Outro"]], { playOrder: [1, 2, 3, 4, 3, 4, 5, 6] });
    const { sections } = draftSections(l);
    expect(sections.map((s) => [s.name, s.bars, s.scoreBars])).toEqual([
      ["Intro", 2, [1, 2]],
      ["Verse", 2, [3, 4]],
      ["Verse", 2, [3, 4]],
      ["Outro", 2, [5, 6]],
    ]);
  });

  it("starts a new section each time a marker is played again", () => {
    const l = layout(4, [[1, "Intro"], [3, "Chorus"]], { playOrder: [1, 2, 3, 4, 3, 4] });
    expect(draftSections(l).sections.map((s) => [s.name, s.bars])).toEqual([
      ["Intro", 2],
      ["Chorus", 2],
      ["Chorus", 2],
    ]);
  });

  it("asks when a section jumps across the score", () => {
    // A coda jump: the last chorus plays bars 3-4, then jumps to 7-8.
    const l = layout(8, [[1, "Verse"], [3, "Chorus"]], { playOrder: [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 7, 8] });
    const { decisions } = draftSections(l);
    expect(decisions.join("\n")).toMatch(/Chorus plays score bars 3–4, 7–8/);
  });

  it("names the stretch before the first marker Intro", () => {
    const l = layout(6, [[3, "Verse"]]);
    expect(draftSections(l).sections.map((s) => [s.name, s.bars])).toEqual([
      ["Intro", 2],
      ["Verse", 4],
    ]);
  });

  it("drops leading count-in bars that only rest, and reports them", () => {
    const silent = [true, true, false, false, false, false];
    const { sections, countInBars, decisions } = draftSections(layout(6, [[3, "Intro"]], { silent }));
    expect(countInBars).toBe(2);
    expect(sections.map((s) => [s.name, s.bars, s.scoreBars])).toEqual([["Intro", 4, [3, 6]]]);
    expect(decisions.join("\n")).toMatch(/count-in/);
  });

  it("keeps silent bars inside the song", () => {
    const silent = [false, true, false, false];
    const { sections, countInBars } = draftSections(layout(4, [[1, "Intro"]], { silent }));
    expect(countInBars).toBe(0);
    expect(sections[0].bars).toBe(4);
  });

  it("uses the lyric section names when their number and order match", () => {
    const l = layout(8, [[1, "A"], [3, "B"], [5, "C"], [7, "D"]]);
    const { sections, decisions } = draftSections(l, { lyricSections: ["Intro", "Verse 1", "Chorus", "Outro"] });
    expect(sections.map((s) => s.name)).toEqual(["Intro", "Verse 1", "Chorus", "Outro"]);
    expect(decisions).toEqual([]);
  });

  it("keeps the marker names and asks when the lyric sections don't line up", () => {
    const l = layout(8, [[1, "A"], [3, "B"], [5, "C"], [7, "D"]]);
    const { sections, decisions } = draftSections(l, { lyricSections: ["Verse 1", "Chorus", "Outro"] });
    expect(sections.map((s) => s.name)).toEqual(["A", "B", "C", "D"]);
    expect(decisions.join("\n")).toMatch(/4 score sections.*3 lyric sections/);
  });

  it("without markers, gives one section and says every boundary needs a person", () => {
    const { sections, decisions } = draftSections(layout(10, []));
    expect(sections.map((s) => [s.name, s.bars])).toEqual([["Song", 10]]);
    expect(decisions.join("\n")).toMatch(/no section markers/);
  });

  it("sets a section's meter when it differs from the song's", () => {
    const meters: [number, number][] = [[4, 4], [4, 4], [3, 4], [3, 4], [4, 4], [4, 4]];
    const { sections, timeSignature } = draftSections(layout(6, [[1, "A"], [3, "B"], [5, "C"]], { meters }));
    expect(timeSignature).toEqual([4, 4]);
    expect(sections.map((s) => s.timeSignature)).toEqual([undefined, [3, 4], undefined]);
  });

  it("asks when one section mixes meters", () => {
    const meters: [number, number][] = [[4, 4], [2, 4], [4, 4], [4, 4]];
    const { decisions } = draftSections(layout(4, [[1, "A"]], { meters }));
    expect(decisions.join("\n")).toMatch(/A.*mixes meters/);
  });

  it("asks when the score and the recording disagree by more than a bar", () => {
    const l = layout(10, [[1, "Intro"]]); // 40 beats
    expect(draftSections(l, { detectedBeats: 42 }).decisions).toEqual([]);
    expect(draftSections(l, { detectedBeats: 48 }).decisions.join("\n")).toMatch(/40 beats.*48/);
  });
});
