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
  /**
   * Per track, one signature per bar: equal exactly when the bars play the
   * same thing (every beat's length, rests, and notes). Used to find a
   * part's repeated bars.
   */
  signatures: string[][];
}

function barSignature(bar: alphaTab.model.Bar): string {
  return bar.voices
    .map((v) =>
      v.beats
        .map((b) => {
          const notes = b.notes
            .map((n) => (n.isPercussion ? `p${n.percussionArticulation}` : String(n.realValue)))
            .sort()
            .join(",");
          return `${b.duration}${".".repeat(b.dots)}${b.tupletNumerator > 0 ? "t" + b.tupletNumerator : ""}${b.isRest ? "r" : ""}[${notes}]`;
        })
        .join(" "),
    )
    .join(" | ");
}

/** Read a score file (alphaTex by its name, anything else by its contents). */
export function loadScore(bytes: Uint8Array, fileName: string): alphaTab.model.Score {
  const settings = new alphaTab.Settings();
  let score: alphaTab.model.Score;
  if (/\.(atex|alphatex)$/i.test(fileName)) {
    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.initFromString(new TextDecoder().decode(bytes), settings);
    score = importer.readScore();
  } else {
    score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
  }
  fixDrumNotes(score);
  return score;
}

/**
 * Guitar Pro 5 stores a drum track's grace notes as fretted notes whose fret
 * is the drum's MIDI number, and alphaTab reads them that way, so a flam's
 * grace note draws far below the staff. Turn each back into its drum.
 */
export function fixDrumNotes(score: alphaTab.model.Score): void {
  for (const track of score.tracks) {
    const articulations = track.percussionArticulations;
    for (const staff of track.staves) {
      if (!staff.isPercussion) continue;
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            for (const note of beat.notes) {
              if (note.isPercussion || !note.isStringed) continue;
              // A track without its own articulation list names drums by MIDI number.
              const drum = articulations.length === 0 ? note.fret : articulations.findIndex((a) => a.outputMidiNumber === note.fret);
              if (drum < 0) continue;
              note.percussionArticulation = drum;
              note.fret = -1;
              note.string = -1;
            }
          }
        }
      }
    }
  }
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
    signatures: score.tracks.map((t) => t.staves[0].bars.map(barSignature)),
  };
}
