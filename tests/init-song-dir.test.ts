import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSongDir } from "../src/build/init-song-dir.js";

const repo = () => mkdtempSync(join(tmpdir(), "init-song-dir-"));

describe("initSongDir", () => {
  it("requires a folder", () => {
    expect(() => initSongDir(undefined, repo())).toThrow(/--dir/);
  });

  it("creates the folder where it is told to", () => {
    const root = repo();
    const { songDir } = initSongDir("songs/band/police/roxanne", root);
    expect(songDir).toBe(join(root, "songs/band/police/roxanne"));
    expect(existsSync(songDir)).toBe(true);
  });

  it("points the recipe back at the repo from any depth", () => {
    const root = repo();
    expect(initSongDir("songs/band/police/roxanne", root).rel).toBe("../../../..");
    expect(initSongDir("roxanne", root).rel).toBe("..");
  });

  it("never overwrites an existing recipe", () => {
    const root = repo();
    const dir = join(root, "songs/roxanne");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), "{}");
    expect(() => initSongDir("songs/roxanne", root)).toThrow(/overwrite/);
  });
});
