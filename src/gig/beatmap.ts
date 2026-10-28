/**
 * Where the show track's beats fell in what the band played.
 *
 * The show track keys every lyric word to a beat, exactly. The live
 * recording has its own beats, found by the beat tracker. Pairing the live
 * aligned words with the show track's words gives anchors: show beat b was
 * sung at live time t, which is live beat k. On the click, k − b (the shift)
 * stays the same from word to word. Where the band repeated or skipped
 * something, the shift jumps and then holds again; each stretch where it holds
 * is a piece. Inside a piece, any show beat has a live time, so captions and
 * cut points come from the show track's exact timing.
 */

export interface LiveWord {
  text: string;
  start: number;
  end: number;
}

export interface ShowWord {
  text: string;
  startBeat: number;
  endBeat: number;
}

/** Show beats in [fromBeat, toBeat] are live beat b + shift. The first and last pieces reach out to the song's ends. */
export interface Piece {
  fromBeat: number;
  toBeat: number;
  shift: number;
  /** The show beats of the piece's first and last anchors. */
  firstAnchor: number;
  lastAnchor: number;
}

/** A live word longer than this was stretched over silence by the aligner, and anchors nothing. */
const STRETCHED_S = 2;
/** The shift may wander this many beats inside a piece. */
const SHIFT_TOLERANCE = 0.5;
/** A piece needs this many anchors. */
const MIN_ANCHORS = 4;
/** Anchors per side in the running median that smooths out single bad words. */
const SMOOTH = 2;

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Pairs [live index, show index] of the same words in the same order (a longest common subsequence). */
export function pairWords(live: { text: string }[], show: { text: string }[]): [number, number][] {
  const a = live.map((w) => norm(w.text));
  const b = show.map((w) => norm(w.text));
  const dp = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** A time as a fractional count of live beats. Outside the grid, the nearest beats' spacing carries on. */
export function beatIndex(beats: number[], t: number): number {
  const n = beats.length;
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - beats[lo]) / (beats[hi] - beats[lo]);
}

/** The time of a fractional live beat count: the inverse of `beatIndex`. */
export function beatTime(beats: number[], k: number): number {
  const n = beats.length;
  if (k <= 0) return beats[0] + k * (beats[1] - beats[0]);
  if (k >= n - 1) return beats[n - 1] + (k - (n - 1)) * (beats[n - 1] - beats[n - 2]);
  const i = Math.floor(k);
  return beats[i] + (k - i) * (beats[i + 1] - beats[i]);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** The pieces of the song where the band held one shift from the show track. */
export function liveBeatMap(beats: number[], live: LiveWord[], show: ShowWord[]): { pieces: Piece[] } {
  const anchors = pairWords(live, show)
    .filter(([i]) => live[i].end - live[i].start < STRETCHED_S)
    .map(([i, j]) => ({ beat: show[j].startBeat, shift: beatIndex(beats, live[i].start) - show[j].startBeat }));
  const smooth = anchors.map((_, i) => median(anchors.slice(Math.max(0, i - SMOOTH), i + SMOOTH + 1).map((a) => a.shift)));

  // A piece runs while the smoothed shift stays near the piece's own median.
  const runs: (typeof anchors)[] = [];
  let run: typeof anchors = [];
  let runSmooth: number[] = [];
  anchors.forEach((a, i) => {
    if (run.length && Math.abs(smooth[i] - median(runSmooth)) > SHIFT_TOLERANCE) {
      runs.push(run);
      run = [];
      runSmooth = [];
    }
    run.push(a);
    runSmooth.push(smooth[i]);
  });
  if (run.length) runs.push(run);

  const pieces = runs
    .filter((r) => r.length >= MIN_ANCHORS)
    .map((r) => {
      const shift = median(r.map((a) => a.shift));
      const kept = r.filter((a) => Math.abs(a.shift - shift) <= SHIFT_TOLERANCE);
      const firstAnchor = kept[0].beat;
      const lastAnchor = kept[kept.length - 1].beat;
      return { fromBeat: firstAnchor, toBeat: lastAnchor, shift, firstAnchor, lastAnchor };
    });
  if (pieces.length) {
    pieces[0].fromBeat = -Infinity;
    pieces[pieces.length - 1].toBeat = Infinity;
  }
  return { pieces };
}

/** The live time of a show beat, or null where no piece covers it. */
export function showToLive(beats: number[], pieces: Piece[], beat: number): number | null {
  const p = pieces.find((x) => beat >= x.fromBeat && beat <= x.toBeat);
  return p ? beatTime(beats, beat + p.shift) : null;
}

const ms = (t: number) => Math.round(t * 1000) / 1000;

/** The live words, each timed from the show track where a piece covers it, and as aligned elsewhere. */
export function mapWords(beats: number[], pieces: Piece[], live: LiveWord[], show: ShowWord[]): LiveWord[] {
  const out = live.map((w) => ({ ...w }));
  for (const [i, j] of pairWords(live, show)) {
    const start = showToLive(beats, pieces, show[j].startBeat);
    const end = showToLive(beats, pieces, show[j].endBeat);
    if (start !== null && end !== null) out[i] = { text: live[i].text, start: ms(start), end: ms(end) };
  }
  return out;
}
