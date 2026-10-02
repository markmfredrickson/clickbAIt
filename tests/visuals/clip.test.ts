import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeAvailable } from "../../src/teleprompter/eink/render.js";
import { renderScene } from "../../src/visuals/render.js";
import { startPreview } from "../../src/visuals/preview.js";
import { cutClip, type MediaFile } from "../../src/visuals/media.js";

const hasChrome = await chromeAvailable();

// 120 bpm, beat 0 at 1.0 s; the song ends at 13 s.
const timing = { curve: [{ t: 1, b: 0 }, { t: 1.5, b: 1 }] };
const sections = [{ name: "Only", start: 0, end: 24, bars: 6, beatsPerBar: 4 }];
const FPS = 10;
// Clip frame n is gray at video level 24 + 6n, for 30 frames (3 s at 10 fps).
const level = (n: number) => 24 + 6 * n;

let dir: string;
let media: MediaFile["clips"];

beforeAll(async () => {
  if (!hasChrome) return;
  dir = mkdtempSync(join(tmpdir(), "clip-"));
  mkdirSync(join(dir, "media"));
  const raw = join(dir, "raw.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=black:s=64x36:r=10:d=3", "-vf", "geq=lum='24+6*N':cb=128:cr=128", "-pix_fmt", "yuv420p", raw]);
  const info = await cutClip(raw, join(dir, "media", "counter.mp4"));
  media = { counter: { file: "media/counter.mp4", source: {}, in: 0, out: 3, license: "own", added: "", ...info } };
  writeFileSync(join(dir, "media", "media.json"), JSON.stringify({ clips: media }));
  copyFileSync(join(import.meta.dirname, "../fixtures/visuals/clip.scene.js"), join(dir, "song.scene.js"));
}, 60_000);
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!hasChrome)("clips in a scene (headless Chrome)", () => {
  it("draws the exact clip frame the scene asks for in an offline render", async () => {
    const out = join(dir, "out.mp4");
    await renderScene({ scene: join(dir, "song.scene.js"), timing, sections, media, fps: FPS, width: 64, height: 36, out });
    const y: number[] = [...execFileSync("ffmpeg", ["-v", "error", "-i", out, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "gray", "-"])];

    // Video frame i is at i/10 s; the scene wants clip time i/10 - 1, so clip frame i - 10.
    for (let i = 0; i < y.length; i++) {
      const n = i - 10;
      // ffmpeg's gray output is full range, like the canvas: black is 0.
      const want = n >= 0 && n < 30 ? ((level(n) - 16) * 255) / 219 : 0;
      expect(Math.abs(y[i] - want), `frame ${i}: level ${y[i]}, want ${want}`).toBeLessThanOrEqual(3);
    }
  }, 60_000);

  it("shows the same frame in the preview once it has seeked", async () => {
    const audio = join(dir, "song.wav");
    const data = Buffer.alloc(14 * 8000 * 2);
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28);
    h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
    writeFileSync(audio, Buffer.concat([h, data]));
    writeFileSync(join(dir, "song.lyrics-display.json"), JSON.stringify(timing));
    writeFileSync(join(dir, "song.rows.json"), JSON.stringify({ sections }));

    const preview = await startPreview({
      scene: join(dir, "song.scene.js"),
      timing: join(dir, "song.lyrics-display.json"),
      rows: join(dir, "song.rows.json"),
      audio,
      port: 0,
      width: 64,
      height: 36,
    });
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.goto(preview.url);
      await page.waitForFunction(() => (window as any).preview);
      await page.evaluate(() => (window as any).preview.seek(2.05)); // clip time 1.05: frame 10
      // Video level to the canvas's RGB, as the browser expands limited range.
      const rgb = Math.round(((level(10) - 16) * 255) / 219);
      await page.waitForFunction(
        (want: number) => {
          const c = document.querySelector("#stage canvas") as HTMLCanvasElement | null;
          if (!c) return false;
          const v = c.getContext("2d")!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[0];
          return Math.abs(v - want) <= 6;
        },
        rgb,
        { timeout: 10_000 },
      );
    } finally {
      await browser.close();
      await preview.close();
    }
  }, 60_000);
});
