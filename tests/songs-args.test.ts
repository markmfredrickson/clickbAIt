import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSongsArgs, readClickbaitConfig } from "../src/core/songs-args.js";

/** A temp repo with two song folders to name. */
function repo() {
  const root = mkdtempSync(join(tmpdir(), "songs-args-"));
  const band = join(root, "band");
  const duo = join(root, "duo");
  for (const d of [band, duo]) mkdirSync(d);
  return { root, band, duo };
}

describe("parseSongsArgs", () => {
  it("takes a task and a folder", () => {
    const { band } = repo();
    expect(parseSongsArgs(["build", band])).toEqual({ task: "build", roots: [band], force: false });
  });

  it("defaults the task to build when the first word is a folder", () => {
    const { band, duo } = repo();
    expect(parseSongsArgs([band, duo])).toEqual({ task: "build", roots: [band, duo], force: false });
  });

  it("refuses to run with no folder named and no defaults", () => {
    expect(() => parseSongsArgs(["build"])).toThrow(/folder/);
  });

  it("uses the configured folders when none are named", () => {
    const { band, duo } = repo();
    expect(parseSongsArgs(["bundle"], [band, duo])).toEqual({ task: "bundle", roots: [band, duo], force: false });
  });

  it("lets named folders override the configured ones", () => {
    const { band, duo } = repo();
    expect(parseSongsArgs(["build", duo], [band]).roots).toEqual([duo]);
  });

  it("names a folder that doesn't exist", () => {
    const { root } = repo();
    const missing = join(root, "nope");
    expect(() => parseSongsArgs(["build", missing])).toThrow(missing);
  });

  it("names a configured folder that doesn't exist", () => {
    const { root } = repo();
    const missing = join(root, "gone");
    expect(() => parseSongsArgs(["build"], [missing])).toThrow(missing);
  });

  it("accepts --force anywhere", () => {
    const { band } = repo();
    expect(parseSongsArgs(["--force", "build", band]).force).toBe(true);
    expect(parseSongsArgs(["build", band, "--force"]).force).toBe(true);
  });

  it("treats a second word that isn't a folder as an error, not a second task", () => {
    const { band } = repo();
    expect(() => parseSongsArgs(["build", "bundle", band])).toThrow(/bundle/);
  });
});

describe("readClickbaitConfig", () => {
  it("is empty when there is no .clickbait.json", () => {
    const { root } = repo();
    expect(readClickbaitConfig(root)).toEqual({});
  });

  it("resolves the song folders against the config's own folder", () => {
    const { root, band, duo } = repo();
    writeFileSync(join(root, ".clickbait.json"), JSON.stringify({ songs: ["band", "duo"] }));
    expect(readClickbaitConfig(root)).toEqual({ songs: [band, duo] });
  });

  it("names the file when it isn't valid JSON", () => {
    const { root } = repo();
    writeFileSync(join(root, ".clickbait.json"), "{ songs: ");
    expect(() => readClickbaitConfig(root)).toThrow(/\.clickbait\.json/);
  });

  it("rejects a songs entry that isn't a list of folders", () => {
    const { root } = repo();
    writeFileSync(join(root, ".clickbait.json"), JSON.stringify({ songs: "band" }));
    expect(() => readClickbaitConfig(root)).toThrow(/songs/);
  });
});
