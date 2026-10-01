import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeAvailable } from "../../src/teleprompter/eink/render.js";
import { startPreview, type Preview } from "../../src/visuals/preview.js";

const hasChrome = await chromeAvailable();

// 120 bpm, beat 0 at 1.0 s; one 24-beat section, so the song ends at 13 s.
const timing = { curve: [{ t: 1, b: 0 }, { t: 1.5, b: 1 }] };
const sections = [{ name: "Only", start: 0, end: 24, bars: 6, beatsPerBar: 4 }];

/** Mono 16-bit silence, `secs` long. */
function silentWav(secs: number, rate = 8000): Buffer {
  const data = Buffer.alloc(secs * rate * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const solid = (r: number, g: number, b: number) => `export default function scene(p, song) {
  p.setup = () => p.createCanvas(song.width, song.height);
  p.draw = () => p.background(${r}, ${g}, ${b});
}
`;

function songDir(scene: string) {
  const dir = mkdtempSync(join(tmpdir(), "preview-"));
  writeFileSync(join(dir, "song.lyrics-display.json"), JSON.stringify(timing));
  writeFileSync(join(dir, "song.rows.json"), JSON.stringify({ sections }));
  writeFileSync(join(dir, "song.wav"), silentWav(14));
  writeFileSync(join(dir, "song.scene.js"), scene);
  return {
    dir,
    files: {
      scene: join(dir, "song.scene.js"),
      timing: join(dir, "song.lyrics-display.json"),
      rows: join(dir, "song.rows.json"),
      audio: join(dir, "song.wav"),
    },
  };
}

/** The canvas's center pixel, as [r, g, b]. */
const centerPixel = () => {
  const c = document.querySelector("#stage canvas") as HTMLCanvasElement | null;
  if (!c) return null;
  const d = c.getContext("2d")!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
  return [d[0], d[1], d[2]];
};

describe.skipIf(!hasChrome)("visuals preview (headless Chrome)", () => {
  let song: ReturnType<typeof songDir>;
  let preview: Preview;
  let browser: any;
  let page: any;

  beforeAll(async () => {
    song = songDir(solid(255, 0, 0));
    preview = await startPreview({ ...song.files, port: 0, width: 64, height: 36 });
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ channel: "chrome" });
    page = await browser.newPage();
    await page.goto(preview.url);
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await preview?.close();
    rmSync(song.dir, { recursive: true, force: true });
  });

  const waitForColor = (rgb: number[]) =>
    page.waitForFunction(
      ([fn, want]: [string, number[]]) => JSON.stringify(new Function(`return (${fn})()`)()) === JSON.stringify(want),
      [centerPixel.toString(), rgb],
      { timeout: 10_000 },
    );

  it("serves the audio in ranges, so the player can seek", async () => {
    const res = await fetch(`${preview.url}audio`, { headers: { Range: "bytes=100-199" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toMatch(/^bytes 100-199\//);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(readFileSync(song.files.audio).subarray(100, 200))).toBe(true);
  });

  it("swaps a saved scene in without reloading the page", async () => {
    await waitForColor([255, 0, 0]);
    await page.evaluate(() => ((window as any).marker = "still here"));
    writeFileSync(song.files.scene, solid(0, 0, 255));
    await waitForColor([0, 0, 255]);
    expect(await page.evaluate(() => (window as any).marker)).toBe("still here");
  });

  it("keeps the last good scene drawing when a save is broken, and shows the error", async () => {
    writeFileSync(song.files.scene, "export default function scene(p, song) { p.draw = ( => }");
    await page.waitForFunction(() => document.querySelector("#error")?.textContent?.trim(), undefined, { timeout: 10_000 });
    await waitForColor([0, 0, 255]);

    writeFileSync(song.files.scene, solid(0, 255, 0));
    await waitForColor([0, 255, 0]);
    expect((await page.textContent("#error"))?.trim()).toBe("");
  });

  it("draws the frame for where the audio is, as the renderer would", async () => {
    copyFileSync(join(import.meta.dirname, "../fixtures/visuals/flash.scene.js"), song.files.scene);
    await page.evaluate(() => (window as any).preview.seek(9.1)); // inside beat 16
    await waitForColor([255, 255, 255]);
    await page.evaluate(() => (window as any).preview.seek(8.9)); // beat 15
    await waitForColor([0, 0, 0]);
  });
});
