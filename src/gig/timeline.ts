/**
 * Moving between the board recording's clock and a phone video's.
 *
 * `clickbait-audio offset` reports where the video's first sample plays on the
 * board (`offset`, seconds) and how much faster the phone's clock runs
 * (`drift_ppm`), so board time = offset + video time × (1 + drift).
 */

export interface Sync {
  offset: number;
  drift_ppm: number | null;
}

const rate = (sync: Sync) => 1 + (sync.drift_ppm ?? 0) * 1e-6;

/** The stretch of board recording a video covers. Starts at 0 if the video started first. */
export function boardSpan(sync: Sync, videoSeconds: number): { start: number; seconds: number } {
  const start = Math.max(0, sync.offset);
  return { start, seconds: sync.offset + videoSeconds * rate(sync) - start };
}

/**
 * A time in audio cut from the board by `boardSpan` (or, with no sync, in the
 * phone's own sound) as a time in the video.
 */
export function toVideoTime(t: number, sync: Sync | null): number {
  if (!sync) return t;
  return (Math.max(0, sync.offset) + t - sync.offset) / rate(sync);
}

/**
 * The offset between the files as they really play, from one measured on audio
 * decoded with each file's encoder delay left in (`boardDelay`, `clipDelay`, in
 * seconds). Equal delays cancel.
 */
export function correctOffset(offset: number, boardDelay: number, clipDelay: number): number {
  return offset - boardDelay + clipDelay;
}
