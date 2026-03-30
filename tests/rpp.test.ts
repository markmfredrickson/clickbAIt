import { describe, it, expect } from "vitest";
import { generateRpp } from "../src/rpp.js";
import type { Song } from "@clickbait/dsongl";

const simpleSong: Song = {
  title: "Test Song",
  masterBpm: 120,
  sections: [
    { name: "Intro",   bars: [{ beats: 4, repeat: 4 }] },  // 16 beats = 8s
    { name: "Verse 1", bars: [{ beats: 4, repeat: 8 }] },  // 32 beats = 16s, starts at 8s
    { name: "Chorus",  bars: [{ beats: 4, repeat: 8 }] },  // 32 beats = 16s, starts at 24s
  ],
};

describe("generateRpp", () => {
  it("wraps output in REAPER_PROJECT block", () => {
    const rpp = generateRpp(simpleSong);
    expect(rpp).toMatch(/^<REAPER_PROJECT/);
    expect(rpp.trimEnd()).toMatch(/>$/);
  });

  it("contains the master BPM in TEMPO line", () => {
    const rpp = generateRpp(simpleSong);
    expect(rpp).toContain("TEMPO 120");
  });

  it("contains section names as region markers", () => {
    const rpp = generateRpp(simpleSong);
    expect(rpp).toContain("Intro");
    expect(rpp).toContain('"Verse 1"');
    expect(rpp).toContain("Chorus");
  });

  it("places Intro region start at 0 seconds", () => {
    const rpp = generateRpp(simpleSong);
    expect(rpp).toContain("MARKER 1 0 Intro 1");
  });

  it("places Verse 1 region start at 8 seconds (4 bars × 4 beats ÷ 120 BPM × 60)", () => {
    const rpp = generateRpp(simpleSong);
    expect(rpp).toContain('MARKER 2 8 "Verse 1" 1');
  });

  it("places Chorus region start at 24 seconds (4+8 bars × 4 beats ÷ 120 BPM × 60)", () => {
    const rpp = generateRpp(simpleSong);
    expect(rpp).toContain("MARKER 3 24 Chorus 1");
  });

  it("emits region end markers at correct second positions", () => {
    const rpp = generateRpp(simpleSong);
    expect(rpp).toContain('MARKER 1 8 "" 1');
    expect(rpp).toContain('MARKER 2 24 "" 1');
    expect(rpp).toContain('MARKER 3 40 "" 1');
  });

  it("emits a single PT for a uniform-tempo song", () => {
    const rpp = generateRpp(simpleSong);
    const pts = [...rpp.matchAll(/^\s+PT /gm)];
    expect(pts).toHaveLength(1);
  });

  it("encodes 4/4 time signature in the PT entry", () => {
    const rpp = generateRpp(simpleSong);
    expect(rpp).toContain("262148");
    expect(rpp).toContain("169");
    expect(rpp).toContain("ABBB");
  });

  it("handles a 2/4 bar — Don't Dream It's Over pattern", () => {
    const song: Song = {
      title: "Don't Dream It's Over",
      masterBpm: 100,
      sections: [
        { name: "Verse 1",   bars: [{ beats: 4, repeat: 7 }] },   // 28 beats = 16.8s
        { name: "Short Bar", bars: [{ beats: 2, repeat: 1 }] },   // 2 beats = 1.2s, starts at 16.8s
        { name: "Chorus",    bars: [{ beats: 4, repeat: 8 }] },   // starts at 18s
      ],
    };
    const rpp = generateRpp(song);

    // Short Bar starts at 28 beats / 100 BPM × 60 = 16.8 seconds
    expect(rpp).toContain('MARKER 2 16.8 "Short Bar" 1');

    // Chorus starts at 30 beats / 100 BPM × 60 = 18 seconds
    expect(rpp).toContain("MARKER 3 18 Chorus 1");

    // PT emitted for 2/4: timesigFlags(2)=262146, patternStr="AB"
    expect(rpp).toContain("262146");
    expect(rpp).toContain("0 AB\n");
  });

  it("emits a new PT entry when BPM multiplier changes", () => {
    const song: Song = {
      title: "Slow Chorus",
      masterBpm: 120,
      sections: [
        { name: "Verse",  bars: [{ beats: 4, repeat: 4 }] },                      // 16 beats = 8s
        { name: "Chorus", bars: [{ beats: 4, repeat: 4, bpmMultiplier: 0.5 }] },  // PT at 8s, BPM=60
      ],
    };
    const rpp = generateRpp(song);

    // Chorus PT at 8 seconds with effective BPM 60
    expect(rpp).toContain("PT 8.000000000000 60.0000000000 1");
  });

  it("offsets section markers by lead-in bars", () => {
    const song: Song = { ...simpleSong, leadInBars: 2 };
    const rpp = generateRpp(song);

    // 2 lead-in bars × 4 beats ÷ 120 BPM × 60 = 4 seconds
    expect(rpp).toContain("MARKER 1 4 Intro 1");
    expect(rpp).not.toContain("MARKER 1 0 Intro");
  });
});
