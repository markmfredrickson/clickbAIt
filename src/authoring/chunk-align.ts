//! Global matcher for chunked alignment.
//!
//! Given the rough per-chunk Whisper transcripts (each heard word tagged with
//! its chunk) and the KNOWN published lyrics in order, decide which chunk each
//! published word belongs to. A single global sequence alignment does the work:
//! because it's monotonic over the whole song, the Nth occurrence of a repeated
//! line maps to the Nth time it was heard (its own chunk), not all to the first.
//! Chunks that transcribed to non-lyric noise ("(whistling)", bleed) match no
//! published word and simply get no lyrics assigned.
//!
//! wav2vec2 then force-aligns each chunk's assigned lyric span within that
//! chunk's bounded audio — no runway, no cross-occurrence latch.

export interface HeardWord {
  text: string;
  /** Index of the chunk this word was heard in. */
  chunk: number;
}

/** Normalize a word for matching: lowercase, keep only alphanumerics. Returns
 *  "" for pure punctuation / annotations like "(whistling)" -> "whistling"
 *  (non-empty but simply won't equal a lyric word). */
export function normWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const MATCH = 2;
const MISMATCH = -1;
const GAP = -1;

/**
 * Needleman–Wunsch global alignment of `published` against `heard` (normalized
 * words). Returns, for each published index, the heard index it EXACTLY matched,
 * or -1 (mismatch or gap). Only exact matches anchor; everything else is filled
 * from neighbors in {@link assignChunks}, which is robust to Whisper's errors.
 */
export function alignSequences(published: string[], heard: string[]): number[] {
  const n = published.length;
  const m = heard.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const tb: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0)); // 0 diag, 1 up, 2 left
  for (let i = 1; i <= n; i++) {
    dp[i][0] = i * GAP;
    tb[i][0] = 1;
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = j * GAP;
    tb[0][j] = 2;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const eq = published[i - 1] !== "" && published[i - 1] === heard[j - 1];
      const diag = dp[i - 1][j - 1] + (eq ? MATCH : MISMATCH);
      const up = dp[i - 1][j] + GAP; // published word unmatched
      const left = dp[i][j - 1] + GAP; // heard word unmatched
      let best = diag;
      let dir = 0;
      if (up > best) {
        best = up;
        dir = 1;
      }
      if (left > best) {
        best = left;
        dir = 2;
      }
      dp[i][j] = best;
      tb[i][j] = dir;
    }
  }
  const res = new Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const dir = tb[i][j];
    if (dir === 0) {
      if (published[i - 1] !== "" && published[i - 1] === heard[j - 1]) res[i - 1] = j - 1;
      i--;
      j--;
    } else if (dir === 1) {
      i--;
    } else {
      j--;
    }
  }
  return res;
}

/** A chunk's index and its audio duration (ms) — the capacity proxy: a longer
 *  chunk can hold more words, so unanchored words spread by duration weight. */
export interface ChunkDur {
  index: number;
  durationMs: number;
}

/**
 * Assign each published word to a chunk. Exact Whisper matches ANCHOR a word to
 * the chunk it was heard in. Runs of unanchored words (a misheard line) are then
 * DISTRIBUTED across the chunks between their bracketing anchors, weighted by
 * chunk duration — so a whole misheard line lands in the chunks that actually
 * span it in time, instead of being dumped on the previous anchor's chunk (which,
 * if short, then overflows: "target too long for audio" in wav2vec2). Returns a
 * chunk index per published word, or null only if NOTHING anchored at all.
 */
export function assignChunks(published: string[], heard: HeardWord[], chunks: ChunkDur[]): (number | null)[] {
  const p = published.map(normWord);
  const h = heard.map((w) => normWord(w.text));
  const aligned = alignSequences(p, h);
  const anchor: (number | null)[] = aligned.map((hi) => (hi >= 0 ? heard[hi].chunk : null));

  // Anchor-trust: a real sung line matches Whisper on SEVERAL words in a chunk.
  // A chunk with a single lone match — one common word hallucinated on
  // instrumental/bleed at high confidence — is a false anchor (it latches the
  // first/nearby lyric onto the wrong chunk). Trust a chunk's matches only if it
  // has >= 2 of them; otherwise drop them so those words are distributed instead.
  const perChunk = new Map<number, number>();
  for (const a of anchor) if (a !== null) perChunk.set(a, (perChunk.get(a) ?? 0) + 1);
  const trusted = anchor.map((a) => (a !== null && perChunk.get(a)! >= 2 ? a : null));

  const result: (number | null)[] = trusted.slice();
  const n = trusted.length;
  if (chunks.length === 0) return result;

  // Chunks in time order, with a chunk-index -> ordinal lookup and durations.
  const order = [...chunks].sort((a, b) => a.index - b.index);
  const ordOf = new Map(order.map((c, i) => [c.index, i]));
  const dur = order.map((c) => Math.max(1, c.durationMs));

  // Per-chunk capacity in WORDS (a chunk-second aligns at most ~this many words;
  // beyond it wav2vec2 errors "target too long"). Seed load with the anchored
  // words already placed so distribution + anchors together stay within capacity.
  const WORDS_PER_SEC = 5;
  const cap = (ord: number) => Math.max(1, Math.floor((dur[ord] / 1000) * WORDS_PER_SEC));
  const load = new Array(order.length).fill(0);
  for (const c of result) if (c !== null) load[ordOf.get(c)!]++;

  // Spread published words [lo, hi) across chunk ordinals [oLo, oHi] by duration,
  // but never past a chunk's capacity: an over-full chunk spills forward to the
  // next chunk with slack (extending past oHi to the last chunk if needed).
  const distribute = (lo: number, hi: number, oLo: number, oHi: number) => {
    const weights = dur.slice(oLo, oHi + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    const bounds: number[] = [];
    let acc = 0;
    for (const w of weights) {
      acc += w;
      bounds.push(acc / total);
    }
    const count = hi - lo;
    for (let k = 0; k < count; k++) {
      const frac = (k + 0.5) / count;
      let oi = 0;
      while (oi < bounds.length - 1 && frac > bounds[oi]) oi++;
      let ord = oLo + oi;
      while (load[ord] >= cap(ord) && ord < order.length - 1) ord++; // spill forward
      result[lo + k] = order[ord].index;
      load[ord]++;
    }
  };

  // Walk null runs; bracket each by the anchors (or file edges) around it.
  let i = 0;
  while (i < n) {
    if (result[i] !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && result[j] === null) j++;
    // [i, j) is a null run. Words before the FIRST anchor go to the first
    // anchored chunk (not to leading unanchored chunks, which are usually
    // instrumental/bleed); words after the LAST anchor go to the last anchored
    // chunk. Only a run BETWEEN two anchors spreads across the chunks between.
    const leftChunk = i > 0 ? result[i - 1] : null;
    const rightChunk = j < n ? result[j] : null;
    const leftOrd = leftChunk !== null ? ordOf.get(leftChunk)! : null;
    const rightOrd = rightChunk !== null ? ordOf.get(rightChunk)! : null;
    let oLo: number;
    let oHi: number;
    if (leftOrd !== null && rightOrd !== null) {
      oLo = Math.min(leftOrd, rightOrd);
      oHi = Math.max(leftOrd, rightOrd);
    } else if (rightOrd !== null) {
      oLo = oHi = rightOrd; // before first anchor -> first anchored chunk
    } else if (leftOrd !== null) {
      oLo = leftOrd; // after last anchor -> spread across the remaining (later) chunks
      oHi = order.length - 1;
    } else {
      oLo = 0; // no anchors at all -> spread across everything (fallback)
      oHi = order.length - 1;
    }
    distribute(i, j, oLo, oHi);
    i = j;
  }
  return result;
}

/** Group a chunk-per-word assignment into contiguous {chunk, wordRange} spans,
 *  skipping words with no chunk. Each span is one chunk's lyric text to align. */
export function groupByChunk(chunkOf: (number | null)[]): { chunk: number; from: number; to: number }[] {
  const spans: { chunk: number; from: number; to: number }[] = [];
  for (let i = 0; i < chunkOf.length; i++) {
    const c = chunkOf[i];
    if (c === null) continue;
    const prev = spans[spans.length - 1];
    if (prev && prev.chunk === c && prev.to === i - 1) prev.to = i;
    else spans.push({ chunk: c, from: i, to: i });
  }
  return spans;
}
