/**
 * Near-repeats: bars that almost repeat the bar beside them. A transcription
 * writes down one performance, so a bar the player varied by a note, or the
 * transcriber got slightly wrong, breaks a run that would otherwise be one
 * repeat ("[1]×3 [2]" where "[1]×4" was meant). Whether the difference is
 * meant is the person's call, never the build's, so each one becomes a
 * question, and the answers live in the manifest's chart entry:
 *
 *   "sameAs": { "13": 9 }   bar 13 is the same as bar 9: draw and count it as 9
 *   "distinct": [13]        bar 13 really is different: stop asking
 *
 * A question is asked only when counting the bar the same would extend a
 * repeat already there ("[1 4]×3 [2 4]" → "[1 4]×4"), and only about the bar the
 * part plays less often (counted by what a bar plays, not its number). Bars
 * that differ in half their beats or more are different bars, not
 * near-repeats, and are never asked about; neither is a rest bar against a
 * bar that plays, since playing or not is never noise. The score file
 * is never changed, and a bar with no answer is compared exactly.
 */

import type { MappedBar, SongSection } from "./bar-map.js";
import { barKey, signatureOf, write } from "./figures.js";

export interface NearRepeat {
  /** The score bar asked about. */
  scoreBar: number;
  /** The score bar it's like. */
  like: number;
  /** Beats that differ, and beats in the bar (the longer of the two). */
  differ: number;
  of: number;
  /** The first section (by index) where counting it the same helps, and its runs there before and after. */
  section: number;
  before: string;
  after: string;
}

/** A signature's voices, each a list of its beats. */
const voicesOf = (sig: string) => sig.split(" | ").map((voice) => voice.split(" ").filter(Boolean));

/** A beat with no notes: a rest. */
const isRestBeat = (beat: string) => !/\[[^\]]/.test(beat);

/** How many beats differ between two bar signatures: the edits that turn one bar's beats into the other's. */
export function beatsDiffer(a: string, b: string): number {
  return editDistance(tagged(voicesOf(a)), tagged(voicesOf(b)));
}

/** Each beat tagged with its voice, so a beat never matches one in another voice. */
const tagged = (voices: string[][]) => voices.flatMap((beats, v) => beats.map((beat) => `${v}:${beat}`));

/**
 * How two bars differ: the beats that differ, and the beats in the bar (the
 * longer of the two), leaving out any voice that only rests in both bars (a
 * score's empty second voice).
 */
export function barDifference(a: string, b: string): { differ: number; of: number } {
  const va = voicesOf(a);
  const vb = voicesOf(b);
  const keep = (v: number) => !((va[v] ?? []).every(isRestBeat) && (vb[v] ?? []).every(isRestBeat));
  const x = tagged(va.map((beats, v) => (keep(v) ? beats : [])));
  const y = tagged(vb.map((beats, v) => (keep(v) ? beats : [])));
  return { differ: editDistance(x, y), of: Math.max(x.length, y.length) };
}

function editDistance(x: readonly string[], y: readonly string[]): number {
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[y.length];
}

/** The heading a question is listed under. */
export function questionGroup(q: NearRepeat): string {
  if (q.differ === 1) return "1 beat different";
  if (q.differ === 2) return "2 beats different";
  return "3 or more beats different";
}

/** A part's bars with the sameAs answers applied: each answered bar replaced by the bar it's the same as. */
export function sameAsBars(bars: readonly MappedBar[], sameAs: Readonly<Record<string, number>>): MappedBar[] {
  return bars.map((b) => {
    const to = b.scoreBar === null ? undefined : sameAs[String(b.scoreBar)];
    return to === undefined ? b : { ...b, scoreBar: to };
  });
}

/** Problems with a chart's answers: bars the score doesn't have, a bar answered both ways, chains, and lengths. */
export function checkSameAs(
  bars: readonly MappedBar[],
  scoreBars: number,
  sameAs: Readonly<Record<string, number>>,
  distinct: readonly number[],
): string[] {
  const errors: string[] = [];
  const inScore = (n: number) => Number.isInteger(n) && n >= 1 && n <= scoreBars;
  const beatsOf = (n: number) => bars.find((b) => b.scoreBar === n)?.beats;
  for (const [key, to] of Object.entries(sameAs)) {
    const from = Number(key);
    const missing = [from, to].filter((n) => !inScore(n));
    if (missing.length) {
      errors.push(...missing.map((n) => `sameAs: the score has no bar ${n}`));
      continue;
    }
    if (sameAs[String(to)] !== undefined) {
      errors.push(`sameAs: bar ${from} is the same as bar ${to}, which is itself the same as bar ${sameAs[String(to)]}`);
      continue;
    }
    const toBeats = beatsOf(to);
    if (toBeats === undefined) {
      errors.push(`sameAs: bar ${from} is the same as bar ${to}, which this part doesn't play`);
      continue;
    }
    const fromBeats = beatsOf(from);
    if (fromBeats !== undefined && fromBeats !== toBeats) errors.push(`sameAs: bar ${from} has ${fromBeats} beats, but bar ${to} has ${toBeats}`);
  }
  for (const n of distinct) {
    if (!inScore(n)) errors.push(`distinct: the score has no bar ${n}`);
    else if (sameAs[String(n)] !== undefined) errors.push(`bar ${n} is in both sameAs and distinct`);
  }
  return errors;
}

/** One section's bars as their runs would be written: cost (bars drawn plus runs read), the runs, and as text ("[1 4]×3 [2 4]"). */
function written(list: readonly MappedBar[], signatures: readonly string[], swap?: { from: number; to: number }) {
  const barOf = (b: MappedBar) => (b.scoreBar !== null && swap && b.scoreBar === swap.from ? swap.to : b.scoreBar);
  const keys = list.map((b) => {
    const bar = barOf(b);
    return bar === null ? null : barKey(signatures, bar, b.beats);
  });
  let cost = 0;
  const runs: { bars: string; count: number }[] = [];
  let i = 0;
  for (const s of write(keys)) {
    const gap = keys[i] === null;
    cost += gap ? 1 : s.length + 1;
    const once = gap ? ["–"] : list.slice(i, i + s.length).map((b) => String(barOf(b)));
    runs.push({ bars: once.join(" "), count: s.count });
    i += s.length * s.count;
  }
  return { cost, runs, text: runs.map((r) => `[${r.bars}]${r.count > 1 ? `×${r.count}` : ""}`).join(" ") };
}

/** Whether a repeat in `before` (a run played twice or more) is played more times in `after`. */
const extendsRepeat = (before: readonly { bars: string; count: number }[], after: readonly { bars: string; count: number }[]) =>
  before.some((r) => r.count >= 2 && after.some((a) => a.bars === r.bars && a.count > r.count));

/**
 * The questions for a chart-style part: for each bar the part plays, the bar
 * in the same section it's most worth counting it the same as, if counting
 * it so makes the chart shorter. Bars already answered (pass the part's
 * bars with sameAs applied) and bars in `distinct` aren't asked about.
 */
export function nearRepeats(
  bars: readonly MappedBar[],
  signatures: readonly string[],
  sections: readonly SongSection[],
  opts: { asScore?: readonly number[]; distinct?: readonly number[] } = {},
): NearRepeat[] {
  const asScore = new Set(opts.asScore ?? []);
  const distinct = new Set(opts.distinct ?? []);
  const bySection: MappedBar[][] = sections.map(() => []);
  for (const b of bars) if (!asScore.has(b.section)) bySection[b.section].push(b);

  // How often each thing a bar plays is played, and the first score bar that plays it.
  const keyOf = (b: MappedBar) => barKey(signatures, b.scoreBar!, b.beats);
  const plays = new Map<string, number>();
  const firstOf = new Map<string, number>();
  const firstSongBar = new Map<number, number>();
  const sectionsOf = new Map<number, Set<number>>();
  bySection.forEach((list, section) => {
    for (const b of list) {
      if (b.scoreBar === null) continue;
      const key = keyOf(b);
      plays.set(key, (plays.get(key) ?? 0) + 1);
      if (!firstOf.has(key)) firstOf.set(key, b.scoreBar);
      if (!firstSongBar.has(b.scoreBar)) firstSongBar.set(b.scoreBar, b.songBar);
      if (!sectionsOf.has(b.scoreBar)) sectionsOf.set(b.scoreBar, new Set());
      sectionsOf.get(b.scoreBar)!.add(section);
    }
  });
  const now = bySection.map((list) => written(list, signatures));
  const sig = (n: number) => signatureOf(signatures, n);

  const questions: NearRepeat[] = [];
  for (const [from, inSections] of sectionsOf) {
    if (distinct.has(from)) continue;
    let best: { q: NearRepeat; gain: number } | null = null;
    // The bars it could be like: in a section with it, as long, played more
    // often (or as often and first played earlier), each named by the first
    // score bar in the section that plays it.
    const likes = new Set<number>();
    for (const section of inSections) {
      const self = bySection[section].find((b) => b.scoreBar === from)!;
      const own = keyOf(self);
      for (const b of bySection[section]) {
        if (b.scoreBar === null || b.beats !== self.beats) continue;
        const key = keyOf(b);
        if (key === own) continue;
        const more = plays.get(key)! - plays.get(own)!;
        if (more > 0 || (more === 0 && firstOf.get(key)! < firstOf.get(own)!)) likes.add(bySection[section].find((c) => c.scoreBar !== null && keyOf(c) === key)!.scoreBar!);
      }
    }
    const rests = (n: number) => voicesOf(sig(n)).every((beats) => beats.every(isRestBeat));
    for (const like of likes) {
      if (rests(like) !== rests(from)) continue;
      const { differ, of } = barDifference(sig(from), sig(like));
      if (differ * 2 >= of) continue;
      let gain = 0;
      let first: { section: number; before: string; after: string } | null = null;
      for (const section of [...inSections].sort((a, b) => a - b)) {
        const after = written(bySection[section], signatures, { from, to: like });
        const saved = now[section].cost - after.cost;
        gain += saved;
        if (saved > 0 && !first && extendsRepeat(now[section].runs, after.runs)) first = { section, before: now[section].text, after: after.text };
      }
      if (gain <= 0 || !first) continue;
      const better = !best || gain > best.gain || (gain === best.gain && (differ < best.q.differ || (differ === best.q.differ && like < best.q.like)));
      if (better) best = { gain, q: { scoreBar: from, like, differ, of, ...first } };
    }
    if (best) questions.push(best.q);
  }
  return questions.sort((a, b) => firstSongBar.get(a.scoreBar)! - firstSongBar.get(b.scoreBar)!);
}
