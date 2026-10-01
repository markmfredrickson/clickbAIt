import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createEinkRoutes, parseView, type EinkRenderer, type EinkCurrent } from "../../src/teleprompter/eink/routes.js";
import type { LyricsDisplay } from "../../src/teleprompter/lyrics-display.js";
import type { RowDocument } from "../../src/teleprompter/rows.js";

const SONG: LyricsDisplay = {
  schema: "clickbait/lyrics-display@1",
  title: "Test Song",
  bpm: 120,
  timeSignature: [4, 4],
  slug: "test-song",
  curve: [{ t: 0, b: 0 }, { t: 0.5, b: 1 }],
  words: [{ text: "w", startBeat: 1, endBeat: 2 }],
  display: { sections: [{ name: "Verse", startBeat: 0 }], lines: [{ words: [0, 0], section: "Verse" }] },
};

const ROWS: RowDocument = {
  schema: "clickbait/rows@1",
  slug: "test-song",
  title: "Test Song",
  sections: [{ name: "Verse", start: 0, end: 4, bars: 1, beatsPerBar: 4 }],
  channels: [
    { id: "lyrics", kind: "lyrics", rows: [{ start: 1, end: 2.5, items: [{ text: "w", start: 1, end: 2.5 }] }] },
    { id: "chords", kind: "chords", rows: [{ section: 0, start: 0, end: 4, bars: [{ start: 0, end: 4 }], items: [{ chord: "A", start: 0, end: 4 }] }] },
    { id: "kit", kind: "figures", chart: "drums", instrument: "drums", source: "song.gp5", track: 3, rows: [{ type: "figures", section: 0, start: 0, end: 4, items: [] }] },
  ],
};

let cacheDir: string;
let server: Server;
let base: string;
let current: EinkCurrent | null;
let renders: number;
let rendered: { channels: string[]; rows: unknown }[];
let cards: unknown[];

/** Stands in for headless Chrome: one page per pane, one mark, a placeholder PNG. */
const fakeRender: EinkRenderer = async (doc, _size, outDir, opts) => {
  renders++;
  rendered.push({ channels: doc.channels.map((c) => c.id), rows: opts.rows });
  const panes = doc.channels.map((c, i) => {
    writeFileSync(join(outDir, `${i}-0.png`), "png");
    return { id: c.id, kind: c.kind, title: c.id, top: i * 100, height: 100, pages: [{ start: 0, file: `${i}-0.png`, marks: [{ start: 1, end: 2, x: 0, y: 10, w: 50, h: 20 }] }] };
  });
  cards.push(opts.card);
  if (!doc.card) return { panes, card: null };
  writeFileSync(join(outDir, "card.png"), "png");
  return { panes, card: "card.png" };
};

beforeEach(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), "eink-test-"));
  current = { slug: "test-song", song: SONG, version: "1", rows: ROWS };
  renders = 0;
  rendered = [];
  cards = [];
  const handle = createEinkRoutes({ current: () => current, render: fakeRender, cacheDir });
  server = createServer(async (req, res) => {
    if (!(await handle(req, res))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  rmSync(cacheDir, { recursive: true, force: true });
});

const deck = (q = "") => fetch(`${base}/eink/deck?w=993&h=1216&dpr=2${q}`);

describe("GET /eink/deck", () => {
  it("returns the current song's panes with fetchable page images", async () => {
    const res = await deck();
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({ slug: "test-song", width: 993, height: 1216 });
    expect(d.panes).toHaveLength(1);
    expect(d.panes[0]).toMatchObject({ id: "lyrics", top: 0, height: 100 });
    expect(d.panes[0].pages[0]).toMatchObject({ start: 0, marks: [{ start: 1, end: 2, y: 10 }] });
    const img = await fetch(base + d.panes[0].pages[0].src);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
  });

  it("renders a size once and reuses it", async () => {
    await deck();
    await deck();
    expect(renders).toBe(1);
    await fetch(`${base}/eink/deck?w=600&h=800&dpr=1`);
    expect(renders).toBe(2);
  });

  it("re-renders when the song changes", async () => {
    await deck();
    current = { ...current!, version: "2" };
    await deck();
    expect(renders).toBe(2);
  });

  it("answers 404 when no song is loaded", async () => {
    current = null;
    expect((await deck()).status).toBe(404);
  });

  it("answers 404 for a legacy song payload instead of crashing", async () => {
    current = { slug: "old", song: { title: "Old", bpm: 100, sections: [] }, version: "1", rows: null };
    expect((await deck()).status).toBe(404);
  });

  it("rejects a size outside a sane range", async () => {
    expect((await fetch(`${base}/eink/deck?w=5&h=1216&dpr=2`)).status).toBe(400);
    expect((await fetch(`${base}/eink/deck?w=993&h=99999&dpr=2`)).status).toBe(400);
    expect((await fetch(`${base}/eink/deck?w=993&h=1216&dpr=9`)).status).toBe(400);
  });
});

describe("GET /eink/deck — panes", () => {
  it("renders the channels asked for as panes, in that order", async () => {
    await deck("&channels=drums,lyrics");
    expect(rendered).toEqual([{ channels: ["kit", "lyrics"], rows: {} }]);
  });

  it("passes the rows asked for each pane", async () => {
    await deck("&channels=chords,lyrics&chords.rows=2&drums.rows=4");
    expect(rendered[0].rows).toEqual({ chords: 2 });
  });

  it("renders each view as its own deck", async () => {
    await deck("&channels=lyrics");
    await deck("&channels=chords,lyrics");
    await deck("&channels=chords,lyrics");
    await deck("&channels=lyrics,chords");
    expect(renders).toBe(3);
  });
});

describe("GET /eink/deck — the card", () => {
  it("carries the card's image and when it goes away, for rows that have a card", async () => {
    current = { ...current!, rows: { ...ROWS, card: { startBeat: -8, notes: [], figures: {}, opening: {} } } };
    const d = await (await deck()).json();
    expect(d.card).toMatchObject({ startBeat: -8 });
    expect((await fetch(base + d.card.src)).status).toBe(200);
  });

  it("tells the renderer the song's facts and the screen's role", async () => {
    await deck("&role=Guitar");
    expect(cards).toEqual([{ song: { title: "Test Song", bpm: 120 }, role: "guitar" }]);
  });

  it("has no card for rows without one", async () => {
    expect((await (await deck()).json()).card).toBeUndefined();
  });
});

describe("parseView", () => {
  const q = (s: string) => new URLSearchParams(s);

  it("shows lyrics alone unless the page asks for more", () => {
    expect(parseView(q(""), ROWS)).toEqual({ channels: ["lyrics"], rows: {} });
  });

  it("takes a channel by id or by instrument, and leaves out what the song lacks", () => {
    expect(parseView(q("channels=drums,tab,chords"), ROWS).channels).toEqual(["kit", "chords"]);
  });

  it("reads rows by the name used, as whole numbers from 1 to 50", () => {
    expect(parseView(q("channels=drums,lyrics&drums.rows=3&lyrics.rows=0"), ROWS).rows).toEqual({ kit: 3 });
  });
});

describe("GET /eink/pages", () => {
  it("serves nothing outside the cache directory", async () => {
    writeFileSync(join(cacheDir, "..", "secret.png"), "x");
    expect((await fetch(`${base}/eink/pages/..%2Fsecret.png`)).status).toBe(404);
    expect((await fetch(`${base}/eink/pages/abc/../../secret.png`)).status).toBe(404);
  });
});

describe("routing", () => {
  it("leaves other paths to the relay", async () => {
    expect((await fetch(`${base}/lyrics`)).status).toBe(404); // fell through to the test server's 404
  });
});
