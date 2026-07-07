/**
 * Tempo math — the canonical home for beat ↔ seconds conversion.
 *
 * A `TempoMap` is a piecewise representation of the song's tempo: a list of
 * `{ beat, bpm }` points, where each point declares the BPM that applies
 * from that beat forward until the next point. Beat 0's BPM comes from the
 * first entry; if the list is empty, a fallback 120 BPM is assumed.
 *
 * All conversions walk the piecewise list, accumulating elapsed seconds
 * segment by segment. Extending to non-constant tempo within a segment
 * (ritardandos, accelerandos) would live here too — the callers shouldn't
 * have to know about it.
 *
 * Prior to this module, three separate copies of this logic lived in
 * `build-rpp.ts`, `teleprompter/export.ts`, and `teleprompter/relay.ts`
 * with slight variations (strict vs. non-strict stopping condition). This
 * consolidates them.
 */

export interface TempoPoint {
  beat: number;
  bpm: number;
}

/** Seconds elapsed from beat 0 to `beat` along the tempo map. */
export function beatToSeconds(beat: number, tempoMap: readonly TempoPoint[]): number {
  let seconds = 0;
  let prevBeat = 0;
  let bpm = tempoMap[0]?.bpm ?? 120;

  for (const tp of tempoMap) {
    if (tp.beat >= beat) break;
    if (tp.beat > prevBeat) {
      seconds += ((tp.beat - prevBeat) / bpm) * 60;
      prevBeat = tp.beat;
    }
    bpm = tp.bpm;
  }
  seconds += ((beat - prevBeat) / bpm) * 60;
  return seconds;
}

/** Beats elapsed from seconds=0 to `seconds` along the tempo map. */
export function secondsToBeat(seconds: number, tempoMap: readonly TempoPoint[]): number {
  if (tempoMap.length === 0) return 0;

  // Walk the map in a single pass, tracking cumulative seconds at each
  // tempo change. Don't call beatToSeconds() inside the loop — that'd make
  // this O(n²). Each segment contributes `(segmentBeats / segmentBpm) * 60`
  // seconds; we carry that running sum as `tpSeconds`.
  let beat = 0;
  let prevSec = 0;
  let tpSeconds = 0;
  let prevTpBeat = 0;
  let bpm = tempoMap[0].bpm;

  for (const tp of tempoMap) {
    if (tp.beat > prevTpBeat) {
      tpSeconds += ((tp.beat - prevTpBeat) / bpm) * 60;
      prevTpBeat = tp.beat;
    }
    if (tpSeconds >= seconds) break;
    if (tpSeconds > prevSec) {
      beat += ((tpSeconds - prevSec) / 60) * bpm;
      prevSec = tpSeconds;
    }
    bpm = tp.bpm;
  }
  beat += ((seconds - prevSec) / 60) * bpm;
  return beat;
}
