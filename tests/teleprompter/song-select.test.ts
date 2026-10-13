import { describe, it, expect } from "vitest";
import { targetSong, parseSongIntent, firstAttempt, afterReport } from "../../src/teleprompter/song-select.js";

const SET = ["seven-nation-army", "lonely-boy", "creep"];

describe("targetSong", () => {
  it("next moves to the following song", () => {
    expect(targetSong(SET, "lonely-boy", { to: "next" })).toEqual({ index: 2 });
  });

  it("next does nothing on the last song", () => {
    expect(targetSong(SET, "creep", { to: "next" })).toHaveProperty("reject");
  });

  it("next with no song showing yet starts the set", () => {
    expect(targetSong(SET, undefined, { to: "next" })).toEqual({ index: 0 });
  });

  it("prev moves back, and does nothing on the first song", () => {
    expect(targetSong(SET, "lonely-boy", { to: "prev" })).toEqual({ index: 0 });
    expect(targetSong(SET, "seven-nation-army", { to: "prev" })).toHaveProperty("reject");
  });

  it("next or prev from a song that isn't in the set list is refused", () => {
    expect(targetSong(SET, "wicked-game", { to: "next" })).toHaveProperty("reject");
  });

  it("jumps to a song in the set list, and refuses one that isn't", () => {
    expect(targetSong(SET, "seven-nation-army", { to: "song", slug: "creep" })).toEqual({ index: 2 });
    expect(targetSong(SET, "seven-nation-army", { to: "song", slug: "wicked-game" })).toHaveProperty("reject");
  });
});

describe("parseSongIntent", () => {
  it("accepts next, prev and a song by name", () => {
    expect(parseSongIntent({ to: "next" })).toEqual({ to: "next" });
    expect(parseSongIntent({ to: "prev" })).toEqual({ to: "prev" });
    expect(parseSongIntent({ to: "song", slug: "creep" })).toEqual({ to: "song", slug: "creep" });
  });

  it("drops anything else", () => {
    for (const bad of [null, "next", {}, { to: "sideways" }, { to: "song" }, { to: "song", slug: 3 }]) {
      expect(parseSongIntent(bad)).toBeNull();
    }
  });
});

describe("switching tabs and checking where REAPER landed", () => {
  it("aims at set-list song n in tab n+1, shifted by the known offset", () => {
    expect(firstAttempt(0, 0).tab).toBe(1);
    expect(firstAttempt(2, 1).tab).toBe(4);
  });

  it("is done when REAPER reports the song it was sent to", () => {
    expect(afterReport(firstAttempt(1, 0), "lonely-boy", SET)).toEqual({ done: true, offset: 0 });
  });

  it("learns the offset from a different set-list song and retries once", () => {
    // Aimed at creep in tab 3, but tab 3 holds lonely-boy (set-list 1): an extra tab sits in front.
    const r = afterReport(firstAttempt(2, 0), "lonely-boy", SET);
    expect(r).toEqual({ retry: { target: 2, tab: 4, offset: 1, retried: true } });
  });

  it("assumes one extra tab in front when nothing is reported, and retries once", () => {
    // An untitled project has no regions, so the nudge brings no song name back.
    const r = afterReport(firstAttempt(0, 0), null, SET);
    expect(r).toEqual({ retry: { target: 0, tab: 2, offset: 1, retried: true } });
  });

  it("gives up after the retry rather than looping", () => {
    const retry = { target: 0, tab: 2, offset: 1, retried: true };
    expect(afterReport(retry, null, SET)).toHaveProperty("error");
    expect(afterReport(retry, "creep", SET)).toHaveProperty("error");
  });

  it("gives up when the tab holds a song that isn't in the set list", () => {
    expect(afterReport(firstAttempt(0, 0), "wicked-game", SET)).toHaveProperty("error");
  });
});
