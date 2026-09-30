import { describe, it, expect } from "vitest";
import { parseDisplayOptions, displayQuery, PRESETS, presetHref } from "../../src/teleprompter/display-options.js";

const SIZED = ["lyrics", "chords"];

describe("parseDisplayOptions", () => {
  it("reads the channels to show", () => {
    expect(parseDisplayOptions("?channels= lyrics, chords,,", SIZED).channels).toEqual(["lyrics", "chords"]);
  });

  it("leaves the channels to the page when the URL doesn't say", () => {
    expect(parseDisplayOptions("", SIZED).channels).toBeUndefined();
  });

  it("reads a size for each channel that has one, by the channel's name", () => {
    expect(parseDisplayOptions("?lyrics=2&chords=0.9&tab=3", SIZED).sizes).toEqual({ lyrics: 2, chords: 0.9 });
  });

  it("reads the offset, scroll mode and theme", () => {
    expect(parseDisplayOptions("?offset=1.5&scroll=manual&theme=light", SIZED)).toMatchObject({
      offset: 1.5,
      scroll: "manual",
      theme: "light",
    });
  });

  it("ignores values it can't use", () => {
    expect(parseDisplayOptions("?lyrics=big&chords=-1&offset=x&scroll=fast&theme=blue", SIZED)).toEqual({ sizes: {} });
  });
});

describe("displayQuery", () => {
  it("writes the options in a fixed order, keeping commas readable", () => {
    expect(
      displayQuery({ channels: ["lyrics", "chords"], sizes: { chords: 0.9, lyrics: 2 }, offset: 1, scroll: "manual", theme: "light" }, SIZED),
    ).toBe("?channels=lyrics,chords&lyrics=2&chords=0.9&offset=1&scroll=manual&theme=light");
  });

  it("is empty when there's nothing to say", () => {
    expect(displayQuery({ sizes: {} }, SIZED)).toBe("");
  });

  it("reads back as the same options", () => {
    const options = { channels: ["chords"], sizes: { chords: 1.25 }, offset: 2, theme: "light" as const };
    expect(parseDisplayOptions(displayQuery(options, SIZED), SIZED)).toEqual(options);
  });
});

describe("presets", () => {
  it("links each preset to its page with its options", () => {
    expect(PRESETS.map((p) => [p.name, presetHref(p)])).toEqual([
      ["Lyrics", "/prompt?channels=lyrics"],
      ["Lyrics + chords", "/prompt?channels=lyrics,chords"],
      ["Chords only", "/prompt?channels=chords"],
      ["E-ink (Kindle)", "/eink"],
      ["Custom", "/prompt?settings=open"],
    ]);
  });
});
