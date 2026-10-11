import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { songArg } from "../src/core/song-arg.js";

/** A temp catalog: one song folder with a manifest, one with two, one with none. */
function catalog() {
  const root = mkdtempSync(join(tmpdir(), "song-arg-"));
  const one = join(root, "one");
  const two = join(root, "two");
  const none = join(root, "none");
  for (const d of [one, two, none]) mkdirSync(d);
  writeFileSync(join(one, "one.song.json"), "{}");
  writeFileSync(join(two, "a.song.json"), "{}");
  writeFileSync(join(two, "b.song.json"), "{}");
  return { one, two, none };
}

describe("songArg", () => {
  it("takes a song folder, finding its manifest", () => {
    const { one } = catalog();
    expect(songArg(one)).toEqual({ dir: one, manifest: join(one, "one.song.json") });
  });

  it("takes the manifest itself", () => {
    const { one } = catalog();
    expect(songArg(join(one, "one.song.json"))).toEqual({ dir: one, manifest: join(one, "one.song.json") });
  });

  it("accepts a folder with a trailing slash, as tab completion writes it", () => {
    const { one } = catalog();
    expect(songArg(one + "/").manifest).toBe(join(one, "one.song.json"));
  });

  it("reports a folder with no manifest", () => {
    const { none } = catalog();
    expect(() => songArg(none)).toThrow(/no \.song\.json in .*none/);
  });

  it("reports a folder with several manifests, naming them, so the person picks one", () => {
    const { two } = catalog();
    expect(() => songArg(two)).toThrow(/2 manifests .*a\.song\.json, b\.song\.json/);
  });

  it("reports a path that isn't there, or isn't a manifest", () => {
    const { one } = catalog();
    expect(() => songArg(join(one, "missing"))).toThrow(/no such song folder or manifest/);
    expect(() => songArg(join(one, "one.song.json").replace(".song.json", ".txt"))).toThrow(/no such song folder or manifest/);
  });
});
