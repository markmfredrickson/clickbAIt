/**
 * Where to cut a song's video. The talk before the first sung word and after
 * the last (Whisper's words, grouped into phrases at pauses) is what a person
 * or Claude reads to choose `in` and `out` in gig.json; the rest of this file
 * checks the choice and applies it to the captions.
 */

import type { Cut } from "./gig.js";
import type { CaptionLine } from "./srt.js";
import { toVideoTime, type Sync } from "./timeline.js";

export interface Aligned {
  words: { text: string; startMs: number; endMs: number }[];
  lines: { text: string; wordRange: [number, number] }[];
}

/** A stretch of the vocal, in its own seconds. */
export interface Window {
  start: number;
  end: number;
}

/** The vocal before the first sung word (head) and after the last (tail). `seconds` is the vocal's length. */
export function edgeWindows(aligned: Aligned, seconds: number): { head: Window; tail: Window } {
  const sung = aligned.lines.flatMap((l) => aligned.words.slice(l.wordRange[0], l.wordRange[1]));
  if (sung.length === 0) throw new Error("no aligned words to cut around");
  const first = Math.min(...sung.map((w) => w.startMs)) / 1000;
  const last = Math.max(...sung.map((w) => w.endMs)) / 1000;
  return { head: { start: 0, end: first }, tail: { start: last, end: seconds } };
}

export interface Phrase {
  /** Video seconds. */
  start: number;
  end: number;
  text: string;
}

/** A pause this long starts a new phrase. */
const PAUSE_S = 0.7;

/**
 * Whisper's words for a window (milliseconds from the window's start) as
 * phrases on the video's timeline. Words that spill past the window are left out.
 */
export function edgePhrases(heard: { text: string; startMs: number; endMs: number }[], window: Window, sync: Sync | null): Phrase[] {
  const round = (s: number) => Math.round(s * 1000) / 1000;
  const phrases: Phrase[] = [];
  for (const w of heard) {
    const start = window.start + w.startMs / 1000;
    const end = window.start + w.endMs / 1000;
    if (start < window.start || end > window.end) continue;
    const word = { start: round(toVideoTime(start, sync)), end: round(toVideoTime(end, sync)), text: w.text };
    const last = phrases[phrases.length - 1];
    if (last && word.start - last.end < PAUSE_S) {
      last.end = word.end;
      last.text = `${last.text} ${word.text}`;
    } else phrases.push(word);
  }
  return phrases;
}

/** Throws unless the cut keeps every sung word (lines on the video's timeline). */
export function checkCut(cut: Cut, lines: CaptionLine[]): void {
  const words = lines.flatMap((l) => l.words);
  if (words.length === 0) return;
  const first = Math.min(...words.map((w) => w.start));
  const last = Math.max(...words.map((w) => w.end));
  if (cut.in !== undefined && cut.in > first) throw new Error(`in (${cut.in}) cuts into the song, whose first sung word is at ${first}`);
  if (cut.out !== undefined && cut.out < last) throw new Error(`out (${cut.out}) cuts into the song, whose last sung word ends at ${last}`);
}

/** The lines on the cut video's timeline, leaving out any line wholly outside it. */
export function cutLines(lines: CaptionLine[], cut: Cut): CaptionLine[] {
  const from = cut.in ?? 0;
  const to = cut.out ?? Infinity;
  const shift = (s: number) => Math.round((s - from) * 1000) / 1000;
  return lines
    .filter((l) => l.words.length === 0 || (l.words[l.words.length - 1].end > from && l.words[0].start < to))
    .map((l) => (from === 0 ? l : { ...l, words: l.words.map((w) => ({ start: shift(w.start), end: shift(w.end) })) }));
}
