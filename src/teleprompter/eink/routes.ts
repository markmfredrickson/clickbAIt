/**
 * The relay's e-ink endpoints.
 *
 *   GET /eink/deck?w=&h=&dpr=[&font=][&channels=lyrics,chords]
 *                                      page table for the current song at that size
 *   GET /eink/pages/<key>/<n>.png      a rendered page
 *
 * The client page itself (/eink) is a static file in the client directory.
 * Beats reach e-ink clients over the relay's normal WebSocket, like every
 * other client, and each client picks its own page (layout.ts).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { LyricsDisplay } from "../lyrics-display.js";
import type { EinkChords, Page } from "./layout.js";
import type { RenderSize } from "./render.js";

/** The relay's current song. `version` changes whenever the file does. */
export interface EinkCurrent {
  slug: string;
  song: unknown;
  version: string;
  /** The song's chords, when it has a chord file. */
  chords?: EinkChords | null;
}

/** What a deck shows. */
export interface EinkDeckView {
  lyrics: boolean;
  chords: EinkChords | null;
}

/** Renders `song` into `outDir/<n>.png` and returns the page table. */
export type EinkRenderer = (song: LyricsDisplay, size: RenderSize, outDir: string, view: EinkDeckView) => Promise<Page[]>;

export interface EinkRoutesOptions {
  current: () => EinkCurrent | null;
  render: EinkRenderer;
  /** Where rendered decks are kept, one folder per song × size. */
  cacheDir: string;
}

interface Deck {
  slug: string;
  key: string;
  width: number;
  height: number;
  beatsPerBar: number;
  pages: (Page & { src: string })[];
}

// Bump when the page design changes, so cached decks are re-rendered.
const RENDER_VERSION = 8;

function isLyricsDisplay(song: unknown): song is LyricsDisplay {
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
 * The channels a page asks for (`channels=lyrics,chords`; lyrics alone by
 * default). Chords are shown only when the song has them.
 */
function parseView(q: URLSearchParams, cur: EinkCurrent): EinkDeckView {
  const asked = q.get("channels");
  const channels = asked === null ? ["lyrics"] : asked.split(",").map((c) => c.trim());
  return {
    lyrics: channels.includes("lyrics"),
    chords: channels.includes("chords") && cur.chords ? cur.chords : null,
  };
}

/** Returns a handler that answers e-ink requests and returns false for anything else. */
export function createEinkRoutes(opts: EinkRoutesOptions): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const inFlight = new Map<string, Promise<Deck>>();

  async function deckFor(cur: EinkCurrent, song: LyricsDisplay, size: RenderSize, view: EinkDeckView): Promise<Deck> {
    // The chords themselves are in the key, so an edited chord file re-renders.
    const key = createHash("sha1")
      .update(JSON.stringify([RENDER_VERSION, cur.slug, cur.version, size, view]))
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
          const pages = await opts.render(song, size, dir, view);
          const deck: Deck = {
            slug: cur.slug,
            key,
            width: size.width,
            height: size.height,
            beatsPerBar: song.timeSignature?.[0] ?? 4,
            pages: pages.map((p, i) => ({ ...p, src: `/eink/pages/${key}/${i}.png` })),
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
      if (!isLyricsDisplay(cur.song)) {
        json(res, 404, { error: "e-ink needs a built lyrics-display song" });
        return true;
      }
      const size = parseSize(url.searchParams);
      if (!size) {
        json(res, 400, { error: "bad size" });
        return true;
      }
      try {
        json(res, 200, await deckFor(cur, cur.song, size, parseView(url.searchParams, cur)));
      } catch (err) {
        console.error(`  ✗ e-ink render failed: ${err instanceof Error ? err.message : err}`);
        json(res, 500, { error: "render failed" });
      }
      return true;
    }

    // Key and file name are matched exactly, so no path can leave the cache.
    const m = url.pathname.match(/^\/eink\/pages\/([0-9a-f]{16})\/(\d+)\.png$/);
    if (m) {
      const file = join(opts.cacheDir, m[1], `${m[2]}.png`);
      if (!existsSync(file)) {
        res.writeHead(404);
        res.end();
        return true;
      }
      // A key names one song version at one size, so its pages never change.
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
