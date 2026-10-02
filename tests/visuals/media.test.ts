import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveLicense, describeSource, parseTime, cutClip, addMedia, contactSheet } from "../../src/visuals/media.js";

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
    const record = JSON.parse(readFileSync(join(song, "media", "media.json"), "utf8"));
    expect(record.clips.counter).toMatchObject({
      file: "media/counter.mp4",
      source: { kind: "file", license: "own", by: "Mark" },
      in: 1,
      out: 3,
      license: "own",
      fps: 30,
    });
    expect(Number(probe(join(song, "media", "counter.mp4"), "-count_frames", "-show_entries", "stream=nb_read_frames"))).toBe(60);
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
