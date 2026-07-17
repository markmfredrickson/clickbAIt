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
 * Audio-time bounds of a CONTIGUOUS run of sections [startIndex, endIndex]:
 * from the first section's start-beat to the section AFTER the last one's
 * start-beat (converted to time via `toTime`). A run ending at the final
 * section has no "next", so it runs to the media `duration`. Pass the same
 * index for both to loop a single section.
 */
export function sectionLoopBounds(
  sections: readonly LoopSection[],
  startIndex: number,
  endIndex: number,
  toTime: (beat: number) => number,
  duration: number,
): LoopBounds {
  const last = sections.length - 1;
  if (startIndex < 0 || endIndex > last || startIndex > endIndex) {
    throw new RangeError(
      `section range [${startIndex}, ${endIndex}] invalid for 0..${last}`,
    );
  }
  const startTime = toTime(sections[startIndex].startBeat);
  const endTime =
    endIndex + 1 < sections.length ? toTime(sections[endIndex + 1].startBeat) : duration;
  const name =
    startIndex === endIndex
      ? sections[startIndex].name
      : `${sections[startIndex].name} – ${sections[endIndex].name}`;
  return { name, startTime, endTime };
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
