/**
 * A part written as a chart: each distinct bar gets a letter, and each
 * section reads as runs of letters ("A ×7, B"). The first time a section
 * plays a letter, a display draws its notation there, so every section's
 * line reads on its own; later in the same section the letter is enough. Bars are compared exactly (see ScoreInfo.signatures), so two bars
 * share a letter only when they play the same thing.
 */

import type { MappedBar, SongSection } from "./bar-map.js";

export interface GrooveRun {
  /** The bar's letter, or null for song bars the score has nothing for. */
  letter: string | null;
  /** How many bars in a row play it. */
  count: number;
  /** 1-based song bar the run starts on. */
  songBar: number;
  startBeat: number;
  /** Beats in each bar of the run. */
  beats: number;
  /** True on the run where this letter is first played in its section. */
  first: boolean;
}

export interface GrooveChart {
  /** Each letter and the score bar that shows it (where it's first played). */
  grooves: { letter: string; scoreBar: number }[];
  /** One entry per song section, in order. */
  sections: { section: number; runs: GrooveRun[] }[];
}

/** 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB", … */
export function grooveLetter(n: number): string {
  let s = "";
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

export function grooveChart(
  bars: readonly MappedBar[],
  signatures: readonly string[],
  sections: readonly SongSection[],
): GrooveChart {
  const letterOf = new Map<string, string>();
  const grooves: GrooveChart["grooves"] = [];
  const seen = sections.map(() => new Set<string>()); // letters drawn, per section
  const out: GrooveChart["sections"] = sections.map((_, section) => ({ section, runs: [] }));

  for (const bar of bars) {
    let letter: string | null = null;
    if (bar.scoreBar !== null) {
      const sig = signatures[bar.scoreBar - 1] ?? `bar ${bar.scoreBar}`;
      if (!letterOf.has(sig)) {
        letterOf.set(sig, grooveLetter(letterOf.size));
        grooves.push({ letter: letterOf.get(sig)!, scoreBar: bar.scoreBar });
      }
      letter = letterOf.get(sig)!;
    }
    const runs = out[bar.section].runs;
    const last = runs[runs.length - 1];
    if (last && last.letter === letter && last.beats === bar.beats) {
      last.count++;
      continue;
    }
    const drawn = seen[bar.section];
    const first = letter !== null && !drawn.has(letter);
    if (letter !== null) drawn.add(letter);
    runs.push({ letter, count: 1, songBar: bar.songBar, startBeat: bar.startBeat, beats: bar.beats, first });
  }
  return { grooves, sections: out };
}

/** The run playing at `beat` and which of its bars (1-based), or null outside the part. */
export function runAt(chart: GrooveChart, beat: number): { section: number; run: number; bar: number } | null {
  for (const s of chart.sections) {
    for (let r = 0; r < s.runs.length; r++) {
      const run = s.runs[r];
      const into = beat - run.startBeat;
      if (into >= 0 && into < run.count * run.beats) {
        return { section: s.section, run: r, bar: Math.floor(into / run.beats) + 1 };
      }
    }
  }
  return null;
}
