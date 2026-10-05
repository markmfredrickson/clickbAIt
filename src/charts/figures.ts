/**
 * A part written as a chart: each section's bars in order, every one drawn
 * where it plays, with a phrase played back to back drawn once and counted
 * ("[groove] ×6"). Nothing is named and looked up elsewhere, so a player
 * reads each line as it comes. A phrase is up to four bars; bars between
 * phrases are drawn as passages of up to four bars, so a long one wraps
 * rather than shrinking.
 *
 * Bars are compared exactly (see ScoreInfo.signatures), so two bars are the
 * same only when they play the same thing. Sections drawn as scores (named
 * in the manifest) are left out: they're drawn bar by bar.
 */

import type { MappedBar, SongSection } from "./bar-map.js";

/** A phrase the part plays back to back, for the card's reminder of what it plays. */
export interface Phrase {
  /** Its bars, as the score bars where the song first plays it. */
  scoreBars: number[];
  barBeats: number[];
  /** Nothing but rests (nothing to remember how to play). */
  rest: boolean;
}

export interface FigureRun {
  /** The score bars behind each bar of the run (null where none). */
  scoreBars: (number | null)[];
  /** Beats in each bar of the run. */
  barBeats: number[];
  /** Drawn where it plays; false only for song bars the score has nothing for. */
  draw: boolean;
  /** Times through, back to back. */
  count: number;
  /** 1-based song bar the run starts on. */
  songBar: number;
  startBeat: number;
}

export interface FigureChart {
  /** Each phrase played back to back somewhere, once, in the order the song first plays it. */
  phrases: Phrase[];
  /** One entry per song section, in order; a section drawn as a score has no runs. */
  sections: { section: number; runs: FigureRun[] }[];
}

/** The longest phrase or passage, in bars. */
const MAX_BARS = 4;

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

/** How a section's bars are written: a phrase and its count, a single bar of a passage, or bars with no score. */
interface Step {
  kind: "repeat" | "bar" | "gap";
  length: number;
  count: number;
}

/**
 * Split a section's bars into phrases played back to back and the bars
 * between them, drawing as few bars as it can: a dynamic program over where
 * each step starts, a repeat costing its bars drawn plus one for its count.
 * A repeat must cost less than writing its bars out, so one bar played twice
 * stays in its passage; on a tie a longer phrase beats a shorter one.
 */
function split(keys: readonly (string | null)[]): Step[] {
  const n = keys.length;
  const best: number[] = new Array(n + 1).fill(Infinity);
  const step: (Step | null)[] = new Array(n + 1).fill(null);
  best[n] = 0;
  const at = (i: number, len: number) => keys.slice(i, i + len).join("\u0001");
  for (let i = n - 1; i >= 0; i--) {
    if (keys[i] === null) {
      let j = i;
      while (j < n && keys[j] === null) j++;
      best[i] = best[j];
      step[i] = { kind: "gap", length: 1, count: j - i };
      continue;
    }
    best[i] = 1 + best[i + 1];
    step[i] = { kind: "bar", length: 1, count: 1 };
    for (let len = MAX_BARS; len >= 1; len--) {
      if (i + 2 * len > n || keys.slice(i, i + len).includes(null)) continue;
      const phrase = at(i, len);
      let count = 1;
      while (i + (count + 1) * len <= n && at(i + count * len, len) === phrase) count++;
      for (let k = count; k >= 2; k--) {
        const cost = len + 1 + best[i + k * len];
        if (cost < best[i]) {
          best[i] = cost;
          step[i] = { kind: "repeat", length: len, count: k };
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
  const phrases: Phrase[] = [];
  const seen = new Set<string>();

  const out = sectionBars(bars, signatures, sections.length).map((list, section) => {
    const runs: FigureRun[] = [];
    if (asScore.has(section)) return { section, runs };
    let i = 0;
    let passage: FigureRun | null = null;
    for (const s of split(list.map((b) => b.key))) {
      const first = list[i];
      const these = list.slice(i, i + s.length);
      i += s.length * s.count;
      if (s.kind === "bar" && passage && passage.scoreBars.length < MAX_BARS) {
        passage.scoreBars.push(first.scoreBar);
        passage.barBeats.push(first.beats);
        continue;
      }
      const run: FigureRun = {
        scoreBars: these.map((b) => b.scoreBar),
        barBeats: these.map((b) => b.beats),
        draw: s.kind !== "gap",
        count: s.count,
        songBar: first.songBar,
        startBeat: first.startBeat,
      };
      runs.push(run);
      passage = s.kind === "bar" ? run : null;
      if (s.kind === "repeat") {
        const key = these.map((b) => b.key).join("\u0001");
        if (!seen.has(key)) {
          seen.add(key);
          phrases.push({
            scoreBars: these.map((b) => b.scoreBar!),
            barBeats: these.map((b) => b.beats),
            rest: these.every((b) => isRest(signatureOf(signatures, b.scoreBar!))),
          });
        }
      }
    }
    return { section, runs };
  });
  return { phrases, sections: out };
}
