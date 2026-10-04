import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveLicense, describeSource, parseTime, cutClip, addMedia, contactSheet, findShots, findStrikes, analyzeMedia, locLicense, detectCrop, findSpan } from "../../src/visuals/media.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("parseTime", () => {
  it("reads seconds, m:ss and h:mm:ss", () => {
    expect(parseTime("12.5")).toBe(12.5);
    expect(parseTime("5:10")).toBe(310);
    expect(parseTime("1:02:03")).toBe(3723);
  });
  it("refuses anything else", () => {
    expect(() => parseTime("five")).toThrow();
  });
});

describe("archiveLicense", () => {
  it("accepts an item marked public domain or CC0", () => {
    expect(archiveLicense({ licenseurl: "http://creativecommons.org/licenses/publicdomain/" })).toBe("public-domain");
    expect(archiveLicense({ licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/" })).toBe("public-domain");
    expect(archiveLicense({ licenseurl: "https://creativecommons.org/publicdomain/zero/1.0/" })).toBe("cc0");
  });
  it("refuses an item with no license, even an old one", () => {
    expect(() => archiveLicense({ year: "1936" })).toThrow(/no license/);
  });
  it("refuses a non-commercial license", () => {
    expect(() => archiveLicense({ licenseurl: "http://creativecommons.org/licenses/by-nc-sa/4.0/" })).toThrow(/by-nc-sa/);
  });
});

describe("describeSource", () => {
  it("knows an Internet Archive item by id or URL", () => {
    expect(describeSource("archive:MasterHa1936_2", {})).toEqual({ kind: "archive", id: "MasterHa1936_2" });
    expect(describeSource("https://archive.org/details/MasterHa1936_2", {})).toEqual({ kind: "archive", id: "MasterHa1936_2" });
  });

  it("refuses a file that doesn't say where it came from", () => {
    expect(() => describeSource("clip.mp4", {})).toThrow(/--from/);
  });

  it("records a Pexels page under the Pexels license", () => {
    expect(describeSource("clip.mp4", { from: "https://www.pexels.com/video/cars-on-a-bridge-123/", by: "A. Person" })).toEqual({
      kind: "file",
      file: "clip.mp4",
      url: "https://www.pexels.com/video/cars-on-a-bridge-123/",
      license: "pexels",
      by: "A. Person",
    });
  });

  it("records your own footage", () => {
    expect(describeSource("clip.mp4", { from: "own", by: "Mark" })).toMatchObject({ kind: "file", license: "own", by: "Mark" });
  });

  it("asks for the license of any other site, and refuses one outside the list", () => {
    const from = "https://example.org/video/1";
    expect(() => describeSource("clip.mp4", { from })).toThrow(/--license/);
    expect(() => describeSource("clip.mp4", { from, license: "cc-by-nc" })).toThrow(/cc-by-nc/);
  });

  it("needs a name to credit for a license that requires one", () => {
    const from = "https://example.org/video/1";
    expect(() => describeSource("clip.mp4", { from, license: "cc-by" })).toThrow(/--by/);
    expect(describeSource("clip.mp4", { from, license: "cc-by", by: "A. Person" })).toMatchObject({ license: "cc-by", by: "A. Person" });
  });
});

describe.skipIf(!hasFfmpeg)("cutClip and addMedia (ffmpeg)", () => {
  let dir: string;
  let source: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "media-"));
    source = join(dir, "source.mp4");
    // 10 s of a frame counter at 30 fps, with a keyframe only every 10 s.
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=s=320x240:r=30:d=10", "-g", "300", "-pix_fmt", "yuv420p", source]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const probe = (file: string, ...args: string[]) =>
    execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", ...args, "-of", "default=nw=1:nk=1", file]).toString().trim();

  it("cuts the span asked for", async () => {
    const out = join(dir, "cut.mp4");
    const info = await cutClip(source, out, { start: 2, end: 5 });
    expect(Number(probe(out, "-count_frames", "-show_entries", "stream=nb_read_frames"))).toBe(90);
    expect(info).toMatchObject({ fps: 30, width: 320, height: 240 });
    expect(info.duration).toBeCloseTo(3, 1);
  });

  it("puts a keyframe every few frames, so any frame is a short seek away", async () => {
    const out = join(dir, "cut.mp4");
    await cutClip(source, out, { start: 2, end: 5 });
    const keys = probe(out, "-skip_frame", "nokey", "-show_entries", "frame=pts_time").split("\n").map(Number);
    const gaps = keys.slice(1).map((k, i) => k - keys[i]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(5 / 30 + 1e-6);
  });

  it("records the clip's source, span and license beside it", async () => {
    const song = mkdtempSync(join(dir, "song-"));
    await addMedia(song, "counter", { kind: "file", file: source, url: "own", license: "own", by: "Mark" }, { start: 1, end: 3 });
    const record = JSON.parse(readFileSync(join(song, "footage", "footage.json"), "utf8"));
    expect(record.clips.counter).toMatchObject({
      file: "footage/counter.mp4",
      source: { kind: "file", license: "own", by: "Mark" },
      in: 1,
      out: 3,
      license: "own",
      fps: 30,
    });
    expect(Number(probe(join(song, "footage", "counter.mp4"), "-count_frames", "-show_entries", "stream=nb_read_frames"))).toBe(60);
  });

  it("crops a file when asked (a band from a portrait clip), and records the crop", async () => {
    const song = mkdtempSync(join(dir, "song-"));
    const info = await addMedia(song, "band", { kind: "file", file: source, url: "own", license: "own" }, undefined, { crop: { w: 320, h: 180, x: 0, y: 30 } });
    expect(info).toMatchObject({ width: 320, height: 180, crop: { w: 320, h: 180, x: 0, y: 30 } });
  });
});

describe.skipIf(!hasFfmpeg)("contactSheet (ffmpeg)", () => {
  let dir: string;
  let source: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sheet-"));
    source = join(dir, "source.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=s=320x240:r=30:d=10", "-pix_fmt", "yuv420p", source]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("takes a tile every few seconds, each labeled with its time, and each showing that moment", async () => {
    const out = join(dir, "sheet");
    const sheet = await contactSheet(source, out, { every: 2 });
    expect(sheet.tiles.map((t) => t.time)).toEqual([0, 2, 4, 6, 8]);

    const html = readFileSync(join(out, "index.html"), "utf8");
    for (const label of ["0:00", "0:02", "0:04", "0:06", "0:08"]) expect(html).toContain(label);

    // The tile labeled 0:06 matches the source's frame at 6 s more closely than its neighbors.
    const gray = (file: string, at?: number) =>
      execFileSync("ffmpeg", ["-v", "error", ...(at === undefined ? [] : ["-ss", String(at)]), "-i", file, "-frames:v", "1", "-vf", "scale=32:24", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
    const diff = (a: Buffer, b: Buffer) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
    const tile = gray(join(out, sheet.tiles[3].file));
    expect(diff(tile, gray(source, 6))).toBeLessThan(diff(tile, gray(source, 5)));
    expect(diff(tile, gray(source, 6))).toBeLessThan(diff(tile, gray(source, 7)));
  });
});

describe.skipIf(!hasFfmpeg)("findShots and findStrikes (ffmpeg)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "shots-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("finds hard cuts, and doesn't count a dissolve as a run of cuts", async () => {
    // Three shots with hard cuts at 2 s and 4 s, then a 1 s dissolve into a fourth from 6 s.
    const clip = join(dir, "cuts.mp4");
    const src = (pattern: string, d: number) => ["-f", "lavfi", "-i", `${pattern}${pattern.includes("=") ? ":" : "="}s=160x120:r=25:d=${d}`];
    execFileSync("ffmpeg", [
      "-v", "error",
      ...src("testsrc", 2), ...src("smptebars", 2), ...src("color=c=red", 3), ...src("rgbtestsrc", 3),
      "-filter_complex",
      "[0][1][2]concat=n=3,format=yuv420p,settb=1/25[a];[3]format=yuv420p,settb=1/25[b];[a][b]xfade=transition=fade:duration=1:offset=6,format=yuv420p",
      clip,
    ]);
    const shots = await findShots(clip);
    const starts = shots.map((s) => s.start);
    expect(starts[0]).toBe(0);
    expect(starts.some((t) => Math.abs(t - 2) <= 0.04)).toBe(true);
    expect(starts.some((t) => Math.abs(t - 4) <= 0.04)).toBe(true);
    expect(starts.filter((t) => t > 5.9 && t < 7.1).length).toBeLessThanOrEqual(1);
    expect(shots.at(-1)!.end).toBeCloseTo(9, 1);
  });

  it("finds each burst of light as a strike, at its frame", async () => {
    // Dark gray, with a white flash that decays, starting at frames 20, 55 and 90 (25 fps).
    const clip = join(dir, "strikes.mp4");
    execFileSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", "color=gray:s=160x120:r=25:d=5",
      "-vf", "geq=lum='40+200*(between(N,20,24)*exp(-(N-20)/2)+between(N,55,59)*exp(-(N-55)/2)+between(N,90,94)*exp(-(N-90)/2))':cb=128:cr=128",
      "-pix_fmt", "yuv420p", clip,
    ]);
    const strikes = await findStrikes(clip);
    expect(strikes.map((t) => Math.round(t * 25))).toEqual([20, 55, 90]);
  });
});

describe.skipIf(!hasFfmpeg)("analyzeMedia (ffmpeg)", () => {
  it("records a clip's shots and strikes beside its source", async () => {
    const dir = mkdtempSync(join(tmpdir(), "analyze-"));
    try {
      const raw = join(dir, "raw.mp4");
      execFileSync("ffmpeg", [
        "-v", "error", "-f", "lavfi", "-i", "color=gray:s=160x120:r=25:d=4",
        "-vf", "geq=lum='40+200*(between(N,30,34)*exp(-(N-30)/2))':cb=128:cr=128", "-pix_fmt", "yuv420p", raw,
      ]);
      await addMedia(dir, "flare", { kind: "file", file: raw, url: "own", license: "own" });
      await analyzeMedia(dir, "flare");
      const clip = JSON.parse(readFileSync(join(dir, "footage", "footage.json"), "utf8")).clips.flare;
      expect(clip.strikes.map((t: number) => Math.round(t * 25))).toEqual([30]);
      expect(clip.shots[0]).toMatchObject({ start: 0 });
      expect(clip.license).toBe("own");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Library of Congress sources", () => {
  it("knows an item by id or URL", () => {
    expect(describeSource("loc:2022600183", {})).toEqual({ kind: "loc", id: "2022600183" });
    expect(describeSource("https://www.loc.gov/item/2022600183/?loclr=blogloc", {})).toEqual({ kind: "loc", id: "2022600183" });
  });

  it("accepts the Library's no-known-restrictions statements, for film and for newspapers", () => {
    expect(locLicense(["<p>The Library of Congress is not aware of any U.S. copyright or other restrictions in the vast majority of motion pictures in these collections.</p>"])).toBe("no-known-restrictions");
    expect(locLicense(["The Library of Congress believes that the newspapers in Chronicling America are in the public domain or have no known copyright restrictions."])).toBe("no-known-restrictions");
  });

  it("refuses an item without one", () => {
    expect(() => locLicense(["Rights status not evaluated."])).toThrow(/rights/);
    expect(() => locLicense(undefined)).toThrow(/rights/);
  });
});

describe.skipIf(!hasFfmpeg)("finding a clip in a better copy (ffmpeg)", () => {
  let dir: string;
  let better: string;
  let clip: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "upgrade-"));
    // The better copy: 20 s of moving test pattern at 24 fps, 4:3 pillarboxed into 16:9.
    better = join(dir, "better.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=480x360:r=24:d=20", "-vf", "pad=640:360:80:0", "-pix_fmt", "yuv420p", better]);
    // The clip we have: 7.5–10.5 s of the same film, smaller and at 30 fps, without the bars.
    clip = join(dir, "clip.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-ss", "7.5", "-t", "3", "-i", better, "-vf", "crop=480:360:80:0,scale=320:240,fps=30", "-pix_fmt", "yuv420p", clip]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("finds the bars around 4:3 film in a 16:9 frame", async () => {
    expect(await detectCrop(better)).toEqual({ w: 480, h: 360, x: 80, y: 0 });
  });

  it("finds where the clip starts in the better copy", async () => {
    const start = await findSpan(clip, better);
    expect(Math.abs(start - 7.5)).toBeLessThanOrEqual(1 / 24);
  });

  it("isn't fooled by a clip that starts on black", async () => {
    // 2 s of black, then 12–15 s of the film; the better copy has black at 0–3 s too.
    const dark = join(dir, "dark.mp4");
    const darkSource = join(dir, "dark-source.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=black:s=640x360:r=24:d=3", "-i", better, "-filter_complex", "[0]format=yuv420p[a];[1]format=yuv420p[b];[a][b]concat=n=2", "-pix_fmt", "yuv420p", darkSource]);
    execFileSync("ffmpeg", ["-v", "error", "-ss", "13", "-t", "5", "-i", darkSource, "-f", "lavfi", "-i", "color=black:s=640x360:r=24:d=2", "-filter_complex", "[1]format=yuv420p[k];[0]format=yuv420p[f];[k][f]concat=n=2", "-pix_fmt", "yuv420p", dark]);
    // The clip starts 2 s before 13 s of the source.
    const start = await findSpan(dark, darkSource);
    expect(Math.abs(start - 11)).toBeLessThanOrEqual(1 / 24);
  });

  it("cuts without the bars when asked to crop", async () => {
    const out = join(dir, "cropped.mp4");
    const info = await cutClip(better, out, { start: 7.5, end: 10.5 }, { crop: await detectCrop(better) });
    expect(info).toMatchObject({ width: 480, height: 360, fps: 24 });
  });
});
