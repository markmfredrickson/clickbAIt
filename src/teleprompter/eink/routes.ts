/**
 * The relay's e-ink endpoints.
 *
 *   GET /eink/deck?w=&h=&dpr=[&font=][&channels=drums,lyrics][&<channel>.rows=N]
 *                                      the current song's panes at that size
 *   GET /eink/pages/<key>/<file>.png   a rendered page
 *
 * The client page itself (/eink) is a static file in the client directory.
 * Beats reach e-ink clients over the relay's normal WebSocket, like every
 * other client, and each client turns its own panes (layout.ts).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { RowDocument } from "../rows.js";
import { selectChannels } from "../rows.js";
import type { EinkDeck } from "./layout.js";
import type { RenderOptions, RenderSize, RenderedPane } from "./render.js";

/** The relay's current song. `version` changes whenever its files do. */
export interface EinkCurrent {
  slug: string;
  /** Its lyrics display (only a built one can be shown). */
  song: unknown;
  version: string;
  rows: RowDocument | null;
  /** A score file's bytes, by its path in the rows document. */
  readSource?: (path: string) => Uint8Array | null;
}

/** What a deck shows: channel ids in pane order, and rows asked for per pane. */
export interface EinkView {
  channels: string[];
  rows: Record<string, number>;
}

/** Renders `doc`'s channels into `outDir` and returns the panes. */
export type EinkRenderer = (doc: RowDocument, size: RenderSize, outDir: string, opts: RenderOptions) => Promise<RenderedPane[]>;

export interface EinkRoutesOptions {
  current: () => EinkCurrent | null;
  render: EinkRenderer;
  /** Where rendered decks are kept, one folder per song × size × view. */
  cacheDir: string;
}

// Bump when the page design changes, so cached decks are re-rendered.
const RENDER_VERSION = 9;

const MAX_ROWS = 50;

function isLyricsDisplay(song: unknown): boolean {
  return !!song && typeof song === "object" && (song as { schema?: string }).schema === "clickbait/lyrics-display@1";
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Parse and bound the requested size; null if it isn't plausible. */
function parseSize(q: URLSearchParams): RenderSize | null {
  const width = Math.round(Number(q.get("w")));
  const height = Math.round(Number(q.get("h")));
  const dpr = Number(q.get("dpr") ?? 1);
  const font = q.get("font") ? Math.round(Number(q.get("font"))) : undefined;
  const ok = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;
  if (!ok(width, 200, 4000) || !ok(height, 200, 4000) || !ok(dpr, 0.5, 4)) return null;
  if (font !== undefined && !ok(font, 8, 200)) return null;
  return { width, height, dpr, ...(font !== undefined ? { fontPx: font } : {}) };
}

/**
 * The panes a page asks for (`channels=drums,lyrics`, each an id or an
 * instrument; lyrics alone by default), in that order, and the rows asked
 * for each (`lyrics.rows=6`, by the name used). Channels the song doesn't
 * have are left out.
 */
export function parseView(q: URLSearchParams, doc: RowDocument): EinkView {
  const asked = q.get("channels");
  const names = asked === null ? ["lyrics"] : asked.split(",").map((c) => c.trim()).filter(Boolean);
  const channels: string[] = [];
  const rows: Record<string, number> = {};
  for (const name of names) {
    for (const c of doc.channels) {
      const match = c.id === name || (c.kind === "drums" && c.instrument === name);
      if (!match || channels.includes(c.id)) continue;
      channels.push(c.id);
      const n = Number(q.get(`${name}.rows`) ?? q.get(`${c.id}.rows`) ?? NaN);
      if (Number.isInteger(n) && n >= 1 && n <= MAX_ROWS) rows[c.id] = n;
    }
  }
  return { channels, rows };
}

/** Returns a handler that answers e-ink requests and returns false for anything else. */
export function createEinkRoutes(opts: EinkRoutesOptions): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const inFlight = new Map<string, Promise<EinkDeck>>();

  async function deckFor(cur: EinkCurrent, doc: RowDocument, size: RenderSize, view: EinkView): Promise<EinkDeck> {
    const shown = selectChannels(doc, view.channels);
    // The rows themselves are in the key, so an edited chord file re-renders.
    const key = createHash("sha1")
      .update(JSON.stringify([RENDER_VERSION, cur.slug, cur.version, size, view, shown]))
      .digest("hex")
      .slice(0, 16);
    const dir = join(opts.cacheDir, key);
    const table = join(dir, "deck.json");
    if (existsSync(table)) return JSON.parse(readFileSync(table, "utf8"));
    if (!inFlight.has(key)) {
      inFlight.set(
        key,
        (async () => {
          mkdirSync(dir, { recursive: true });
          const panes = await opts.render(shown, size, dir, { rows: view.rows, ...(cur.readSource ? { readSource: cur.readSource } : {}) });
          const deck: EinkDeck = {
            slug: cur.slug,
            key,
            width: size.width,
            height: size.height,
            panes: panes.map((p) => ({
              ...p,
              pages: p.pages.map(({ file, ...page }) => ({ ...page, src: `/eink/pages/${key}/${file}` })),
            })),
          };
          writeFileSync(table, JSON.stringify(deck));
          return deck;
        })().finally(() => inFlight.delete(key)),
      );
    }
    return inFlight.get(key)!;
  }

  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://relay");

    if (url.pathname === "/eink/deck") {
      const cur = opts.current();
      if (!cur) {
        json(res, 404, { error: "no song loaded" });
        return true;
      }
      if (!isLyricsDisplay(cur.song) || !cur.rows) {
        json(res, 404, { error: "e-ink needs a built lyrics-display song" });
        return true;
      }
      const size = parseSize(url.searchParams);
      if (!size) {
        json(res, 400, { error: "bad size" });
        return true;
      }
      try {
        json(res, 200, await deckFor(cur, cur.rows, size, parseView(url.searchParams, cur.rows)));
      } catch (err) {
        console.error(`  ✗ e-ink render failed: ${err instanceof Error ? err.message : err}`);
        json(res, 500, { error: "render failed" });
      }
      return true;
    }

    // Key and file name are matched exactly, so no path can leave the cache.
    const m = url.pathname.match(/^\/eink\/pages\/([0-9a-f]{16})\/(\d+-\d+)\.png$/);
    if (m) {
      const file = join(opts.cacheDir, m[1], `${m[2]}.png`);
      if (!existsSync(file)) {
        res.writeHead(404);
        res.end();
        return true;
      }
      // A key names one song version at one size and view, so its pages never change.
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=31536000, immutable" });
      res.end(readFileSync(file));
      return true;
    }
    if (url.pathname.startsWith("/eink/pages/")) {
      res.writeHead(404);
      res.end();
      return true;
    }

    return false;
  };
}
