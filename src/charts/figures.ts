/**
 * A part written as a chart of runs: each section's bars, with back-to-back
 * repeats written once and counted ("[2 bars] ×8"). Every run is drawn, so a
 * player never reads a name in place of the music, and each section is
 * written on its own: the display follows the click, so showing a section's
 * bars every time it plays costs nothing. What the runs save is reading the
 * same bars again and again in a row.
 *
 * Bars are compared exactly (see ScoreInfo.signatures), so two bars are the
 * same only when they play the same thing. Sections drawn as scores (a solo)
 * are left out: they're drawn bar by bar.
 */

import type { MappedBar, SongSection } from "./bar-map.js";

export interface FigureRun {
  /** The score bars behind each bar of one time through (all null where the score has nothing). */
  scoreBars: (number | null)[];
  /** Beats in each bar of one time through. */
  barBeats: number[];
  /** Times through, back to back. */
  count: number;
  /** 1-based song bar the run starts on. */
  songBar: number;
  startBeat: number;
}

export interface FigureChart {
  /** One entry per song section, in order; a section drawn as a score has no runs. */
  sections: { section: number; runs: FigureRun[] }[];
}

/** The longest run, in bars of one time through. */
const MAX_RUN = 4;

interface Bar {
  /** What the bar plays and how long it is; null where the score has nothing. */
  key: string | null;
  scoreBar: number | null;
  beats: number;
  songBar: number;
  startBeat: number;
}

/** A bar's signature, or "bar N" when the file gives none: bars are the same only when they play the same. */
export const signatureOf = (signatures: readonly string[], scoreBar: number) => signatures[scoreBar - 1] ?? `bar ${scoreBar}`;

/**
 * What a bar plays and how long it is, as a key: bars with equal keys are the
 * same bar. Every bar of nothing but rests is the same, however its rests are
 * written.
 */
export function barKey(signatures: readonly string[], scoreBar: number, beats: number): string {
  const sig = signatureOf(signatures, scoreBar);
  return `${/\[[^\]]/.test(sig) ? sig : "rest"}|${beats}`;
}

function sectionBars(bars: readonly MappedBar[], signatures: readonly string[], count: number): Bar[][] {
  const out: Bar[][] = Array.from({ length: count }, () => []);
  for (const b of bars) {
    const key = b.scoreBar === null ? null : barKey(signatures, b.scoreBar, b.beats);
    out[b.section].push({ key, scoreBar: b.scoreBar, beats: b.beats, songBar: b.songBar, startBeat: b.startBeat });
  }
  return out;
}

/**
 * The sections of two or more bars, all with notation, in which no bar
 * repeats (a solo): they read better as a score than as runs.
 */
export function unrepeatedSections(bars: readonly MappedBar[], signatures: readonly string[], sections: readonly SongSection[]): number[] {
  return sectionBars(bars, signatures, sections.length).flatMap((list, section) => {
    const keys = list.map((b) => b.key);
    return keys.length >= 2 && keys.every((k) => k !== null) && new Set(keys).size === keys.length ? [section] : [];
  });
}

/** A run while choosing: how many bars one time through is, and how many times. */
export interface Step {
  length: number;
  count: number;
}

const SEP = "\u0001";

/**
 * The runs that write a section's bars shortest: a dynamic program over where
 * each run starts, minimizing the bars drawn plus the runs read. A run is up
 * to MAX_RUN bars played one or more times back to back, or a stretch of bars
 * with no score (nothing drawn). Between charts equally short, the one with
 * fewer runs over an odd number of bars wins: music comes in even phrases, so
 * "2 bars, [2 bars] ×3, 2 bars" reads truer than "3 bars, [2 bars] ×3, 1 bar".
 * After that, longer runs are tried first, so a tie keeps the bigger unit.
 */
export function write(keys: readonly (string | null)[]): Step[] {
  const n = keys.length;
  const best: number[] = new Array(n + 1).fill(Infinity);
  /** Runs over an odd number of bars in the best chart from each bar on. */
  const odd: number[] = new Array(n + 1).fill(0);
  const step: (Step | null)[] = new Array(n + 1).fill(null);
  best[n] = 0;
  const at = (i: number, len: number) => keys.slice(i, i + len).join(SEP);
  for (let i = n - 1; i >= 0; i--) {
    if (keys[i] === null) {
      let j = i;
      while (j < n && keys[j] === null) j++;
      best[i] = 1 + best[j];
      odd[i] = odd[j];
      step[i] = { length: 1, count: j - i };
      continue;
    }
    for (let len = Math.min(MAX_RUN, n - i); len >= 1; len--) {
      if (keys.slice(i, i + len).includes(null)) continue;
      const s = at(i, len);
      let count = 1;
      while (i + (count + 1) * len <= n && at(i + count * len, len) === s) count++;
      for (let k = count; k >= 1; k--) {
        const cost = len + 1 + best[i + k * len];
        const odds = ((len * k) % 2) + odd[i + k * len];
        if (cost < best[i] || (cost === best[i] && odds < odd[i])) {
          best[i] = cost;
          odd[i] = odds;
          step[i] = { length: len, count: k };
        }
      }
    }
  }
  const out: Step[] = [];
  for (let i = 0; i < n; ) {
    const s = step[i]!;
    out.push(s);
    i += s.length * s.count;
  }
  return out;
}

export function figureChart(
  bars: readonly MappedBar[],
  signatures: readonly string[],
  sections: readonly SongSection[],
  opts: { asScore?: readonly number[] } = {},
): FigureChart {
  const asScore = new Set(opts.asScore ?? []);
  const out = sectionBars(bars, signatures, sections.length).map((list, section) => {
    const runs: FigureRun[] = [];
    if (asScore.has(section)) return { section, runs };
    let i = 0;
    for (const s of write(list.map((b) => b.key))) {
      const first = list[i];
      const once = list.slice(i, i + s.length);
      runs.push({
        scoreBars: once.map((b) => b.scoreBar),
        barBeats: once.map((b) => b.beats),
        count: s.count,
        songBar: first.songBar,
        startBeat: first.startBeat,
      });
      i += s.length * s.count;
    }
    return { section, runs };
  });
  return { sections: out };
}
