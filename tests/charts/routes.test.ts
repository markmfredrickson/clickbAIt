import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createChartRoutes, type ChartsCurrent } from "../../src/charts/routes.js";
import { songSections, type MappedBar } from "../../src/charts/bar-map.js";
import type { ChartsFile } from "../../src/charts/build.js";
import type { LyricsDisplay } from "../../src/teleprompter/lyrics-display.js";

// Intro (2 bars, instrumental) then Verse (2 bars, one line).
const DISPLAY: LyricsDisplay = {
  schema: "clickbait/lyrics-display@1",
  title: "Test Song",
  bpm: 120,
  timeSignature: [4, 4],
  slug: "test-song",
  curve: [{ t: 0, b: 0 }, { t: 0.5, b: 1 }],
  words: [{ text: "a", startBeat: 8, endBeat: 9 }, { text: "b", startBeat: 12, endBeat: 13 }],
  display: {
    sections: [{ name: "Intro", startBeat: 0, bars: 2 }, { name: "Verse", startBeat: 8, bars: 2 }],
    lines: [{ words: [0, 1], section: "Verse", sectionIndex: 1 }],
  },
};
const SECTIONS = songSections([{ name: "Intro", bars: 2 }, { name: "Verse", bars: 2 }], [4, 4]);
const bars = (scoreBars: (number | null)[]): MappedBar[] =>
  scoreBars.map((scoreBar, i) => ({ songBar: i + 1, section: i < 2 ? 0 : 1, startBeat: i * 4, beats: 4, scoreBar }));
const CHARTS: ChartsFile = {
  schema: "clickbait/charts@1",
  slug: "test-song",
  sections: SECTIONS,
  charts: [
    { id: "rhythm-guitar", kind: "tab", instrument: "guitar", style: "chart", score: "ug", source: "song.gp5", track: 2, trackName: "Rhythm", bars: bars([1, 2, 3, 4]) },
    { id: "bass", kind: "tab", instrument: "bass", style: "chart", score: "ug", source: "song.gp5", track: 3, trackName: "Bass", bars: bars([null, null, 3, 4]) },
  ],
};

let songDir: string;
let server: Server;
let base: string;
let current: ChartsCurrent | null;

beforeEach(async () => {
  songDir = mkdtempSync(join(tmpdir(), "charts-test-"));
  writeFileSync(join(songDir, "song.gp5"), "score bytes");
  current = { slug: "test-song", display: DISPLAY, charts: CHARTS, songDir };
  const handle = createChartRoutes({ current: () => current });
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
  rmSync(songDir, { recursive: true, force: true });
});

const get = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
};

describe("GET /charts/channels", () => {
  it("lists the current song's channels", async () => {
    const { body } = await get("/charts/channels");
    expect(body.slug).toBe("test-song");
    expect(body.channels.map((c: { id: string }) => c.id)).toEqual(["sections", "lyrics", "rhythm-guitar", "bass"]);
  });

  it("lists only the built-in channels for a song with no charts file", async () => {
    current = { ...current!, charts: null };
    const { body } = await get("/charts/channels");
    expect(body.channels.map((c: { id: string }) => c.id)).toEqual(["sections", "lyrics"]);
  });

  it("is a 404 with no current song", async () => {
    current = null;
    expect((await get("/charts/channels")).status).toBe(404);
  });
});

describe("GET /charts/source/<id>", () => {
  it("serves the score file behind a chart", async () => {
    const res = await fetch(`${base}/charts/source/rhythm-guitar`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("score bytes");
  });

  it("is a 404 for a chart the song doesn't have, and never reads a path from the URL", async () => {
    expect((await fetch(`${base}/charts/source/keys`)).status).toBe(404);
    expect((await fetch(`${base}/charts/source/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
  });
});

describe("chords", () => {
  const CHORDS = [{ chord: "A", beat: 0 }, { chord: "D", beat: 8 }];

  it("lists the chords channel after lyrics when the charts file has chords", async () => {
    current = { ...current!, charts: { ...CHARTS, chords: CHORDS } };
    const { body } = await get("/charts/channels");
    expect(body.channels.map((c: { id: string }) => c.id)).toEqual(["sections", "lyrics", "chords", "rhythm-guitar", "bass"]);
  });

});

describe("GET /charts/chart/<id>", () => {
  it("serves one chart from the charts file", async () => {
    const { status, body } = await get("/charts/chart/bass");
    expect(status).toBe(200);
    expect(body.slug).toBe("test-song");
    expect(body.chart).toMatchObject({ id: "bass", track: 3, source: "song.gp5" });
  });

  it("is a 404 for a chart the song doesn't have", async () => {
    expect((await get("/charts/chart/keys")).status).toBe(404);
  });
});
