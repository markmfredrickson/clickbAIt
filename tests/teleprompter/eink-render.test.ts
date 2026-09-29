import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPages, chromeAvailable } from "../../src/teleprompter/eink/render.js";
import type { LyricsDisplay } from "../../src/teleprompter/lyrics-display.js";

// Real headless-Chrome render. Skipped on machines without Chrome.
const hasChrome = await chromeAvailable();

/** Enough placeholder lines (in 3 sections) to need several pages at this size. */
function longSong(): LyricsDisplay {
  const words = Array.from({ length: 30 }, (_, i) => ({
    text: `line ${i} with a few more placeholder words to wrap`,
    startBeat: 4 + i * 8,
    endBeat: 8 + i * 8,
  }));
  return {
    schema: "clickbait/lyrics-display@1",
    title: "Render Test",
    bpm: 100,
    timeSignature: [4, 4],
    slug: "render-test",
    curve: [{ t: 0, b: 0 }, { t: 0.6, b: 1 }],
    words,
    display: {
      sections: [
        { name: "Verse", startBeat: 0 },
        { name: "Chorus", startBeat: 80 },
        { name: "Outro", startBeat: 160 },
      ],
      lines: words.map((w, i) => ({
        words: [i, i] as [number, number],
        section: w.startBeat < 80 ? "Verse" : w.startBeat < 160 ? "Chorus" : "Outro",
      })),
    },
  };
}

const outDir = mkdtempSync(join(tmpdir(), "eink-render-"));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe.skipIf(!hasChrome)("renderPages (headless Chrome)", () => {
  const size = { width: 500, height: 700, dpr: 2 };

  it("puts every line on exactly one page, none cut off at the bottom", async () => {
    const pages = await renderPages(longSong(), size, outDir);
    expect(pages.length).toBeGreaterThan(1);
    const beats = pages.flatMap((p) => p.lines.map((l) => l.beat));
    expect(beats).toEqual(longSong().words.map((w) => w.startBeat));
    for (const p of pages) for (const l of p.lines) expect(l.y + l.h).toBeLessThanOrEqual(size.height);
  }, 60_000);

  it("writes one PNG per page at device-pixel size", async () => {
    const pages = await renderPages(longSong(), size, outDir);
    for (let i = 0; i < pages.length; i++) {
      const png = readFileSync(join(outDir, `${i}.png`));
      // IHDR width/height live at bytes 16–23.
      expect(png.readUInt32BE(16)).toBe(size.width * size.dpr);
      expect(png.readUInt32BE(20)).toBe(size.height * size.dpr);
    }
  }, 60_000);
});
