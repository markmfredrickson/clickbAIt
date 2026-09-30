/**
 * Where a lyric display puts the song's chords.
 *
 * - A chord goes over the word sung nearest to it, among the words that
 *   start from half a beat before it to half a beat before the next chord
 *   (singers anticipate, and a chord file's times are rough). Words are used
 *   in order, one chord each, the way a chord sheet reads.
 * - Chords with nothing sung under them (an intro, a solo, a walkdown between
 *   lines) are gathered into a row of bars, placed in the lyrics where it
 *   plays: before the first line that starts after its first chord. The row
 *   runs from its first chord's bar to the bar before the next chord's, and
 *   each bar keeps its own meter.
 * - A section with no lyrics starts a new row, which carries its name.
 *
 * Timing decides all of this, not section names: a song's manifest may split
 * a verse into several sections (a 2/4 bar in the middle, a turnaround) that
 * have no lyric lines of their own but are still sung through.
 */

export interface LayoutInput {
  sections: readonly { name: string; startBeat: number; bars: number; beatsPerBar: number; barBeats?: readonly number[] }[];
  words: readonly { startBeat: number }[];
  lines: readonly { words: readonly [number, number]; sectionIndex?: number }[];
  chords: readonly { chord: string; beat: number }[];
}

export interface ChordRow {
  /** Index of the lyric line the row goes before; `lines.length` for after the last. */
  beforeLine: number;
  /** The section's name, when the row starts a section with no lyrics. */
  label?: string;
  /** Beat of the row's first chord. */
  firstBeat: number;
  bars: { startBeat: number; beats: number; chords: { chord: number; at: number }[] }[];
}

export interface ChordLayout {
  /** Word index → the chord index over it. */
  overWord: Record<number, number>;
  rows: ChordRow[];
  /** Chord index → the row holding it, for chords in rows. */
  rowOfChord: Record<number, number>;
}

const EPS = 1e-6;
/** How far before its chord (in beats) a word may start and still carry it. */
const ANTICIPATION = 0.5;

export function layoutChords(input: LayoutInput): ChordLayout {
  const { sections, words, lines, chords } = input;
  const layout: ChordLayout = { overWord: {}, rows: [], rowOfChord: {} };

  const sectionAt = (beat: number) => {
    let found = sections[0];
    for (const s of sections) if (s.startBeat <= beat + EPS) found = s;
    return found;
  };
  // Bars have their own lengths when a file lists them (a 2/4 bar in a 4/4 verse).
  const withBars = sections.every((s) => s.barBeats) ? (sections as readonly { startBeat: number; barBeats: readonly number[] }[]) : null;
  const barStart = (beat: number) => {
    const bar = withBars && songBarAt(withBars, beat);
    if (bar) return bar.startBeat;
    const s = sectionAt(beat);
    if (!s) return beat;
    return s.startBeat + Math.floor((beat - s.startBeat) / s.beatsPerBar + EPS) * s.beatsPerBar;
  };
  const beatsPerBar = (beat: number) => (withBars && songBarAt(withBars, beat)?.beats) || (sectionAt(beat)?.beatsPerBar ?? 4);
  const lyricSections = new Set(lines.map((l) => l.sectionIndex));

  // Runs of consecutive chords with nothing sung under them.
  let run: number[] = [];
  const closeRun = (next: number | undefined) => {
    if (run.length === 0) return;
    const first = chords[run[0]].beat;
    const last = chords[run[run.length - 1]].beat;
    // Through the last chord's bar, and on up to the next chord's bar.
    const lastBar = barStart(last);
    const limit = next === undefined ? lastBar + EPS : Math.max(lastBar + EPS, barStart(chords[next].beat) - EPS);
    const bars: ChordRow["bars"] = [];
    for (let b = barStart(first); b < limit; b += beatsPerBar(b)) {
      const beats = beatsPerBar(b);
      bars.push({
        startBeat: b,
        beats,
        chords: run
          .filter((c) => chords[c].beat >= b - EPS && chords[c].beat < b + beats - EPS)
          .map((c) => ({ chord: c, at: (chords[c].beat - b) / beats })),
      });
    }
    let beforeLine = lines.findIndex((l) => (words[l.words[0]]?.startBeat ?? Infinity) >= first - EPS);
    if (beforeLine < 0) beforeLine = lines.length;
    const index = sections.findIndex((s, i) => Math.abs(s.startBeat - first) < EPS && !lyricSections.has(i));
    const row: ChordRow = { beforeLine, ...(index >= 0 ? { label: sections[index].name } : {}), firstBeat: first, bars };
    for (const c of run) layout.rowOfChord[c] = layout.rows.length;
    layout.rows.push(row);
    run = [];
  };

  let lastWord = -1;
  chords.forEach((c, i) => {
    const next = chords[i + 1]?.beat ?? Infinity;
    let word = -1;
    for (let w = lastWord + 1; w < words.length && words[w].startBeat < next - ANTICIPATION - EPS; w++) {
      if (words[w].startBeat < c.beat - ANTICIPATION - EPS) continue;
      if (word < 0 || Math.abs(words[w].startBeat - c.beat) < Math.abs(words[word].startBeat - c.beat)) word = w;
    }
    if (word >= 0) {
      closeRun(i);
      layout.overWord[word] = i;
      lastWord = word;
    } else {
      // A section with no lyrics starting since the run's last chord starts a new row.
      const prev = run.length ? chords[run[run.length - 1]].beat : Infinity;
      if (sections.some((s, si) => !lyricSections.has(si) && s.startBeat > prev + EPS && s.startBeat <= c.beat + EPS)) closeRun(i);
      run.push(i);
    }
  });
  closeRun(undefined);
  return layout;
}

/** Index of the chord sounding at `beat`: the last at or before it, or -1. */
export function currentChord(chords: readonly { beat: number }[], beat: number): number {
  let found = -1;
  for (let i = 0; i < chords.length && chords[i].beat <= beat + EPS; i++) found = i;
  return found;
}

/**
 * What a scrolling display should keep in view at `beat`: the chord row
 * playing now if nothing has been sung since it started, otherwise the line
 * of the word sung last.
 */
export function followTarget(
  layout: ChordLayout,
  input: LayoutInput,
  beat: number,
): { row: number } | { line: number } | null {
  const c = currentChord(input.chords, beat);
  const row = c >= 0 ? layout.rowOfChord[c] : undefined;
  let word = -1;
  for (let i = 0; i < input.words.length && input.words[i].startBeat <= beat + EPS; i++) word = i;
  if (row !== undefined && (word < 0 || layout.rows[row].firstBeat >= input.words[word].startBeat - EPS)) {
    return { row };
  }
  if (word < 0) return null;
  const line = input.lines.findIndex((l) => l.words[0] <= word && word <= l.words[1]);
  return line >= 0 ? { line } : null;
}

/**
 * The grid a bar of chords is drawn on: a column per beat when every chord
 * falls on one, eighths or sixteenths only when a chord needs them, so a bar
 * stays as narrow as its chords allow. `starts` are 1-based columns.
 */
export function barGrid(bar: { beats: number; chords: readonly { at: number }[] }): { columns: number; starts: number[] } {
  const beats = Math.max(1, Math.round(bar.beats));
  const fits = (per: number) => bar.chords.every((c) => Math.abs(c.at * beats * per - Math.round(c.at * beats * per)) < 1e-6);
  const per = [1, 2].find(fits) ?? 4;
  return { columns: beats * per, starts: bar.chords.map((c) => Math.round(c.at * beats * per) + 1) };
}

/** Bars per line in a chord row: a four-bar phrase reads as a unit. */
export const BARS_PER_LINE = 4;

/** A chord row's bars, split into lines of `BARS_PER_LINE`. */
export function rowLines<T>(bars: readonly T[]): T[][] {
  const lines: T[][] = [];
  for (let i = 0; i < bars.length; i += BARS_PER_LINE) lines.push(bars.slice(i, i + BARS_PER_LINE));
  return lines;
}

/** The bar holding `beat` when sections list their bar lengths, else null. */
function songBarAt(
  sections: readonly { startBeat: number; barBeats: readonly number[] }[],
  beat: number,
): { startBeat: number; beats: number } | null {
  for (const s of sections) {
    let start = s.startBeat;
    for (const beats of s.barBeats) {
      if (beat >= start - EPS && beat < start + beats - EPS) return { startBeat: start, beats };
      start += beats;
    }
  }
  return null;
}
