import { describe, it, expect } from "vitest";
import { songChannels, resolveChannels, parseChannelParam } from "../../src/charts/channels.js";
import type { ChartSpec } from "../../src/manifest.js";

const spec = (id: string, instrument: string, kind: ChartSpec["kind"] = "tab"): ChartSpec => ({
  id, kind, instrument, score: "ug", track: 0,
});
const CHARTS = [spec("lead-guitar", "guitar"), spec("rhythm-guitar", "guitar"), spec("bass", "bass"), spec("drums", "drums", "drums")];

describe("songChannels", () => {
  it("lists sections, lyrics when there are words, then each chart in manifest order", () => {
    expect(songChannels({ hasLyrics: true, charts: CHARTS }).map((c) => c.id)).toEqual([
      "sections", "lyrics", "lead-guitar", "rhythm-guitar", "bass", "drums",
    ]);
  });

  it("leaves lyrics out of an instrumental", () => {
    expect(songChannels({ hasLyrics: false, charts: [] }).map((c) => c.id)).toEqual(["sections"]);
  });
});

describe("resolveChannels", () => {
  const available = songChannels({ hasLyrics: true, charts: CHARTS });

  it("expands an instrument name to that instrument's charts", () => {
    expect(resolveChannels(["guitar", "lyrics"], available)).toEqual({
      channels: ["lead-guitar", "rhythm-guitar", "lyrics"],
      unknown: [],
    });
  });

  it("takes a chart id on its own", () => {
    expect(resolveChannels(["rhythm-guitar"], available).channels).toEqual(["rhythm-guitar"]);
  });

  it("drops duplicates, keeping the first mention", () => {
    expect(resolveChannels(["rhythm-guitar", "guitar"], available).channels).toEqual(["rhythm-guitar", "lead-guitar"]);
  });

  it("reports names the song doesn't have instead of dropping them silently", () => {
    expect(resolveChannels(["keys", "lyrics"], available)).toEqual({ channels: ["lyrics"], unknown: ["keys"] });
  });

  it("defaults to lyrics and sections, which is today's display", () => {
    expect(resolveChannels([], available).channels).toEqual(["sections", "lyrics"]);
  });
});

describe("parseChannelParam", () => {
  it("splits a comma list and ignores blanks and spacing", () => {
    expect(parseChannelParam(" guitar, lyrics,,")).toEqual(["guitar", "lyrics"]);
    expect(parseChannelParam(null)).toEqual([]);
  });
});
