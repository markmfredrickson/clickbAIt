/**
 * Building the row document (see rows.ts) from a song's manifest sections,
 * its lyric timing, its chords and its built charts. Runs at build; the
 * relay also uses it for a song built before rows files existed.
 */

import { songSections, type SongSection } from "../charts/bar-map.js";
import type { PlaceableSection } from "../manifest.js";
import type { ChartChord } from "../charts/build.js";
import type { FigureChart } from "../charts/figures.js";
import type { MappedBar } from "../charts/bar-map.js";
import type { DisplayLine, LyricWord } from "./lyrics-display.js";
import { sectionMeters } from "./position.js";
import type { ChartKind, ChordRow, FigureRow, LyricRow, RowChannel, RowDocument, RowSection, ScoreRow, Span, Word } from "./rows.js";
import type { Note } from "./card.js";

export interface RowInput {
  slug: string;
  title: string;
  /** The parts of the manifest that set sections and chord rows. */
  song: {
    timeSignature: readonly [number, number];
    barsPerRow?: number;
    sections: readonly (PlaceableSection & { name: string; barsPerRow?: number })[];
  };
  lyrics?: { words: readonly LyricWord[]; lines: readonly DisplayLine[] };
  chords?: readonly ChartChord[];
  /** Built charts: a chart-style one becomes a figures channel, a score-style one a score channel. */
  charts?: readonly {
    id: string;
    kind: ChartKind;
    instrument: string;
    source: string;
    track: number;
    style: "chart" | "score";
    bars: readonly MappedBar[];
    figures?: FigureChart;
    /** Chart style: sections drawn bar by bar anyway, by index. */
    sectionsAsScore?: number[];
    /** Score bars with nothing but rests, so a part's opening figure skips them. */
    restBars?: number[];
  }[];
  /** For the card before the song: where its timeline starts, and its notes. */
  startBeat?: number;
  notes?: readonly Note[];
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
  const sections: RowSection[] = placed.map((s, i) => ({
    name: s.name,
    start: s.startBeat,
    end: s.startBeat + s.barBeats.reduce((sum, b) => sum + b, 0),
    bars: s.bars,
    beatsPerBar: s.beatsPerBar,
    ...(input.song.sections[i].meters?.length ? { barBeats: s.barBeats } : {}),
  }));
  const songEnd = sections.length ? sections[sections.length - 1].end : 0;
  const channels: RowChannel[] = [];

  if (input.lyrics) channels.push({ id: "lyrics", kind: "lyrics", rows: lyricRows(input.lyrics) });

  const perRow = input.song.sections.map((s) => s.barsPerRow ?? input.song.barsPerRow ?? BARS_PER_ROW);
  if (input.chords) channels.push({ id: "chords", kind: "chords", rows: chordRows(placed, perRow, input.chords, songEnd) });

  for (const chart of input.charts ?? []) {
    const drawing = { id: chart.id, instrument: chart.instrument, chart: chart.kind, source: chart.source, track: chart.track };
    if (chart.style === "score") channels.push({ ...drawing, kind: "score", rows: scoreRows(placed, perRow, chart.bars) });
    else if (chart.figures) {
      const asScore = new Set(chart.sectionsAsScore ?? []);
      const scored = scoreRows(placed, perRow, chart.bars);
      const rows = figureRows(sections, chart.figures).flatMap((row): (FigureRow | ScoreRow)[] =>
        asScore.has(row.section) ? scored.filter((s) => s.section === row.section) : [row],
      );
      channels.push({ ...drawing, kind: "figures", rows });
    }
  }

  const doc: RowDocument = { schema: "clickbait/rows@1", slug: input.slug, title: input.title, sections, channels };
  if (input.notes?.length || input.startBeat !== undefined) {
    const figures: Record<string, { scoreBars: number[] }[]> = {};
    const opening: Record<string, { row: number; item: number }> = {};
    for (const chart of input.charts ?? []) {
      const channel = channels.find((c) => c.id === chart.id);
      if (!channel) continue;
      const rests = new Set(chart.restBars ?? []);
      if (channel.kind === "figures" && chart.figures) {
        // Its phrases that play something (a rest is nothing to remember).
        const list = chart.figures.phrases.filter((p) => !p.rest).map((p) => ({ scoreBars: p.scoreBars }));
        if (list.length) figures[chart.id] = list;
      } else {
        const at = openingFigure(channel, rests);
        if (at) opening[chart.id] = at;
      }
    }
    doc.card = { startBeat: input.startBeat ?? 0, notes: [...(input.notes ?? [])], figures, opening };
  }
  return doc;
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

/** Each section's bars in rows of `perRow`, never past its end, with each bar's song bar number. */
function barRows(sections: SongSection[], perRow: number[]): { section: number; bars: (Span & { songBar: number })[] }[] {
  const rows: { section: number; bars: (Span & { songBar: number })[] }[] = [];
  sections.forEach((s, section) => {
    const n = Math.max(1, perRow[section]);
    const starts = [s.startBeat];
    for (const b of s.barBeats) starts.push(starts[starts.length - 1] + b);
    for (let first = 0; first < s.barBeats.length; first += n) {
      const bars: (Span & { songBar: number })[] = [];
      for (let b = first; b < Math.min(s.barBeats.length, first + n); b++) bars.push({ start: starts[b], end: starts[b + 1], songBar: s.firstBar + b });
      rows.push({ section, bars });
    }
  });
  return rows;
}

function chordRows(sections: SongSection[], perRow: number[], chords: readonly ChartChord[], songEnd: number): ChordRow[] {
  const rows: ChordRow[] = barRows(sections, perRow).map(({ section, bars }) => ({
    section,
    start: bars[0].start,
    end: bars[bars.length - 1].end,
    bars: bars.map(({ start, end }) => ({ start, end })),
    items: [],
  }));
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

function figureRows(sections: RowSection[], chart: FigureChart): FigureRow[] {
  return chart.sections.map(({ section, runs }) => ({
    type: "figures" as const,
    section,
    start: sections[section].start,
    end: sections[section].end,
    items: runs.map((run) => {
      const phraseBeats = run.barBeats.reduce((sum, b) => sum + b, 0);
      return {
        scoreBars: run.scoreBars,
        barBeats: run.barBeats,
        draw: run.draw,
        count: run.count,
        phraseBeats,
        songBar: run.songBar,
        start: run.startBeat,
        end: run.startBeat + run.count * phraseBeats,
      };
    }),
  }));
}

/** A score-style part: rows of bars, like chord rows, each bar with the score bar that plays there. */
function scoreRows(sections: SongSection[], perRow: number[], mapped: readonly MappedBar[]): ScoreRow[] {
  const scoreBarOf = new Map(mapped.map((m) => [m.songBar, m.scoreBar]));
  return barRows(sections, perRow).map(({ section, bars }) => ({
    type: "score" as const,
    section,
    start: bars[0].start,
    end: bars[bars.length - 1].end,
    items: bars.map((bar) => ({ ...bar, scoreBar: scoreBarOf.get(bar.songBar) ?? null })),
  }));
}


/**
 * The row document for a song built before rows files existed, from its
 * lyrics display and (when it has one) its charts file. Chord rows take the
 * default length, since the display doesn't carry `barsPerRow`.
 */
export function rowsFromDisplay(
  display: {
    slug: string;
    title: string;
    timeSignature: readonly [number, number];
    meterMap?: readonly { beatsPerBar: number }[];
    words: readonly LyricWord[];
    display: { sections: readonly { name: string; startBeat: number; bars?: number; barBeats?: readonly number[] }[]; lines: readonly DisplayLine[] };
  },
  charts?: { chords?: readonly ChartChord[]; charts: RowInput["charts"] } | null,
): RowDocument {
  const denominator = display.timeSignature[1];
  const metered = sectionMeters(display);
  const sections = display.display.sections.map((s, i) => {
    const m = metered[i];
    const section: RowInput["song"]["sections"][number] = { name: s.name, bars: m.bars, timeSignature: [m.beatsPerBar, denominator] };
    // Bars of another length become that section's meters.
    const meters = (m.barBeats ?? []).flatMap((beats, b) => (beats === m.beatsPerBar ? [] : [{ bar: b + 1, timeSignature: [beats, denominator] as [number, number] }]));
    return meters.length ? { ...section, meters } : section;
  });
  return buildRows({
    slug: display.slug,
    title: display.title,
    song: { timeSignature: display.timeSignature, sections },
    ...(display.words.length ? { lyrics: { words: display.words, lines: display.display.lines } } : {}),
    ...(charts?.chords ? { chords: charts.chords } : {}),
    ...(charts?.charts ? { charts: charts.charts } : {}),
  });
}

/**
 * A chart channel's opening figure, for the card: its first figure run, or
 * score bar, with a bar that plays something (not only rests).
 */
function openingFigure(channel: RowChannel, rests: ReadonlySet<number>): { row: number; item: number } | null {
  if (channel.kind !== "figures" && channel.kind !== "score") return null;
  const plays = (bar: number | null) => bar !== null && !rests.has(bar);
  const rows: (FigureRow | ScoreRow)[] = channel.rows;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const item =
      row.type === "figures"
        ? row.items.findIndex((run) => run.scoreBars.some(plays))
        : row.items.findIndex((bar) => plays(bar.scoreBar));
    if (item >= 0) return { row: r, item };
  }
  return null;
}
