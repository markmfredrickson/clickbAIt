/**
 * A part written as a chart of snippets: a few short passages, each named
 * with a letter, that the song is written in ("A ×8 B", "C ×2 B"). A snippet
 * is up to four bars and is drawn, so a player learns it; the chart is the
 * snippets in order, so a player reads it. The snippets are the set that
 * keeps both short: the fewest bars drawn plus symbols read, where a
 * snippet's back-to-back repeats are one symbol ("A ×8"), and a bar in two
 * snippets is drawn twice. The first time a section plays a snippet, a
 * display draws it there, so every section's line reads on its own.
 *
 * Bars are compared exactly (see ScoreInfo.signatures), so two bars are the
 * same only when they play the same thing. Sections drawn as scores (a solo)
 * are left out: they're drawn bar by bar, so their bars aren't snippets.
 */

import type { MappedBar, SongSection } from "./bar-map.js";

export interface Snippet {
  letter: string;
  /** Its bars, as the score bars where the song first plays it. */
  scoreBars: number[];
  barBeats: number[];
  /** Nothing but rests (nothing to remember how to play). */
  rest: boolean;
}

export interface FigureRun {
  /** The snippet's letter, or null for song bars the score has nothing for. */
  letter: string | null;
  /** The score bars behind each bar of the snippet here (null where none). */
  scoreBars: (number | null)[];
  /** Beats in each bar of the snippet. */
  barBeats: number[];
  /** Draw it here: the first time its section plays it. */
  draw: boolean;
  /** Times through, back to back. */
  count: number;
  /** 1-based song bar the run starts on. */
  songBar: number;
  startBeat: number;
}

export interface FigureChart {
  snippets: Snippet[];
  /** One entry per song section, in order; a section drawn as a score has no runs. */
  sections: { section: number; runs: FigureRun[] }[];
}

/** The longest snippet, in bars. */
const MAX_SNIPPET = 4;

/** 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB", … */
export function figureLetter(n: number): string {
  let s = "";
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

interface Bar {
  /** What the bar plays and how long it is; null where the score has nothing. */
  key: string | null;
  scoreBar: number | null;
  beats: number;
  songBar: number;
  startBeat: number;
}

/** A bar's signature, or "bar N" when the file gives none: bars are the same only when they play the same. */
const signatureOf = (signatures: readonly string[], scoreBar: number) => signatures[scoreBar - 1] ?? `bar ${scoreBar}`;

/** A signature with no notes in it: every beat a rest. */
const isRest = (sig: string) => !/\[[^\]]/.test(sig);

function sectionBars(bars: readonly MappedBar[], signatures: readonly string[], count: number): Bar[][] {
  const out: Bar[][] = Array.from({ length: count }, () => []);
  for (const b of bars) {
    const key = b.scoreBar === null ? null : `${signatureOf(signatures, b.scoreBar)}|${b.beats}`;
    out[b.section].push({ key, scoreBar: b.scoreBar, beats: b.beats, songBar: b.songBar, startBeat: b.startBeat });
  }
  return out;
}

/**
 * The sections of two or more bars, all with notation, in which no bar
 * repeats (a solo): they read better as a score than as snippets.
 */
export function unrepeatedSections(bars: readonly MappedBar[], signatures: readonly string[], sections: readonly SongSection[]): number[] {
  return sectionBars(bars, signatures, sections.length).flatMap((list, section) => {
    const keys = list.map((b) => b.key);
    return keys.length >= 2 && keys.every((k) => k !== null) && new Set(keys).size === keys.length ? [section] : [];
  });
}

/** A snippet while choosing: its bars' keys, joined. */
type Candidate = string;
const SEP = "\u0001";

/** How a section is written with a set of snippets: each step a snippet (or a gap) and its count. */
interface Step {
  /** The snippet's keys, or null for bars with no score. */
  snippet: Candidate | null;
  length: number;
  count: number;
}

/**
 * The fewest symbols to write a section's bars with `set`: a dynamic program
 * over where each symbol starts, a symbol being a snippet played one or more
 * times back to back, or a stretch of bars with no score.
 */
function write(keys: readonly (string | null)[], set: ReadonlySet<Candidate>, lengths: readonly number[]): Step[] {
  const n = keys.length;
  const best: number[] = new Array(n + 1).fill(Infinity);
  const step: (Step | null)[] = new Array(n + 1).fill(null);
  best[n] = 0;
  const at = (i: number, len: number) => keys.slice(i, i + len).join(SEP);
  for (let i = n - 1; i >= 0; i--) {
    if (keys[i] === null) {
      let j = i;
      while (j < n && keys[j] === null) j++;
      best[i] = 1 + best[j];
      step[i] = { snippet: null, length: 1, count: j - i };
      continue;
    }
    // Longer snippets first, so a tie keeps the bigger unit.
    for (const len of lengths) {
      if (i + len > n || keys.slice(i, i + len).includes(null)) continue;
      const s = at(i, len);
      if (!set.has(s)) continue;
      let count = 1;
      while (i + (count + 1) * len <= n && at(i + count * len, len) === s) count++;
      for (let k = count; k >= 1; k--) {
        const cost = 1 + best[i + k * len];
        if (cost < best[i]) {
          best[i] = cost;
          step[i] = { snippet: s, length: len, count: k };
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

/** The total to minimize for a set: bars drawn (of the snippets used) plus symbols read. */
function costOf(sections: readonly (string | null)[][], set: ReadonlySet<Candidate>, lengths: readonly number[]): number {
  let symbols = 0;
  const used = new Set<Candidate>();
  for (const keys of sections) {
    for (const s of write(keys, set, lengths)) {
      symbols++;
      if (s.snippet !== null) used.add(s.snippet);
    }
  }
  let drawn = 0;
  for (const s of used) drawn += s.split(SEP).length;
  return drawn + symbols;
}

/**
 * Choose the snippets: start from single bars (every bar must be writable),
 * add the candidate that lowers the total most until none does, then drop
 * any whose removal lowers it. A candidate of two or more bars is a sequence
 * the part plays at least twice: a snippet is something that comes back.
 */
function chooseSnippets(sections: readonly (string | null)[][]): Set<Candidate> {
  const occurrences = new Map<Candidate, number>();
  const set = new Set<Candidate>();
  for (const keys of sections) {
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === null) continue;
      set.add(keys[i]!);
      for (let len = 2; len <= MAX_SNIPPET && i + len <= keys.length; len++) {
        const run = keys.slice(i, i + len);
        if (run.includes(null)) break;
        const s = run.join(SEP);
        occurrences.set(s, (occurrences.get(s) ?? 0) + 1);
      }
    }
  }
  const candidates = [...occurrences].filter(([, n]) => n >= 2).map(([s]) => s);
  const lengths = Array.from({ length: MAX_SNIPPET }, (_, i) => MAX_SNIPPET - i);
  let cost = costOf(sections, set, lengths);
  for (;;) {
    let bestAdd: Candidate | null = null;
    let bestCost = cost;
    for (const c of candidates) {
      if (set.has(c)) continue;
      set.add(c);
      const next = costOf(sections, set, lengths);
      set.delete(c);
      if (next < bestCost) {
        bestCost = next;
        bestAdd = c;
      }
    }
    if (bestAdd === null) break;
    set.add(bestAdd);
    cost = bestCost;
    // Drop what the new snippet made pointless.
    for (const s of [...set]) {
      if (!s.includes(SEP)) continue;
      set.delete(s);
      const without = costOf(sections, set, lengths);
      if (without <= cost) cost = without;
      else set.add(s);
    }
  }
  return set;
}

export function figureChart(
  bars: readonly MappedBar[],
  signatures: readonly string[],
  sections: readonly SongSection[],
  opts: { asScore?: readonly number[] } = {},
): FigureChart {
  const asScore = new Set(opts.asScore ?? []);
  const bySection = sectionBars(bars, signatures, sections.length);
  const keysOf = bySection.map((list, section) => (asScore.has(section) ? [] : list.map((b) => b.key)));
  const set = chooseSnippets(keysOf);
  const lengths = Array.from({ length: MAX_SNIPPET }, (_, i) => MAX_SNIPPET - i);

  const letterOf = new Map<Candidate, string>();
  const snippets: Snippet[] = [];
  const out = bySection.map((list, section) => {
    const runs: FigureRun[] = [];
    const drawn = new Set<Candidate>();
    let i = 0;
    for (const s of write(keysOf[section], set, lengths)) {
      const first = list[i];
      const bars = list.slice(i, i + s.length);
      if (s.snippet !== null && !letterOf.has(s.snippet)) {
        letterOf.set(s.snippet, figureLetter(letterOf.size));
        snippets.push({
          letter: letterOf.get(s.snippet)!,
          scoreBars: bars.map((b) => b.scoreBar!),
          barBeats: bars.map((b) => b.beats),
          rest: bars.every((b) => isRest(signatureOf(signatures, b.scoreBar!))),
        });
      }
      const draw = s.snippet !== null && !drawn.has(s.snippet);
      if (s.snippet !== null) drawn.add(s.snippet);
      runs.push({
        letter: s.snippet === null ? null : letterOf.get(s.snippet)!,
        scoreBars: bars.map((b) => b.scoreBar),
        barBeats: bars.map((b) => b.beats),
        draw,
        count: s.count,
        songBar: first.songBar,
        startBeat: first.startBeat,
      });
      i += s.length * s.count;
    }
    return { section, runs };
  });
  return { snippets, sections: out };
}
