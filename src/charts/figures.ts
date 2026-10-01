/**
 * A part written as a chart: each distinct bar gets a letter, and each
 * section reads as runs of phrases ("A ×7", "(A B) ×4"). A phrase is up to
 * four bars that repeat back to back. The first time a section plays a
 * letter, a display draws its notation there, so every section's line reads
 * on its own; later in the same section the letter is enough. Bars are
 * compared exactly (see ScoreInfo.signatures), so two bars share a letter
 * only when they play the same thing.
 */

import type { MappedBar, SongSection } from "./bar-map.js";

export interface FigureRun {
  /** The phrase's letters, one per bar, or null for a song bar the score has nothing for. */
  letters: (string | null)[];
  /** The score bar behind each bar of the phrase. */
  scoreBars: (number | null)[];
  /** Beats in each bar of the phrase. */
  barBeats: number[];
  /** Which of the phrase's bars to draw: a letter's first time in its section. */
  draw: boolean[];
  /** Times through the phrase. */
  count: number;
  /** 1-based song bar the run starts on. */
  songBar: number;
  startBeat: number;
}

export interface FigureChart {
  /** Each letter and the score bar that shows it (where it's first played). */
  figures: { letter: string; scoreBar: number }[];
  /** One entry per song section, in order. */
  sections: { section: number; runs: FigureRun[] }[];
}

/** The longest phrase grouped. */
const MAX_PHRASE = 4;

/** 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB", … */
export function figureLetter(n: number): string {
  let s = "";
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

interface Bar {
  letter: string | null;
  scoreBar: number | null;
  beats: number;
  songBar: number;
  startBeat: number;
}

export function figureChart(
  bars: readonly MappedBar[],
  signatures: readonly string[],
  sections: readonly SongSection[],
): FigureChart {
  const letterOf = new Map<string, string>();
  const figures: FigureChart["figures"] = [];
  const bySection: Bar[][] = sections.map(() => []);
  for (const bar of bars) {
    let letter: string | null = null;
    if (bar.scoreBar !== null) {
      const sig = signatures[bar.scoreBar - 1] ?? `bar ${bar.scoreBar}`;
      if (!letterOf.has(sig)) {
        letterOf.set(sig, figureLetter(letterOf.size));
        figures.push({ letter: letterOf.get(sig)!, scoreBar: bar.scoreBar });
      }
      letter = letterOf.get(sig)!;
    }
    bySection[bar.section].push({ letter, scoreBar: bar.scoreBar, beats: bar.beats, songBar: bar.songBar, startBeat: bar.startBeat });
  }
  return { figures, sections: bySection.map((list, section) => ({ section, runs: runsOf(list) })) };
}

/** Two bars are the same for repeating when they have the same letter and length. */
const same = (a: Bar, b: Bar) => a.letter === b.letter && a.beats === b.beats;

/**
 * A section's bars as runs. From each bar, the phrase taken is the one whose
 * back-to-back repeats cover the most bars, the shortest on a tie (so eight
 * A's are "A ×8", not "(A A) ×4"); a phrase longer than a bar must repeat.
 */
function runsOf(bars: readonly Bar[]): FigureRun[] {
  const runs: FigureRun[] = [];
  const drawn = new Set<string>();
  let i = 0;
  while (i < bars.length) {
    let best = { length: 1, count: 1 };
    for (let p = 1; p <= MAX_PHRASE && i + p <= bars.length; p++) {
      let count = 1;
      const repeats = (k: number) => i + (k + 1) * p <= bars.length && bars.slice(i + k * p, i + (k + 1) * p).every((b, j) => same(b, bars[i + j]));
      while (repeats(count)) count++;
      if ((p === 1 || count > 1) && p * count > best.length * best.count) best = { length: p, count };
    }
    const phrase = bars.slice(i, i + best.length);
    const draw = phrase.map((b) => {
      if (b.letter === null || drawn.has(b.letter)) return false;
      drawn.add(b.letter);
      return true;
    });
    runs.push({
      letters: phrase.map((b) => b.letter),
      scoreBars: phrase.map((b) => b.scoreBar),
      barBeats: phrase.map((b) => b.beats),
      draw,
      count: best.count,
      songBar: phrase[0].songBar,
      startBeat: phrase[0].startBeat,
    });
    i += best.length * best.count;
  }
  return runs;
}

/**
 * The sections that read better as a score than as figures: two or more
 * bars, all with notation, none repeated (a solo), where letters would only
 * be "B C D E F…", each drawn anyway.
 */
export function unrepeatedSections(chart: FigureChart): number[] {
  return chart.sections.flatMap(({ section, runs }) => {
    const letters = runs.flatMap((r) => Array.from({ length: r.count }, () => r.letters).flat());
    const unrepeated = letters.length >= 2 && letters.every((l) => l !== null) && new Set(letters).size === letters.length;
    return unrepeated ? [section] : [];
  });
}
