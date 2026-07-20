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

/**
 * Assign each published word to a chunk. Exact matches take their heard word's
 * chunk; unmatched words inherit the nearest anchored neighbor (previous first,
 * then next), so Whisper substitutions/deletions don't strand a word. Returns a
 * chunk index per published word, or null only if NOTHING anchored at all.
 */
export function assignChunks(published: string[], heard: HeardWord[]): (number | null)[] {
  const p = published.map(normWord);
  const h = heard.map((w) => normWord(w.text));
  const aligned = alignSequences(p, h);
  const chunk: (number | null)[] = aligned.map((hi) => (hi >= 0 ? heard[hi].chunk : null));

  const n = chunk.length;
  const prev: (number | null)[] = new Array(n).fill(null);
  let last: number | null = null;
  for (let i = 0; i < n; i++) {
    if (chunk[i] !== null) last = chunk[i];
    prev[i] = last;
  }
  const next: (number | null)[] = new Array(n).fill(null);
  last = null;
  for (let i = n - 1; i >= 0; i--) {
    if (chunk[i] !== null) last = chunk[i];
    next[i] = last;
  }
  for (let i = 0; i < n; i++) {
    if (chunk[i] === null) chunk[i] = prev[i] !== null ? prev[i] : next[i];
  }
  return chunk;
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
