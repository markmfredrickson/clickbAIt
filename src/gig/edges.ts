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

const NUMBERS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

/**
 * Whisper's words as text the aligner can time: it reads letters, so tokens
 * with none are dropped, except counts up to twenty, which are spelled out (a
 * count-in is worth keeping). Null when nothing is left.
 */
export function spokenText(words: { text: string }[]): string | null {
  const kept = words.flatMap((w) => {
    if (/\p{L}/u.test(w.text)) return [w.text];
    const n = w.text.replace(/[^\d]/g, "");
    return n !== "" && Number(n) <= 20 ? [NUMBERS[Number(n)]] : [];
  });
  return kept.length ? kept.join(" ") : null;
}

/** Seconds per level. */
export const STEP_S = 0.5;

/** RMS in dB for each `step` seconds of mono samples (a partial last step is left out). */
export function levels(samples: Float32Array, sampleRate: number, step = STEP_S): number[] {
  const n = Math.round(sampleRate * step);
  const out: number[] = [];
  for (let i = 0; i + n <= samples.length; i += n) {
    let sum = 0;
    for (let k = i; k < i + n; k++) sum += samples[k] * samples[k];
    out.push(10 * Math.log10(sum / n + 1e-12));
  }
  return out;
}

/** How far under the sung part's median level the band can drop and still count as playing. */
const MUSIC_DB = 20;
/** Gaps this short are bridged, and runs this short dropped. */
const MUSIC_MIN_S = 1;

/**
 * Where the band (the sound without the singer) is playing, from its levels:
 * within MUSIC_DB of its median level while singing (`sung`), with short gaps
 * filled and then short runs dropped.
 */
export function musicRuns(levels: number[], step: number, sung: Window): Window[] {
  const during = levels.slice(Math.round(sung.start / step), Math.round(sung.end / step)).sort((a, b) => a - b);
  const median = during[Math.floor(during.length / 2)];
  const runs: Window[] = [];
  levels.forEach((l, i) => {
    if (l < median - MUSIC_DB) return;
    const last = runs[runs.length - 1];
    const start = i * step;
    if (last && start - last.end < MUSIC_MIN_S) last.end = start + step;
    else runs.push({ start, end: start + step });
  });
  return runs.filter((r) => r.end - r.start >= MUSIC_MIN_S);
}

/**
 * The band's playing around the song: every run that overlaps the sung words,
 * so an intro or outro counts and a stray word misaligned into the quiet
 * doesn't. The words themselves if the band never plays under them.
 */
export function musicSpan(runs: Window[], firstWord: number, lastWord: number): Window {
  const under = runs.filter((r) => r.end > firstWord && r.start < lastWord);
  if (under.length === 0) return { start: firstWord, end: lastWord };
  return { start: under[0].start, end: under[under.length - 1].end };
}
