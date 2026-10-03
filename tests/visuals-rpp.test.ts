import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { songRecipe } from "../src/build/song-recipe.js";
import { buildRpp } from "../src/build/rpp.js";
import { findGigVideo } from "../src/build/gig-video.js";
import { song, span, bars } from "@clickbait/dsongl";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const fixturesDir = resolve(__dirname, "fixtures");

describe("song recipe: the RPP is built after the visuals render", () => {
  const recipe = songRecipe({ slug: "so-lonely", title: "So Lonely", artist: "The Police", rel: "../../..", minBpm: 150, maxBpm: 159 }) as {
    scripts: Record<string, string>;
    wireit: Record<string, { command: string; files?: string[]; output?: string[]; dependencies?: string[] }>;
  };
  const { timing, render, build } = recipe.wireit;

  it("writes the timing files in their own task", () => {
    expect(recipe.scripts.timing).toBe("wireit");
    expect(timing.command).toContain("src/build/generate.ts so-lonely.song.json --part timing");
    expect(timing.output).toEqual(expect.arrayContaining(["*.lyrics-display.json", "*.rows.json", "*.charts.json", "cues/**"]));
    expect(timing.output).not.toContain("*.RPP");
    expect(timing.dependencies).toEqual(["smooth"]);
  });

  it("renders the scene from the timing files, the stem features and the footage", () => {
    expect(recipe.scripts.render).toBe("wireit");
    expect(render.command).toContain("src/visuals/render-cli.ts so-lonely.song.json --skip-without-scene");
    expect(render.files).toEqual(expect.arrayContaining(["*.scene.js", "*.lyrics-display.json", "*.rows.json", "*.beat-features.json", "footage/footage.json", "footage/*.mp4"]));
    expect(render.output).toEqual(["*.visuals.mp4"]);
    expect(render.dependencies).toEqual(expect.arrayContaining(["timing", "features"]));
  });

  it("builds the RPP after the render, so it never carries a video older than the timing", () => {
    expect(build.command).toContain("src/build/generate.ts so-lonely.song.json --part project");
    expect(build.output).toEqual(["*.RPP"]);
    expect(build.dependencies).toEqual(expect.arrayContaining(["timing", "render"]));
  });
});

describe("buildRpp: a Visuals track", () => {
  const s = song("Test", 120, span("A", bars(4)));
  const opts = {
    cueDir: resolve(fixturesDir, "cues"),
    countDir: resolve(root, "assets", "counts"),
    clickDir: resolve(root, "assets", "clicks"),
    cueDuration: 0.8,
    countDuration: 0.4,
  };

  it("puts the video on its own track, one item from project time 0", () => {
    const { rpp } = buildRpp(s, { ...opts, video: { file: "/songs/x/test.visuals.mp4", seconds: 42.5 } });
    const start = rpp.indexOf("NAME Visuals\n");
    expect(start).toBeGreaterThan(-1);
    const track = rpp.slice(start, rpp.indexOf("\n  >", start));
    expect(track.match(/<ITEM/g)).toHaveLength(1);
    expect(track).toMatch(/POSITION 0\n/);
    expect(track).toMatch(/LENGTH 42\.5/);
    expect(track).toMatch(/<SOURCE VIDEO\n\s+FILE "\/songs\/x\/test\.visuals\.mp4"/);
  });

  it("has no Visuals track without a video", () => {
    expect(buildRpp(s, opts).rpp).not.toContain("NAME Visuals");
  });
});

describe("findGigVideo", () => {
  const dir = mkdtempSync(join(tmpdir(), "gig-video-"));
  for (const f of ["teardrop-massive-attack.visuals-draft.mp4", "Teardrop - visuals (50MB).mp4", "Teardrop - visuals draft.mp4"]) writeFileSync(join(dir, f), "");

  it("ignores drafts and hand-named copies", () => {
    expect(findGigVideo(dir, "teardrop-massive-attack")).toBeUndefined();
  });

  it("finds the gig master, <slug>.visuals.mp4", () => {
    writeFileSync(join(dir, "teardrop-massive-attack.visuals.mp4"), "");
    expect(findGigVideo(dir, "teardrop-massive-attack")).toBe(join(dir, "teardrop-massive-attack.visuals.mp4"));
  });
});

describe("generate --part", () => {
  const run = (part: string) => {
    const dir = mkdtempSync(join(tmpdir(), "generate-part-"));
    copyFileSync(join(fixturesDir, "count-test.song.json"), join(dir, "count-test.song.json"));
    execFileSync("npx", ["tsx", join(root, "src/build/generate.ts"), join(dir, "count-test.song.json"), "--part", part], { cwd: root, stdio: "pipe" });
    return readdirSync(dir);
  };

  it("timing writes the timing files and cues, not the RPP", () => {
    const files = run("timing");
    expect(files.some((f) => f.endsWith(".rows.json"))).toBe(true);
    expect(files).toContain("cues");
    expect(files.some((f) => f.endsWith(".RPP"))).toBe(false);
  }, 120_000);

  it("project writes the RPP, not the timing files", () => {
    const files = run("project");
    expect(files.some((f) => f.endsWith(".RPP"))).toBe(true);
    expect(files.some((f) => f.endsWith(".rows.json"))).toBe(false);
  }, 120_000);
});

describe("render-cli --skip-without-scene", () => {
  it("does nothing for a song with no scene", () => {
    const dir = mkdtempSync(join(tmpdir(), "render-skip-"));
    copyFileSync(join(fixturesDir, "count-test.song.json"), join(dir, "count-test.song.json"));
    const r = spawnSync("npx", ["tsx", join(root, "src/visuals/render-cli.ts"), join(dir, "count-test.song.json"), "--skip-without-scene"], { cwd: root, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(readdirSync(dir).some((f) => f.endsWith(".mp4"))).toBe(false);
    expect(existsSync(join(dir, "count-test.song.json"))).toBe(true);
  }, 60_000);
});
