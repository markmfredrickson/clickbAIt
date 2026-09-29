import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createEinkRoutes, type EinkRenderer, type EinkCurrent } from "../../src/teleprompter/eink/routes.js";
import type { LyricsDisplay } from "../../src/teleprompter/lyrics-display.js";

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

let cacheDir: string;
let server: Server;
let base: string;
let current: EinkCurrent | null;
let renders: number;

/** Stands in for headless Chrome: one page, one line, a placeholder PNG. */
const fakeRender: EinkRenderer = async (_song, _size, outDir) => {
  renders++;
  writeFileSync(join(outDir, "0.png"), "png");
  return [{ startBeat: 0, lines: [{ beat: 1, y: 10, h: 20 }] }];
};

beforeEach(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), "eink-test-"));
  current = { slug: "test-song", song: SONG, version: "1" };
  renders = 0;
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

describe("GET /eink/deck", () => {
  it("returns the current song's page table with fetchable page images", async () => {
    const res = await fetch(`${base}/eink/deck?w=993&h=1216&dpr=2`);
    expect(res.status).toBe(200);
    const deck = await res.json();
    expect(deck).toMatchObject({ slug: "test-song", width: 993, height: 1216, beatsPerBar: 4 });
    expect(deck.pages).toHaveLength(1);
    expect(deck.pages[0]).toMatchObject({ startBeat: 0, lines: [{ beat: 1, y: 10, h: 20 }] });
    const img = await fetch(base + deck.pages[0].src);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
  });

  it("renders a size once and reuses it", async () => {
    await fetch(`${base}/eink/deck?w=993&h=1216&dpr=2`);
    await fetch(`${base}/eink/deck?w=993&h=1216&dpr=2`);
    expect(renders).toBe(1);
    await fetch(`${base}/eink/deck?w=600&h=800&dpr=1`);
    expect(renders).toBe(2);
  });

  it("re-renders when the song file changes", async () => {
    await fetch(`${base}/eink/deck?w=993&h=1216&dpr=2`);
    current = { ...current!, version: "2" };
    await fetch(`${base}/eink/deck?w=993&h=1216&dpr=2`);
    expect(renders).toBe(2);
  });

  it("answers 404 when no song is loaded", async () => {
    current = null;
    expect((await fetch(`${base}/eink/deck?w=993&h=1216&dpr=2`)).status).toBe(404);
  });

  it("answers 404 for a legacy song payload instead of crashing", async () => {
    current = { slug: "old", song: { title: "Old", bpm: 100, sections: [] }, version: "1" };
    expect((await fetch(`${base}/eink/deck?w=993&h=1216&dpr=2`)).status).toBe(404);
  });

  it("rejects a size outside a sane range", async () => {
    expect((await fetch(`${base}/eink/deck?w=5&h=1216&dpr=2`)).status).toBe(400);
    expect((await fetch(`${base}/eink/deck?w=993&h=99999&dpr=2`)).status).toBe(400);
    expect((await fetch(`${base}/eink/deck?w=993&h=1216&dpr=9`)).status).toBe(400);
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
