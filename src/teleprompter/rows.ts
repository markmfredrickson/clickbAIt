/**
 * The row document, `<slug>.rows.json`: everything a display can show, laid
 * out once at build as rows, channel by channel. A display picks the
 * channels it wants and shows each in its own pane, in the order asked for.
 * Panes don't line up with each other; each follows the beat on its own, so
 * a drum pane can sit on "A ×8" while the lyrics pane turns several lines.
 *
 * A channel's rows depend on what it is:
 *   lyrics  one row per sung line, its words the items
 *   chords  `barsPerRow` bars per row (4, or the song's or section's own),
 *           never past a section's end; its chords the items
 *   drums   one row per section; its groove runs the items, each run whole
 *
 * Every row and item has a start and an end in beats, so a display lights
 * whatever contains the beat, and pages by row starts (see panes.ts).
 * Section names are shown only in a display's header, so rows carry the
 * section index at most, never a label to draw.
 */

import { songSections } from "../charts/bar-map.js";
import type { ChartChord } from "../charts/build.js";
import type { GrooveChart } from "../charts/grooves.js";
import type { DisplayLine, LyricWord } from "./lyrics-display.js";

export interface Span {
  start: number;
  end: number;
}

export interface RowSection extends Span {
  name: string;
  bars: number;
  beatsPerBar: number;
}

export interface Word extends Span {
  text: string;
}

export interface LyricRow extends Span {
  /** e.g. "Backing Vocal". */
  tag?: string;
  items: Word[];
}

export interface ChordItem extends Span {
  chord: string;
}

export interface ChordRow extends Span {
  /** Index into the document's sections. */
  section: number;
  bars: Span[];
  items: ChordItem[];
}

export interface DrumItem extends Span {
  /** The groove's letter, or null for bars the score has nothing for. */
  letter: string | null;
  /** Bars in the run. */
  count: number;
  /** Beats in each of its bars. */
  barBeats: number;
  /** 1-based song bar the run starts on. */
  songBar: number;
  /** The score bar that shows the groove, or null. */
  scoreBar: number | null;
  /** True on the run where its section first plays the letter: draw the notation here. */
  first: boolean;
}

export interface DrumRow extends Span {
  section: number;
  items: DrumItem[];
}

export type RowChannel =
  | { id: string; kind: "lyrics"; rows: LyricRow[] }
  | { id: string; kind: "chords"; rows: ChordRow[] }
  | { id: string; kind: "drums"; instrument: string; source: string; track: number; rows: DrumRow[] };

export interface RowDocument {
  schema: "clickbait/rows@1";
  slug: string;
  title: string;
  sections: RowSection[];
  channels: RowChannel[];
}

export interface RowInput {
  slug: string;
  title: string;
  /** The parts of the manifest that set sections and chord rows. */
  song: {
    timeSignature: readonly [number, number];
    barsPerRow?: number;
    sections: readonly { name: string; bars: number; timeSignature?: readonly [number, number]; barsPerRow?: number }[];
  };
  lyrics?: { words: readonly LyricWord[]; lines: readonly DisplayLine[] };
  chords?: readonly ChartChord[];
  /** Built charts; drum charts with grooves become channels. */
  charts?: readonly { id: string; kind: string; instrument: string; source: string; track: number; grooves?: GrooveChart }[];
}

export const BARS_PER_ROW = 4;

// A word's highlight lets go like the prompter's always has: the last word
// before a rest is held 1–3 beats (the aligner's end times can stretch into
// the silence after a phrase), plus a half-beat grace, and a word ends no
// later than the next one starts.
const HOLD_MIN = 1;
const HOLD_MAX = 3;
const HOLD_GRACE = 0.5;

export function buildRows(input: RowInput): RowDocument {
  const placed = songSections(input.song.sections, input.song.timeSignature);
  const sections: RowSection[] = placed.map((s) => ({
    name: s.name,
    start: s.startBeat,
    end: s.startBeat + s.bars * s.beatsPerBar,
    bars: s.bars,
    beatsPerBar: s.beatsPerBar,
  }));
  const songEnd = sections.length ? sections[sections.length - 1].end : 0;
  const channels: RowChannel[] = [];

  if (input.lyrics) channels.push({ id: "lyrics", kind: "lyrics", rows: lyricRows(input.lyrics) });

  if (input.chords) {
    const perRow = input.song.sections.map((s) => s.barsPerRow ?? input.song.barsPerRow ?? BARS_PER_ROW);
    channels.push({ id: "chords", kind: "chords", rows: chordRows(sections, perRow, input.chords, songEnd) });
  }

  for (const chart of input.charts ?? []) {
    if (chart.kind !== "drums" || !chart.grooves) continue;
    channels.push({
      id: chart.id,
      kind: "drums",
      instrument: chart.instrument,
      source: chart.source,
      track: chart.track,
      rows: drumRows(sections, chart.grooves),
    });
  }

  return { schema: "clickbait/rows@1", slug: input.slug, title: input.title, sections, channels };
}

function lyricRows(lyrics: NonNullable<RowInput["lyrics"]>): LyricRow[] {
  const { words } = lyrics;
  const endOf = (i: number) => {
    const w = words[i];
    const hold = Math.min(HOLD_MAX, Math.max(HOLD_MIN, w.endBeat - w.startBeat));
    const next = i + 1 < words.length ? words[i + 1].startBeat : Infinity;
    return Math.min(next, w.startBeat + hold + HOLD_GRACE);
  };
  const rows: LyricRow[] = [];
  for (const line of lyrics.lines) {
    const [from, to] = line.words;
    if (to < from || !words[from]) continue;
    const items: Word[] = [];
    for (let i = from; i <= to && i < words.length; i++) {
      items.push({ text: words[i].text, start: words[i].startBeat, end: endOf(i) });
    }
    const row: LyricRow = { start: items[0].start, end: items[items.length - 1].end, items };
    if (line.tag) row.tag = line.tag;
    rows.push(row);
  }
  return rows;
}

function chordRows(sections: RowSection[], perRow: number[], chords: readonly ChartChord[], songEnd: number): ChordRow[] {
  const rows: ChordRow[] = [];
  sections.forEach((s, section) => {
    const n = Math.max(1, perRow[section]);
    for (let first = 0; first < s.bars; first += n) {
      const bars: Span[] = [];
      for (let b = first; b < Math.min(s.bars, first + n); b++) {
        bars.push({ start: s.start + b * s.beatsPerBar, end: s.start + (b + 1) * s.beatsPerBar });
      }
      rows.push({ section, start: bars[0].start, end: bars[bars.length - 1].end, bars, items: [] });
    }
  });
  if (!rows.length) return rows;

  const sorted = [...chords].sort((a, b) => a.beat - b.beat);
  sorted.forEach((c, i) => {
    if (c.beat >= songEnd) return;
    const end = i + 1 < sorted.length ? Math.min(sorted[i + 1].beat, songEnd) : songEnd;
    // A chord before bar 1 (a pickup) goes in the first row.
    let r = rows.findIndex((row) => c.beat >= row.start && c.beat < row.end);
    if (r < 0) r = 0;
    rows[r].items.push({ chord: c.chord, start: c.beat, end });
  });
  return rows;
}

function drumRows(sections: RowSection[], chart: GrooveChart): DrumRow[] {
  const scoreBarOf = new Map(chart.grooves.map((g) => [g.letter, g.scoreBar]));
  return chart.sections.map(({ section, runs }) => ({
    section,
    start: sections[section].start,
    end: sections[section].end,
    items: runs.map((run) => ({
      letter: run.letter,
      count: run.count,
      barBeats: run.beats,
      songBar: run.songBar,
      scoreBar: run.letter === null ? null : (scoreBarOf.get(run.letter) ?? null),
      first: run.first,
      start: run.startBeat,
      end: run.startBeat + run.count * run.beats,
    })),
  }));
}

/** The document with only the channels `ids` names, in that order. */
export function selectChannels(doc: RowDocument, ids: readonly string[]): RowDocument {
  const channels = ids.flatMap((id) => doc.channels.filter((c) => c.id === id));
  return { ...doc, channels };
}

export interface ChannelPosition {
  /** The last row started, or -1 before the first. */
  row: number;
  /** The item in it playing now, or -1. */
  item: number;
  /** Drum runs: which bar of the run this is, of how many. */
  pass?: number;
  of?: number;
}

/** Where each channel is at `beat`, by channel id. */
export function itemsAt(doc: RowDocument, beat: number): Record<string, ChannelPosition> {
  const out: Record<string, ChannelPosition> = {};
  for (const channel of doc.channels) {
    const rows: (Span & { items: Span[] })[] = channel.rows;
    let row = -1;
    for (let r = 0; r < rows.length && rows[r].start <= beat; r++) row = r;
    const pos: ChannelPosition = { row, item: -1 };
    if (row >= 0) {
      const items = rows[row].items;
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].start <= beat && beat < items[i].end) {
          pos.item = i;
          break;
        }
      }
      if (channel.kind === "drums" && pos.item >= 0) {
        const run = channel.rows[row].items[pos.item];
        pos.pass = Math.floor((beat - run.start) / run.barBeats) + 1;
        pos.of = run.count;
      }
    }
    out[channel.id] = pos;
  }
  return out;
}
