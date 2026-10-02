import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeAvailable } from "../../src/teleprompter/eink/render.js";
import { renderScene } from "../../src/visuals/render.js";

const hasChrome = await chromeAvailable();
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// 120 bpm, beat 0 at 1.0 s; one 24-beat section, so the song ends at 13 s.
const timing = { curve: [{ t: 1, b: 0 }, { t: 1.5, b: 1 }] };
const sections = [{ name: "Only", start: 0, end: 24, bars: 6, beatsPerBar: 4 }];
const FPS = 10;
const flash = join(import.meta.dirname, "../fixtures/visuals/flash.scene.js");

/** One brightness value (0–255) per decoded frame. */
function brightness(video: string): number[] {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", video, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
  return [...raw];
}

function probe(video: string, entries: string): string {
  return execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", ...entries.split(" "), "-of", "default=nw=1:nk=1", video]).toString();
}

describe.skipIf(!hasChrome || !hasFfmpeg)("renderScene (headless Chrome + ffmpeg)", () => {
  let dir: string;
  let video: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "render-"));
    video = join(dir, "a.mp4");
    await renderScene({ scene: flash, timing, sections, fps: FPS, width: 64, height: 36, out: video });
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("renders the whole song at the frame rate asked for", () => {
    expect(probe(video, "-show_entries stream=r_frame_rate").trim()).toBe("10/1");
    expect(brightness(video).length).toBe(13 * FPS);
  });

  it("draws beat 16 at beat 16's time", () => {
    const lit = brightness(video).flatMap((v, i) => (v > 128 ? [i] : []));
    // Beat 16 is at 9.0 s and lasts half a second.
    expect(lit[0]).toBeGreaterThanOrEqual(89);
    expect(lit[0]).toBeLessThanOrEqual(91);
    expect(lit.length).toBeGreaterThanOrEqual(4);
    expect(lit.length).toBeLessThanOrEqual(6);
  });

  it("starts a keyframe on every beat, so a jump can seek straight to it", () => {
    const keys = probe(video, "-skip_frame nokey -show_entries frame=pts_time")
      .trim()
      .split("\n")
      .map(Number);
    for (let b = -2; b < 24; b++) {
      const t = 1 + b / 2;
      expect(keys.some((k) => Math.abs(k - t) < 0.5 / FPS), `beat ${b} at ${t}s`).toBe(true);
    }
  });

  it("reports the scene's own error when it throws", async () => {
    const scene = join(import.meta.dirname, "../fixtures/visuals/throws.scene.js");
    await expect(renderScene({ scene, timing, sections, fps: FPS, width: 64, height: 36, out: join(dir, "c.mp4") })).rejects.toThrow(/bass/);
  });

  it("renders the same frames twice", async () => {
    const again = join(dir, "b.mp4");
    await renderScene({ scene: flash, timing, sections, fps: FPS, width: 64, height: 36, out: again });
    const md5 = (v: string) => execFileSync("ffmpeg", ["-v", "error", "-i", v, "-f", "framemd5", "-"]).toString().replace(/^#.*\n/gm, "");
    expect(md5(again)).toBe(md5(video));
  }, 60_000);
});
