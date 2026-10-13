import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relaySongs, readSetlist } from "../../src/teleprompter/catalog.js";

/**
 * A temp repo: band/ holds two built songs and one with a manifest but no build;
 * duo/ holds one built song. A .clickbait.json is written only when a test asks.
 */
function repo() {
  const root = mkdtempSync(join(tmpdir(), "catalog-"));
  const song = (dir: string, built: boolean) => {
    const d = join(root, dir);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "x.song.json"), "{}");
    if (built) writeFileSync(join(d, "x-artist.lyrics-display.json"), "{}");
    return d;
  };
  return {
    root,
    lonely: song("band/black-keys/lonely-boy", true),
    creep: song("band/radiohead/creep", true),
    draft: song("band/police/roxanne", false),
    saveMe: song("duo/aimee-mann/save-me", true),
    config: (c: object) => writeFileSync(join(root, ".clickbait.json"), JSON.stringify(c)),
  };
}

describe("relaySongs", () => {
  it("serves every built song under the configured folders, and lists the unbuilt ones", () => {
    const r = repo();
    r.config({ songs: ["band", "duo"] });
    const got = relaySongs([], r.root);
    expect(got.songsDirs.sort()).toEqual([r.lonely, r.creep, r.saveMe].sort());
    expect(got.unbuilt).toEqual([r.draft]);
  });

  it("serves the named folders instead of the configured ones", () => {
    const r = repo();
    r.config({ songs: ["band", "duo"] });
    expect(relaySongs([r.saveMe], r.root).songsDirs).toEqual([r.saveMe]);
  });

  it("refuses with no folders named and no config", () => {
    const r = repo();
    expect(() => relaySongs([], r.root)).toThrow(/songs-dir|\.clickbait\.json/);
  });

  it("carries the configured set list in playing order", () => {
    const r = repo();
    writeFileSync(join(r.root, "setlist.txt"), "duo/aimee-mann/save-me\nband/black-keys/lonely-boy\n");
    r.config({ songs: ["band", "duo"], setlist: "setlist.txt" });
    expect(relaySongs([], r.root).setlist).toEqual([r.saveMe, r.lonely]);
  });

  it("has no set list when none is configured", () => {
    const r = repo();
    r.config({ songs: ["band"] });
    expect(relaySongs([], r.root).setlist).toBeUndefined();
  });
});

describe("readSetlist", () => {
  it("skips comments, blank lines and commented-out songs, keeping the order", () => {
    const r = repo();
    const file = join(r.root, "setlist.txt");
    writeFileSync(
      file,
      [
        "# Practice / gig set list",
        "",
        "band/radiohead/creep               # Creep",
        "# band/black-keys/lonely-boy       # Lonely Boy",
        "duo/aimee-mann/save-me",
      ].join("\n"),
    );
    expect(readSetlist(file, r.root, [r.lonely, r.creep, r.saveMe])).toEqual([r.creep, r.saveMe]);
  });

  it("names an entry that isn't a built song", () => {
    const r = repo();
    const file = join(r.root, "setlist.txt");
    writeFileSync(file, "band/police/roxanne\n");
    expect(() => readSetlist(file, r.root, [r.lonely, r.creep, r.saveMe])).toThrow(/band\/police\/roxanne/);
  });
});
