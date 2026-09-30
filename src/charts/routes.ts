/**
 * The relay's chart endpoints, all for the current song.
 *
 *   GET /charts/channels                          the channels the song offers
 *   GET /charts/rows?channels=a,b[&barsPerRow=n]  rows for those channels
 *   GET /charts/chords                            the song's chords on the timeline
 *   GET /charts/source/<chart-id>                 the score file behind a chart
 *
 * Rows are built on each request from the song's lyrics display and its
 * charts file, so any channel set works and a display can switch channels
 * mid-song. A song without a charts file still gets its text rows.
 */

import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { LyricsDisplay } from "../teleprompter/lyrics-display.js";
import type { SongSection } from "./bar-map.js";
import type { ChartsFile } from "./build.js";
import { parseChannelParam, resolveChannels, songChannels } from "./channels.js";
import { buildRows, type RowInput } from "./rows.js";

export interface ChartsCurrent {
  slug: string;
  display: LyricsDisplay;
  /** The song's built charts file, or null if it has none. */
  charts: ChartsFile | null;
  /** Folder the chart source paths are relative to. */
  songDir: string;
}

export interface ChartRoutesOptions {
  /** The current song, looked up per request (the charts file can change on disk). */
  current: () => ChartsCurrent | null | Promise<ChartsCurrent | null>;
}

const DEFAULT_BARS_PER_ROW = 4;
const MAX_BARS_PER_ROW = 16;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * Sections from the lyrics display, for a song with no charts file. The
 * display gives each section's start and bar count; the meter is the song's.
 */
function displaySections(display: LyricsDisplay): SongSection[] {
  const beatsPerBar = display.timeSignature[0];
  const seen = new Map<string, number>();
  let firstBar = 1;
  return display.display.sections.map((s, i, all) => {
    const next = all[i + 1]?.startBeat;
    const bars = s.bars ?? (next !== undefined ? (next - s.startBeat) / beatsPerBar : 1);
    const occurrence = (seen.get(s.name) ?? 0) + 1;
    seen.set(s.name, occurrence);
    const placed = { name: s.name, bars, occurrence, firstBar, startBeat: s.startBeat, beatsPerBar };
    firstBar += bars;
    return placed;
  });
}

function rowInput(cur: ChartsCurrent): RowInput {
  return {
    sections: cur.charts?.sections ?? displaySections(cur.display),
    words: cur.display.words,
    lines: cur.display.display.lines,
    charts: Object.fromEntries((cur.charts?.charts ?? []).map((c) => [c.id, c.bars])),
  };
}

function channelsOf(cur: ChartsCurrent) {
  return songChannels({
    hasLyrics: cur.display.words.length > 0,
    hasChords: cur.charts?.chords !== undefined,
    charts: cur.charts?.charts ?? [],
  });
}

/** Returns a handler that answers /charts/* and returns false for anything else. */
export function createChartRoutes(opts: ChartRoutesOptions) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://relay");
    if (!url.pathname.startsWith("/charts/")) return false;
    const cur = await opts.current();
    if (!cur) {
      json(res, 404, { error: "no current song" });
      return true;
    }

    if (url.pathname === "/charts/channels") {
      json(res, 200, { slug: cur.slug, channels: channelsOf(cur) });
      return true;
    }

    if (url.pathname === "/charts/rows") {
      const raw = url.searchParams.get("barsPerRow");
      const barsPerRow = raw === null ? DEFAULT_BARS_PER_ROW : Number(raw);
      if (!Number.isInteger(barsPerRow) || barsPerRow < 1 || barsPerRow > MAX_BARS_PER_ROW) {
        json(res, 400, { error: `barsPerRow must be a whole number from 1 to ${MAX_BARS_PER_ROW}` });
        return true;
      }
      const { channels, unknown } = resolveChannels(parseChannelParam(url.searchParams.get("channels")), channelsOf(cur));
      try {
        const rows = buildRows(rowInput(cur), channels, { barsPerRow });
        json(res, 200, { slug: cur.slug, channels, unknown, rows });
      } catch (err) {
        json(res, 500, { error: (err as Error).message });
      }
      return true;
    }

    if (url.pathname === "/charts/chords") {
      if (!cur.charts?.chords) json(res, 404, { error: "the song has no chord file" });
      else json(res, 200, { slug: cur.slug, chords: cur.charts.chords });
      return true;
    }

    const source = /^\/charts\/source\/([^/]+)$/.exec(url.pathname);
    if (source) {
      // The id only selects a chart; the path comes from the charts file.
      const chart = cur.charts?.charts.find((c) => c.id === decodeURIComponent(source[1]));
      if (!chart) {
        json(res, 404, { error: "no such chart" });
        return true;
      }
      try {
        const bytes = await readFile(join(cur.songDir, chart.source));
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" });
        res.end(bytes);
      } catch {
        json(res, 404, { error: `score file ${chart.source} is missing` });
      }
      return true;
    }

    json(res, 404, { error: "unknown charts endpoint" });
    return true;
  };
}
