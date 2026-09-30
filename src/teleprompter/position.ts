/**
 * Where the song is, as a musician counts it: the section, the bar within it,
 * the beat within the bar, and the song's bar number (measure), which matches
 * REAPER's with the downbeat as measure 1. Each section counts in its own
 * meter; before the downbeat the count-in counts back in the song's meter.
 */

export interface MeteredSection {
  startBeat: number;
  bars: number;
  beatsPerBar: number;
}

export interface SongPosition {
  /** Index of the section, or -1 in the count-in. */
  section: number;
  /** 1-based bar within the section (0 and below in the count-in). */
  bar: number;
  /** 1-based beat within the bar. */
  beat: number;
  /** 1-based bar of the song. */
  measure: number;
}

const EPS = 1e-6;

export function songPosition(sections: readonly MeteredSection[], beat: number, countInBeatsPerBar: number): SongPosition {
  if (sections.length === 0 || beat < sections[0].startBeat - EPS) {
    const bar = Math.floor(beat / countInBeatsPerBar + EPS) + 1;
    return { section: -1, bar, beat: Math.floor(beat - (bar - 1) * countInBeatsPerBar + EPS) + 1, measure: bar };
  }
  let measure = 1;
  let i = 0;
  while (i + 1 < sections.length && sections[i + 1].startBeat <= beat + EPS) {
    measure += sections[i].bars;
    i++;
  }
  const s = sections[i];
  const into = beat - s.startBeat;
  const barIndex = Math.floor(into / s.beatsPerBar + EPS);
  return {
    section: i,
    bar: barIndex + 1,
    beat: Math.floor(into - barIndex * s.beatsPerBar + EPS) + 1,
    measure: measure + barIndex,
  };
}

/**
 * A lyrics display's sections with their meters. A section's meter is its
 * length over its bars, measured to the next section's start; the last
 * section takes the meter map's last meter, or the time signature.
 */
export function sectionMeters(display: {
  timeSignature: readonly [number, number];
  meterMap?: readonly { beatsPerBar: number }[];
  display: { sections: readonly { startBeat: number; bars?: number }[] };
}): MeteredSection[] {
  const sections = display.display.sections;
  const lastMeter = display.meterMap?.length ? display.meterMap[display.meterMap.length - 1].beatsPerBar : display.timeSignature[0];
  return sections.map((s, i) => {
    const next = sections[i + 1];
    const bars = s.bars ?? (next ? (next.startBeat - s.startBeat) / display.timeSignature[0] : 1);
    const beatsPerBar = next && bars > 0 ? (next.startBeat - s.startBeat) / bars : lastMeter;
    return { startBeat: s.startBeat, bars, beatsPerBar };
  });
}
