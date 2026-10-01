import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPanes, chromeAvailable } from "../../src/teleprompter/eink/render.js";
import { buildClient } from "../../src/teleprompter/build-client.js";
import { buildRows } from "../../src/teleprompter/build-rows.js";

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

const outDir = mkdtempSync(join(tmpdir(), "eink-render-"));
beforeAll(() => buildClient());
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe.skipIf(!hasChrome)("renderPanes (headless Chrome)", () => {
  const size = { width: 500, height: 700, dpr: 2 };

  it("stacks the panes in order and fits them on the screen", async () => {
    const panes = await renderPanes(song(), size, outDir, { rows: { chords: 2 } });
    expect(panes.map((p) => p.id)).toEqual(["lyrics", "chords"]);
    expect(panes[0].top).toBe(0);
    expect(panes[1].top).toBe(panes[0].height);
    expect(panes[1].top + panes[1].height).toBeLessThanOrEqual(size.height);
  }, 60_000);

  it("lights each line of lyrics and each bar of chords, inside its pane", async () => {
    const [lyrics, chords] = await renderPanes(song(), size, outDir, { rows: { lyrics: 4, chords: 2 } });
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
    const panes = await renderPanes(song(), size, outDir, { rows: { chords: 2 } });
    for (const pane of panes) {
      const png = readFileSync(join(outDir, pane.pages[0].file));
      // IHDR width/height live at bytes 16–23.
      expect(png.readUInt32BE(16)).toBe(size.width * size.dpr);
      expect(png.readUInt32BE(20)).toBe(pane.height * size.dpr);
    }
  }, 60_000);
});
