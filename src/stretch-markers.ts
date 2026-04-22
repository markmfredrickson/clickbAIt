/**
 * Generate REAPER stretch markers from DBN beat positions.
 *
 * Each DBN beat has a source time (where it actually is in the audio).
 * Each beat has a grid time (where it should be at the target BPM).
 * A stretch marker maps source → grid, letting REAPER time-stretch
 * the audio to align beats to the click.
 */

export interface Beat {
  time: number;      // seconds in source audio
  strength: number;
}

export interface StretchMarker {
  /** Beat number (0-indexed from anchor). */
  beat: number;
  /** Position on the project timeline (seconds). */
  itemPosition: number;
  /** Position in the source audio file (seconds). */
  sourcePosition: number;
}

export interface StretchMarkerOptions {
  /** Where beat 0 lands in the source audio (seconds). Default: first beat. */
  sourceAnchor?: number;
  /** Where beat 0 lands on the project timeline (seconds). Default: 0. */
  itemAnchor?: number;
  /** Target BPM for the grid. */
  bpm: number;
  /** Emit a stretch marker every Nth beat (default 1 = every beat).
   *  Useful for songs with busy subdivisions where DBN picks up off-beat
   *  onsets — stride=4 in 4/4 keeps only downbeats. */
  stride?: number;
}

/**
 * Convert DBN beat positions to REAPER stretch markers.
 *
 * The DBN gives us beat times in the source audio. We map each beat to
 * where it should land on the grid at the target BPM. Every beat gets
 * a marker — the DBN already produces clean, regular beats so no
 * filtering is needed.
 */
export function beatsToStretchMarkers(
  beats: Beat[],
  options: StretchMarkerOptions,
): StretchMarker[] {
  if (beats.length < 2) return [];

  const { bpm } = options;
  const beatLen = 60 / bpm;
  const sourceAnchor = options.sourceAnchor ?? beats[0].time;
  const itemAnchor = options.itemAnchor ?? 0;
  const stride = options.stride ?? 1;

  const markers: StretchMarker[] = [];

  for (let i = 0; i < beats.length; i += stride) {
    const sourcePos = beats[i].time;
    const beatNum = i;
    const itemPos = itemAnchor + beatNum * beatLen;

    markers.push({
      beat: beatNum,
      itemPosition: itemPos,
      sourcePosition: sourcePos,
    });
  }

  return markers;
}

/**
 * Format stretch markers as REAPER SM lines for an ITEM SOURCE block.
 *
 * REAPER SM format: pairs joined with " + " on SM lines.
 *   SM <src> <item> + <src> <item> + ...
 * Both positions are relative to the item start.
 * Max ~34 pairs per SM line, then start a new line.
 */
export function formatStretchMarkers(
  markers: StretchMarker[],
  itemStartSource: number,
  itemStartProject: number,
): string[] {
  const maxPairsPerLine = 34;
  const pairs: string[] = markers.map(m => {
    const src = m.sourcePosition - itemStartSource;
    const item = m.itemPosition - itemStartProject;
    // REAPER SM format: SM <itemPosition> <sourcePosition>
    return `${item.toFixed(9)} ${src.toFixed(9)}`;
  });

  const lines: string[] = [];
  for (let i = 0; i < pairs.length; i += maxPairsPerLine) {
    const chunk = pairs.slice(i, i + maxPairsPerLine);
    lines.push(`SM ${chunk.join(" + ")}`);
  }
  return lines;
}
