/**
 * The facts about a score file that the chart build needs: how many bars it
 * has, its tracks, and its section markers. Reading goes through alphaTab,
 * which handles Guitar Pro 3–7, MusicXML and its own alphaTex text format.
 *
 * Everything past this module works on ScoreInfo, not on alphaTab's model, so
 * mapping and proposing are testable with plain objects and the renderer can
 * change without touching them.
 */

import * as alphaTab from "@coderline/alphatab";

export type ScoreTrackKind = "tab" | "staff" | "drums";

export interface ScoreInfo {
  bars: number;
  tracks: { name: string; kind: ScoreTrackKind }[];
  /** Section markers, in bar order. `bar` is 1-based. */
  markers: { bar: number; text: string }[];
}

function loadScore(bytes: Uint8Array, fileName: string): alphaTab.model.Score {
  const settings = new alphaTab.Settings();
  if (/\.(atex|alphatex)$/i.test(fileName)) {
    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.initFromString(new TextDecoder().decode(bytes), settings);
    return importer.readScore();
  }
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
}

export function readScoreInfo(bytes: Uint8Array, fileName: string): ScoreInfo {
  let score: alphaTab.model.Score;
  try {
    score = loadScore(bytes, fileName);
  } catch (err) {
    throw new Error(`can't read score ${fileName}: ${(err as Error).message}`);
  }
  return {
    bars: score.masterBars.length,
    tracks: score.tracks.map((t) => {
      const staff = t.staves[0];
      const kind: ScoreTrackKind = staff.isPercussion ? "drums" : staff.showTablature ? "tab" : "staff";
      return { name: t.name, kind };
    }),
    markers: score.masterBars
      .filter((mb) => mb.section)
      .map((mb) => ({ bar: mb.index + 1, text: mb.section!.text || mb.section!.marker })),
  };
}
