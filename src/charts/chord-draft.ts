/**
 * Drafting a song's chord file from a chord sheet.
 *
 * The sheet's chords are placed on the beat grid (see chord-sheet.ts), then
 * written as a `.lab` in source-recording seconds with Harte labels. Each
 * chord lasts until the next one starts; the last lasts to the end of the
 * song. The `.lab` is the authored file from then on: a person nudges it
 * against the recording, so drafting never replaces one that exists.
 */

import { existsSync, writeFileSync } from "node:fs";
import type { SongSection } from "./bar-map.js";
import { toHarte } from "./chord-label.js";
import { placeChords } from "./chord-sheet.js";
import { sourceTime, type ChordTiming } from "./chord-timeline.js";
import { writeLab } from "./lab.js";

export function draftLab(
  sheet: string,
  song: { sections: readonly SongSection[]; words: readonly { text: string; startBeat: number }[] },
  timing: ChordTiming,
  opts: { comment: string },
): { text?: string; errors: string[] } {
  const { chords, errors } = placeChords(sheet, song);
  if (errors.length > 0) return { errors };

  const last = song.sections[song.sections.length - 1];
  const songEnd = last ? last.startBeat + last.barBeats.reduce((sum, b) => sum + b, 0) : 0;
  const segments = chords.flatMap((c, i) => {
    const start = sourceTime(c.beat, timing);
    if (start === null) {
      errors.push(`line ${c.line}: "${c.chord}" at beat ${c.beat} plays no audio (silence, or past the last clip)`);
      return [];
    }
    // Just before the next chord, so the end stays in this chord's clip.
    const endBeat = (chords[i + 1]?.beat ?? songEnd) - 1e-6;
    const end = sourceTime(endBeat, timing);
    return [{ start, end: end === null || end < start ? start : end, label: toHarte(c.chord) }];
  });
  if (errors.length > 0) return { errors };
  return { text: writeLab(segments, { comment: opts.comment }), errors };
}

/** Writes a file that must not exist yet, unless `force` says to replace it. */
export function writeNewFile(path: string, text: string, opts: { force?: boolean } = {}): void {
  if (existsSync(path) && !opts.force) {
    throw new Error(`${path} already exists; it may hold edits. Delete it, or force, to draft it again.`);
  }
  writeFileSync(path, text);
}
