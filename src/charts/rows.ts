/**
 * The rows a display shows, for whichever channels it asked for.
 *
 * Web scrolls rows and e-ink pages them, but both draw the same rows, so this
 * is the one place layout decisions are made:
 *
 * - With only text channels (sections, lyrics), a row is a lyric line, and a
 *   section with no lines gets a row of its own for its label. That is the
 *   display as it has always been.
 * - With any chart channel, a row is a run of `barsPerRow` bars that never
 *   crosses a section boundary, carrying each chart's score bars and the
 *   lyric words sung in those bars. A pickup word sits in the previous
 *   section's last row, under the bar where it's sung, as on a lead sheet.
 *
 * Rows are rebuilt on request for any channel set, and `rowAt` finds the row
 * holding a beat in any layout, so a display that switches channels mid-song
 * stays in place.
 */

import type { MappedBar, SongSection } from "./bar-map.js";

export interface RowInput {
  sections: readonly SongSection[];
  words: readonly { startBeat: number; endBeat: number }[];
  /** Lyric lines in sung order, as in the lyrics display. */
  lines: readonly { words: [number, number]; section?: string; sectionIndex?: number }[];
  /** Mapped bars for each chart channel, by channel id. */
  charts: Readonly<Record<string, readonly MappedBar[]>>;
}

interface RowBase {
  /** Index into the song's sections. */
  section: number;
  /** The section's name, on the first row of each section only. */
  label?: string;
  startBeat: number;
  endBeat: number;
}

export type Row =
  | (RowBase & { kind: "section" })
  | (RowBase & { kind: "line"; words: [number, number] })
  | (RowBase & {
      kind: "bars";
      /** [first, last] song bars, 1-based and inclusive. */
      bars: [number, number];
      /** Words sung in these bars, as [first, last] indices, or null. */
      words: [number, number] | null;
      /** Per chart channel, the score bar for each song bar in the row (null = none). */
      notation: Record<string, (number | null)[]>;
    });

export function buildRows(input: RowInput, channels: readonly string[], opts: { barsPerRow: number }): Row[] {
  const charts = channels.filter((c) => c in input.charts);
  const lyrics = channels.includes("lyrics");
  const rows = charts.length > 0 ? barRows(input, charts, opts.barsPerRow) : textRows(input, lyrics);
  if (charts.length > 0 && lyrics) placeWords(rows, input.words);
  return rows;
}

/** Index of the row holding `beat`: the last row starting at or before it. */
export function rowAt(rows: readonly Row[], beat: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (rows[mid].startBeat <= beat) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const sectionEnd = (s: SongSection) => s.startBeat + s.bars * s.beatsPerBar;

function textRows(input: RowInput, lyrics: boolean): Row[] {
  const rows: Row[] = [];
  const linesBySection = new Map<number, [number, number][]>();
  if (lyrics) {
    input.lines.forEach((line, li) => {
      const si = lineSection(input.sections, line, li);
      const list = linesBySection.get(si) ?? [];
      list.push(line.words);
      linesBySection.set(si, list);
    });
  }
  input.sections.forEach((s, si) => {
    const lines = linesBySection.get(si);
    if (!lines) {
      rows.push({ kind: "section", section: si, label: s.name, startBeat: s.startBeat, endBeat: sectionEnd(s) });
      return;
    }
    lines.forEach((w, li) => {
      rows.push({
        kind: "line",
        section: si,
        ...(li === 0 ? { label: s.name } : {}),
        startBeat: input.words[w[0]].startBeat,
        endBeat: input.words[w[1]].endBeat,
        words: w,
      });
    });
  });
  return rows;
}

/**
 * The section a line belongs to. Current display files say so directly. An
 * older file gives only the name, which is enough when the name is unique;
 * when it repeats (three Verses) there is nothing to go on but a guess, so
 * this asks for a rebuild instead.
 */
function lineSection(
  sections: RowInput["sections"],
  line: RowInput["lines"][number],
  index: number,
): number {
  if (line.sectionIndex !== undefined) return line.sectionIndex;
  const named = sections.flatMap((s, i) => (s.name === line.section ? [i] : []));
  if (named.length === 1) return named[0];
  throw new Error(
    `lyric line ${index} names section "${line.section ?? "(none)"}", which the song has ` +
      `${named.length} of; rebuild the lyrics display so each line records its section`,
  );
}

function barRows(input: RowInput, charts: readonly string[], barsPerRow: number): Row[] {
  const rows: Row[] = [];
  input.sections.forEach((s, si) => {
    for (let first = 0; first < s.bars; first += barsPerRow) {
      const count = Math.min(barsPerRow, s.bars - first);
      const notation: Record<string, (number | null)[]> = {};
      for (const c of charts) {
        const mapped = input.charts[c];
        notation[c] = Array.from({ length: count }, (_, i) => {
          const bar = s.firstBar + first + i;
          return mapped.find((b) => b.songBar === bar)?.scoreBar ?? null;
        });
      }
      rows.push({
        kind: "bars",
        section: si,
        ...(first === 0 ? { label: s.name } : {}),
        startBeat: s.startBeat + first * s.beatsPerBar,
        endBeat: s.startBeat + (first + count) * s.beatsPerBar,
        bars: [s.firstBar + first, s.firstBar + first + count - 1],
        words: null,
        notation,
      });
    }
  });
  return rows;
}

/** Put each word in the bar row holding its beat. Words are in time order. */
function placeWords(rows: Row[], words: RowInput["words"]): void {
  words.forEach((w, wi) => {
    const row = rows[rowAt(rows, w.startBeat)];
    if (row.kind !== "bars") return;
    row.words = row.words ? [row.words[0], wi] : [wi, wi];
  });
}
