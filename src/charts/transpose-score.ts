/**
 * Move a score from the record's key to the key the band plays.
 *
 * Transcriptions are written in the record's key; a song transposed in the
 * manifest needs its tab in the played key, still playable on the same
 * instrument. Each fretted note moves by `steps` semitones and is re-fretted:
 *
 *   - on its own string when the new fret is between 0 and the top fret;
 *   - otherwise on the nearest string in the direction it moved (a note pushed
 *     under fret 0 goes to a lower string, one pushed past the top fret to a
 *     higher one), at the same pitch;
 *   - and when no string can hold it (below the lowest open string, or above
 *     the top fret of the highest), an octave back toward the instrument.
 *
 * Notes on a staff without strings (keys, horns) move by `steps` as written.
 * Drum tracks are left alone. Key signatures move with the notes, and chord
 * names are respelled for `key` (the key played; sharps when not given). A
 * chord diagram shifts with them when every fret still fits on the neck, and
 * is hidden otherwise: a new fingering is a musical choice, not arithmetic.
 */

import * as alphaTab from "@coderline/alphatab";
import { transposeChord } from "./chord-label.js";

const TOP_FRET = 24;

export function transposeScore(score: alphaTab.model.Score, steps: number, key = "C"): alphaTab.model.Score {
  if (steps === 0) return score;
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      if (staff.isPercussion) continue;
      for (const chord of staff.chords?.values() ?? []) transposeChordSymbol(chord, steps, key);
      // alphaTab lists tunings from the highest string down, and numbers strings from the lowest up.
      const open = (string: number) => staff.tuning[staff.tuning.length - string];
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            for (const note of beat.notes) {
              if (staff.tuning.length > 0 && note.isStringed) refret(note, open(note.string) + note.fret + steps, open, staff.tuning.length);
              else if (note.isPiano) {
                const pitch = note.octave * 12 + note.tone + steps;
                note.octave = Math.floor(pitch / 12);
                note.tone = ((pitch % 12) + 12) % 12;
              }
            }
          }
        }
      }
    }
  }
  for (const mb of score.masterBars) {
    // Each semitone up is seven steps round the circle of fifths.
    const k = (((mb.keySignature + 7 * steps) % 12) + 12) % 12;
    mb.keySignature = (k > 6 ? k - 12 : k) as alphaTab.model.KeySignature;
  }
  return score;
}

function transposeChordSymbol(chord: alphaTab.model.Chord, steps: number, key: string): void {
  if (chord.name) chord.name = transposeChord(chord.name, steps, key);
  // A negative fret marks a muted string; only the fretted ones move.
  if (chord.strings.some((f) => f >= 0 && (f + steps < 0 || f + steps > TOP_FRET))) {
    chord.showDiagram = false;
    return;
  }
  const shifted = chord.strings.map((f) => (f < 0 ? f : f + steps));
  chord.strings = shifted;
  const fretted = shifted.filter((f) => f > 0);
  chord.firstFret = fretted.length > 0 ? Math.max(1, Math.min(...fretted)) : 1;
}

/** Place `pitch` on the note's string, or the nearest string that can hold it. */
function refret(note: alphaTab.model.Note, pitch: number, open: (string: number) => number, strings: number): void {
  for (;;) {
    const order = [note.string];
    const fret = pitch - open(note.string);
    // Look toward the low strings for a note pushed under fret 0, toward the high ones otherwise.
    if (fret < 0) for (let s = note.string - 1; s >= 1; s--) order.push(s);
    else if (fret > TOP_FRET) for (let s = note.string + 1; s <= strings; s++) order.push(s);
    for (const s of order) {
      const f = pitch - open(s);
      if (f >= 0 && f <= TOP_FRET) {
        note.string = s;
        note.fret = f;
        return;
      }
    }
    pitch += fret < 0 ? 12 : -12;
  }
}
