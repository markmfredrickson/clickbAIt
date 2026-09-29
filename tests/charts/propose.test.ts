import { describe, it, expect } from "vitest";
import { proposeLinks } from "../../src/charts/propose.js";
import type { ScoreInfo } from "../../src/charts/score-info.js";

const SECTIONS = [
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
];

// Seven Nation Army's transcription: markers on every one of our boundaries,
// under different names, and no bar for our closing Hit.
const SCORE: ScoreInfo = {
  bars: 116,
  tracks: [{ name: "Rhythm Guitar", kind: "tab" }],
  markers: [
    { bar: 1, text: "Intro" },
    { bar: 9, text: "Verse I" },
    { bar: 27, text: "Chorus I" },
    { bar: 37, text: "Interlude I" },
    { bar: 45, text: "Verse II" },
    { bar: 63, text: "Chorus II (Solo)" },
    { bar: 81, text: "Interlude II" },
    { bar: 89, text: "Verse III" },
    { bar: 107, text: "Chorus III" },
    { bar: 115, text: "Outro" },
  ],
};

describe("proposeLinks", () => {
  it("links each section whose boundaries match a marker exactly, per occurrence", () => {
    const { links } = proposeLinks(SECTIONS, SCORE);
    expect(links).toHaveLength(10);
    expect(links[0]).toEqual({ section: "Riff", occurrence: 1, bars: [1, 8], scoreMarker: "Intro" });
    expect(links[4]).toEqual({ section: "Verse", occurrence: 2, bars: [45, 62], scoreMarker: "Verse II" });
    expect(links[9]).toEqual({ section: "End", occurrence: 1, bars: [115, 116], scoreMarker: "Outro" });
  });

  it("puts a section with no score bars on the decision list instead of linking it", () => {
    const { links, decisions } = proposeLinks(SECTIONS, SCORE);
    expect(links.find((l) => l.section === "Hit")).toBeUndefined();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatch(/Hit.*117/);
  });

  it("does not link a section whose start has no marker", () => {
    const score = { ...SCORE, markers: SCORE.markers.filter((m) => m.bar !== 45) };
    const { links, decisions } = proposeLinks(SECTIONS, score);
    expect(links.find((l) => l.section === "Verse" && l.occurrence === 2)).toBeUndefined();
    // The Riff before it now runs into the unmarked verse, so it can't be
    // matched either: its end isn't a boundary in the score.
    expect(links.find((l) => l.section === "Riff" && l.occurrence === 2)).toBeUndefined();
    expect(decisions.join("\n")).toMatch(/Verse \(2nd\).*45/);
  });

  it("reports a marker that falls inside one of our sections", () => {
    const score = { ...SCORE, markers: [...SCORE.markers, { bar: 18, text: "Pre-Chorus" }].sort((a, b) => a.bar - b.bar) };
    const { links, decisions } = proposeLinks(SECTIONS, score);
    expect(links.find((l) => l.section === "Verse" && l.occurrence === 1)).toBeUndefined();
    expect(decisions.join("\n")).toMatch(/Pre-Chorus.*18.*Verse \(1st\)/);
  });

  it("proposes nothing when the score has no markers", () => {
    const { links, decisions } = proposeLinks(SECTIONS, { ...SCORE, markers: [] });
    expect(links).toEqual([]);
    expect(decisions.join("\n")).toMatch(/no section markers/);
  });
});
