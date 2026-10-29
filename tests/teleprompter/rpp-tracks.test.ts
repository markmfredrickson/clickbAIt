import { describe, it, expect } from "vitest";
import { playbackTracks } from "../../src/teleprompter/rpp-tracks.js";

// The shape build-rpp writes: click, cues, a Stems folder holding the stems,
// then the band's record tracks, which play nothing.
const RPP = `<REAPER_PROJECT 0.1 "7.0"
  MARKER 1 0 song-slug 1 0 1 B {A} 0 1
  <TRACK {1}
    NAME Click
    MUTESOLO 0 0 0
    ISBUS 0 0
    <ITEM
      NAME click
    >
  >
  <TRACK {2}
    NAME "Cues & Counts"
    MUTESOLO 0 0 0
    ISBUS 0 0
    <ITEM
      NAME cue
    >
  >
  <TRACK {3}
    NAME Stems
    MUTESOLO 1 0 0
    ISBUS 1 1
  >
  <TRACK {4}
    NAME Bass
    MUTESOLO 0 0 0
    ISBUS 0 0
    <ITEM
      NAME bass
      <SOURCE FLAC
        FILE "stems/bass.flac"
      >
    >
  >
  <TRACK {5}
    NAME Vocals
    MUTESOLO 1 0 0
    ISBUS 2 -1
    <ITEM
      NAME vocals
    >
  >
  <TRACK {6}
    NAME "X32 CH 01 (Guitar Kr)"
    MUTESOLO 0 0 0
    ISBUS 0 0
  >
>
`;

describe("playbackTracks", () => {
  it("lists the tracks that play, numbered as REAPER numbers them, with their saved mute", () => {
    expect(playbackTracks(RPP)).toEqual([
      { n: 1, name: "Click", muted: false },
      { n: 2, name: "Cues & Counts", muted: false },
      { n: 3, name: "Stems", muted: true, folder: true },
      { n: 4, name: "Bass", muted: false, parent: 3 },
      { n: 5, name: "Vocals", muted: true, parent: 3 },
    ]);
  });

  it("reads track names, not the names of items inside them", () => {
    expect(playbackTracks(RPP).map((t) => t.name)).not.toContain("bass");
  });

  it("has nothing for a project with no tracks", () => {
    expect(playbackTracks("<REAPER_PROJECT\n>\n")).toEqual([]);
  });
});
