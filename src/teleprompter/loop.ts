/**
 * Section-loop math for the bundle player.
 *
 * The bundle drives off an <audio> element's clock. To loop a section we need
 * its bounds in AUDIO TIME, but sections are authored in BEATS. Convert each
 * section's start-beat through the curve's inverse (beat -> time) to get the
 * loop window; wrap back to the start when playback runs past the end.
 *
 * These are pure so they can be unit-tested; the client (teleprompter.js)
 * mirrors the same few lines against its own <audio> element.
 */

/** A section as the loop needs it — just a name and where it starts (in beats). */
export interface LoopSection {
  name: string;
  startBeat: number;
}

export interface LoopBounds {
  name: string;
  startTime: number;
  endTime: number;
}

/**
 * Audio-time bounds of section `index`: from its own start-beat to the NEXT
 * section's start-beat (converted to time via `toTime`). The last section has no
 * "next", so it runs to the media `duration`.
 */
export function sectionLoopBounds(
  sections: readonly LoopSection[],
  index: number,
  toTime: (beat: number) => number,
  duration: number,
): LoopBounds {
  if (index < 0 || index >= sections.length) {
    throw new RangeError(`section index ${index} out of range (0..${sections.length - 1})`);
  }
  const startTime = toTime(sections[index].startBeat);
  const endTime =
    index + 1 < sections.length ? toTime(sections[index + 1].startBeat) : duration;
  return { name: sections[index].name, startTime, endTime };
}

/**
 * Where to seek to keep playback inside a loop, or null if it's already inside.
 * Wraps only at the END (past `endTime` -> back to `startTime`); scrubbing
 * earlier than the loop is left alone so a manual lead-in still works.
 */
export function loopWrapTarget(
  currentTime: number,
  startTime: number,
  endTime: number,
): number | null {
  return currentTime >= endTime ? startTime : null;
}
