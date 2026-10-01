/**
 * The relay's chart endpoints, all for the current song.
 *
 *   GET /charts/channels            the channels the song offers
 *   GET /charts/chart/<chart-id>    one chart: its bars, and a chart-style part's figures
 *   GET /charts/source/<chart-id>   the score file behind a chart
 *
 * What displays show comes from the song's row document (the relay's
 * /rows.json); these are the charts behind it.
 */

import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { LyricsDisplay } from "../teleprompter/lyrics-display.js";
import type { ChartsFile } from "./build.js";
import { songChannels } from "./channels.js";

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

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
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

    const one = /^\/charts\/chart\/([^/]+)$/.exec(url.pathname);
    if (one) {
      const chart = cur.charts?.charts.find((c) => c.id === decodeURIComponent(one[1]));
      if (!chart) json(res, 404, { error: "no such chart" });
      else json(res, 200, { slug: cur.slug, chart });
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
