import { describe, it, expect } from "vitest";
import { songSlugsFromFiles } from "../../src/teleprompter/relay.js";

// A real song folder, as `songs/radiohead/creep/` actually looks after a build.
// Everything here except the display file is a derived sidecar.
const CREEP_FOLDER = [
  "creep-radiohead.RPP",
  "creep-radiohead.build.json",
  "creep-radiohead.lyrics-display.json",
  "creep.lookup.json",
  "creep.lyrics.txt",
  "creep.song.json",
  "package.json",
  "source.analysis.json",
  "source.m4a",
  "source.m4a.beatmap.json",
  "source.m4a.beats.json",
  "source.m4a.beats.drums.json",
  "source.m4a.beats.mix.json",
];

describe("songSlugsFromFiles", () => {
  it("offers only the built display file from a real song folder", () => {
    expect(songSlugsFromFiles(CREEP_FOLDER)).toEqual(["creep-radiohead"]);
  });

  it("strips the full .lyrics-display.json suffix, not just .json", () => {
    // The bug: `f.replace(".json", "")` left the slug as "x.lyrics-display",
    // which then resolved to "x.lyrics-display.lyrics-display.json".
    expect(songSlugsFromFiles(["x.lyrics-display.json"])).toEqual(["x"]);
  });

  it("excludes the manifest, which is the sidecar most easily mistaken for a song", () => {
    expect(songSlugsFromFiles(["creep.song.json"])).toEqual([]);
  });

  it("excludes beat sidecars that share the source's stem", () => {
    expect(
      songSlugsFromFiles(["source.m4a.beats.json", "source.m4a.beats.mix.json", "source.m4a.beatmap.json"]),
    ).toEqual([]);
  });

  it("excludes package.json so a song recipe never lists as a song", () => {
    expect(songSlugsFromFiles(["package.json"])).toEqual([]);
  });

  it("ignores non-JSON files", () => {
    expect(songSlugsFromFiles(["source.m4a", "creep.lyrics.txt", "creep-radiohead.RPP"])).toEqual([]);
  });

  it("returns an empty list for an empty directory", () => {
    expect(songSlugsFromFiles([])).toEqual([]);
  });

  it("keeps multiple songs when a directory holds several", () => {
    expect(
      songSlugsFromFiles(["a-artist.lyrics-display.json", "b-artist.lyrics-display.json", "notes.json"]),
    ).toEqual(["a-artist", "b-artist"]);
  });

  it("preserves slugs containing dots", () => {
    expect(songSlugsFromFiles(["mr.-jones-counting-crows.lyrics-display.json"])).toEqual([
      "mr.-jones-counting-crows",
    ]);
  });
});
