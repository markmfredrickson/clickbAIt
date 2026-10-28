import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPanes, chromeAvailable } from "../../src/teleprompter/eink/render.js";
import { buildClient } from "../../src/teleprompter/build-client.js";
import { buildRows } from "../../src/teleprompter/build-rows.js";
import type { FigureRow, RowDocument } from "../../src/teleprompter/rows.js";

// Real headless-Chrome render. Skipped on machines without Chrome.
const hasChrome = await chromeAvailable();

/** Placeholder lines over 16 bars, with chords: more than fits on one page. */
function song() {
  const words = Array.from({ length: 30 }, (_, i) => ({
    text: `line ${i} with a few more placeholder words`,
    startBeat: 2 + i * 2,
    endBeat: 3 + i * 2,
  }));
  return buildRows({
    slug: "render-test",
    title: "Render Test",
    song: { timeSignature: [4, 4], sections: [{ name: "Verse", bars: 8 }, { name: "Chorus", bars: 8 }] },
    lyrics: { words, lines: words.map((_, i) => ({ words: [i, i] as [number, number] })) },
    chords: Array.from({ length: 16 }, (_, i) => ({ chord: ["A", "D", "E", "F#m"][i % 4], beat: i * 4 })),
  });
}

/**
 * A drum part over 8 bars: a four-bar figure twice, drawn wide enough that it
 * can't sit on one line, beside the song's lyrics.
 */
function drums(): RowDocument {
  const doc = song();
  const run = (start: number, scoreBars: number[], count: number) => ({
    scoreBars,
    barBeats: scoreBars.map(() => 4),
    count,
    phraseBeats: scoreBars.length * 4,
    songBar: start / 4 + 1,
    start,
    end: start + scoreBars.length * 4 * count,
  });
  const rows: FigureRow[] = [{ type: "figures", section: 0, start: 0, end: 32, items: [run(0, [1, 2, 3, 4], 2)] }];
  const bar = (x: number) => `<rect x="${x}" y="0" width="290" height="100" fill="currentColor" />`;
  const drawing = { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1200px" height="100px">${[0, 300, 600, 900].map(bar).join("")}</svg>`, width: 1200, height: 100, bars: [0, 300, 600, 900].map((x) => ({ x, w: 300 })) };
  return {
    ...doc,
    channels: [doc.channels[0], { id: "drums", kind: "figures", instrument: "drums", chart: "drums", source: "s.gp", track: 0, rows }],
    notation: { drums: { "1+4": drawing } },
  };
}

const outDir = mkdtempSync(join(tmpdir(), "eink-render-"));
beforeAll(() => buildClient());
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe.skipIf(!hasChrome)("renderPanes (headless Chrome)", () => {
  const size = { width: 500, height: 700, dpr: 2 };

  it("stacks the panes in order and fits them on the screen", async () => {
    const { panes } = await renderPanes(song(), size, outDir, { rows: { chords: 2 } });
    expect(panes.map((p) => p.id)).toEqual(["lyrics", "chords"]);
    expect(panes[0].top).toBe(0);
    expect(panes[1].top).toBe(panes[0].height);
    expect(panes[1].top + panes[1].height).toBeLessThanOrEqual(size.height);
  }, 60_000);

  it("lights each line of lyrics and each bar of chords, inside its pane", async () => {
    const {
      panes: [lyrics, chords],
    } = await renderPanes(song(), size, outDir, { rows: { lyrics: 4, chords: 2 } });
    // Pages overlap by a row, so each line after the first page's appears twice.
    const lines = lyrics.pages.flatMap((p) => p.marks.map((m) => m.start));
    expect(new Set(lines).size).toBe(30);
    expect(lyrics.pages[1].marks[0].start).toBe(lyrics.pages[0].marks[3].start);
    expect(chords.pages[0].marks).toHaveLength(8); // two rows of four bars
    for (const pane of [lyrics, chords]) {
      for (const p of pane.pages) for (const m of p.marks) expect(m.y + m.h).toBeLessThanOrEqual(pane.height + 1);
    }
  }, 60_000);

  it("writes each page at the pane's size in device pixels", async () => {
    const { panes } = await renderPanes(song(), size, outDir, { rows: { chords: 2 } });
    for (const pane of panes) {
      const png = readFileSync(join(outDir, pane.pages[0].file));
      // IHDR width/height live at bytes 16–23.
      expect(png.readUInt32BE(16)).toBe(size.width * size.dpr);
      expect(png.readUInt32BE(20)).toBe(pane.height * size.dpr);
    }
  }, 60_000);

  it("draws the card before the song as a page of its own, the full screen", async () => {
    const doc = { ...song(), card: { startBeat: -8, notes: [{ for: "all", text: "Count in 1-2-3-4" }], figures: {}, opening: {} } };
    const { card } = await renderPanes(doc, size, outDir, { card: { song: { title: "Render Test", key: "A", bpm: 120 } } });
    expect(card).toBe("card.png");
    const png = readFileSync(join(outDir, card!));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size.width * size.dpr, size.height * size.dpr]);
  }, 60_000);

  it("draws no card when the rows have none", async () => {
    expect((await renderPanes(song(), size, outDir, { card: { song: { title: "Render Test" } } })).card).toBeNull();
  }, 60_000);

  it("wraps a figure too wide for a line and keeps its pane inside the screen, a box on each bar", async () => {
    const { panes } = await renderPanes(drums(), size, outDir);
    const pane = panes.find((p) => p.id === "drums")!;
    expect(pane.top + pane.height).toBeLessThanOrEqual(size.height);
    const run = pane.pages[0].marks[0];
    expect(run.bars).toHaveLength(4);
    expect(run.barBeats).toEqual([4, 4, 4, 4]);
    for (const b of [run, ...run.bars!]) {
      expect(b.x + b.w).toBeLessThanOrEqual(size.width + 1);
      expect(b.y + b.h).toBeLessThanOrEqual(pane.height + 1);
    }
    // Wrapped: the bars sit on more than one line.
    expect(new Set(run.bars!.map((b) => Math.round(b.y))).size).toBeGreaterThan(1);
  }, 60_000);

  it("draws the notes the same size upright and sideways; only the flow changes", async () => {
    // The drums alone, so the pane has room for its tallest run either way.
    const alone = () => ({ ...drums(), channels: drums().channels.filter((c) => c.id === "drums") });
    const upright = (await renderPanes(alone(), { width: 500, height: 700, dpr: 1 }, outDir)).panes[0];
    const sideways = (await renderPanes(alone(), { width: 700, height: 500, dpr: 1 }, outDir)).panes[0];
    const barHeight = (p: typeof upright) => Math.round(p.pages[0].marks[0].bars![0].h);
    expect(barHeight(sideways)).toBe(barHeight(upright));
  }, 60_000);
});
