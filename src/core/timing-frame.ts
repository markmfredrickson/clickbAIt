/**
 * The single downbeat-origin conversion, shared by the two things that MUST
 * agree on where "beat 0" sits: the REAPER project (PROJOFFS) and the
 * LyricsDisplay curve (t0). See docs/timing-frames.md.
 *
 * Song beat 0 is the bar-1 downbeat. The pre-roll (count-in + spoken slug + any
 * pickup room) is `paddingBeats` of space before it, encoded two equivalent
 * ways — a PROJOFFS measure offset for REAPER, a curve t0 in seconds for the
 * bundle player. They kept drifting because each side computed its own encoding
 * from `paddingBeats` with its own formula; this puts both in one place so they
 * can't disagree.
 */

export interface DownbeatFrame {
  /** REAPER `PROJOFFS 0 <measureOffset> 0`: <= 0, puts the downbeat at Bar 1. */
  measureOffset: number;
  /** Curve `t0`: seconds from project start (time 0) to the downbeat. */
  downbeatSeconds: number;
  /**
   * True when `paddingBeats` is a whole number of bars. If not, the downbeat
   * doesn't land on a bar line, so REAPER's measure grid (and the live
   * `/beat/str` tracking) can't hit it exactly — the caller should warn.
   */
  wholeBars: boolean;
}

/**
 * Given the pre-downbeat padding (in beats), the tempo, and the meter, return
 * the two equivalent encodings of the downbeat origin. `measureOffset` is
 * meter-only (tempo-independent); `downbeatSeconds` uses the tempo.
 */
export function downbeatFrame(
  paddingBeats: number,
  bpm: number,
  beatsPerBar: number,
): DownbeatFrame {
  const bars = Math.round(paddingBeats / beatsPerBar);
  return {
    measureOffset: -bars,
    downbeatSeconds: (paddingBeats * 60) / bpm,
    wholeBars: Math.abs(paddingBeats - bars * beatsPerBar) <= 1e-3,
  };
}
