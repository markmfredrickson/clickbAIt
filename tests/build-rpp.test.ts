import { describe, it, expect } from "vitest";
import { buildRpp } from "../src/build-rpp.js";
import { song, seq, span, bars, cue, marker } from "../src/dsongl.js";

const defaultOpts = {
  cueDir: "/tmp/cues",
  countDir: "/tmp/counts",
  cueDuration: 0.8,
  countDuration: 0.4,
};

describe("buildRpp", () => {
  it("generates valid RPP structure", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
        span("Verse", bars(4)),
        span("Chorus", bars(4)),
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toMatch(/^<REAPER_PROJECT/);
    expect(rpp).toMatch(/>$/);
  });

  it("includes tempo envelope", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("<TEMPOENVEX");
    expect(rpp).toContain("TEMPO 120");
  });

  it("includes region markers for sections", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
        span("Verse", bars(4)),
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("Intro");
    expect(rpp).toContain("Verse");
    expect(rpp).toContain("MARKER");
  });

  it("creates Cues track with items 2 bars before sections", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4)),  // 16 beats
        span("Verse", bars(4)),  // starts beat 16
        span("Chorus", bars(4)), // starts beat 32
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain('"Cues & Counts"');
    // Cue for Verse at beat 8 (16 - 2*4), at 120bpm = 4 seconds
    expect(rpp).toContain("/tmp/cues/verse.wav");
    // Cue for Chorus at beat 24 (32 - 2*4), at 120bpm = 12 seconds
    expect(rpp).toContain("/tmp/cues/chorus.wav");
  });

  it("places count beat numbers 1 bar before sections on same track", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4)),  // 16 beats
        span("Verse", bars(4)),  // starts beat 16
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    // Count for Verse: 1 bar before = beat 12, at 120bpm = 6s
    // Should have 4 count items (4/4 time): beats 12, 13, 14, 15
    expect(rpp).toContain("/tmp/counts/1.wav");
    expect(rpp).toContain("/tmp/counts/2.wav");
    expect(rpp).toContain("/tmp/counts/3.wav");
    expect(rpp).toContain("/tmp/counts/4.wav");
  });

  it("handles 5/4 time signature for counts", () => {
    const s = song("Test", 120, { timeSignature: [5, 4] },
      seq(
        span("Intro", bars(2)),  // 10 beats
        span("Head", bars(4)),   // starts beat 10
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    // Count should have 5 beats
    expect(rpp).toContain("/tmp/counts/5.wav");
  });

  it("reports unique cue WAVs needed", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
        span("Verse", bars(4)),
        span("Chorus", bars(4)),
        span("Verse", bars(4)),  // repeat
        span("Chorus", bars(4)), // repeat
      ),
    );
    const { cueWavsNeeded } = buildRpp(s, defaultOpts);
    // Intro skipped (cue would go before beat 0), so only Verse and Chorus
    expect(cueWavsNeeded.sort()).toEqual(["Chorus", "Verse"]);
  });

  it("skips cue/count placement when it would go before beat 0", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(1)), // only 4 beats — not enough for 2-bar cue lead
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    // Intro starts at beat 0, cue would be at -8, count at -4 — both skipped
    // Should still have tracks but no items for Intro
    expect(rpp).toContain('"Cues & Counts"');
    expect(rpp).not.toContain("/tmp/cues/intro.wav");
  });

  it("works with Bohemian Rhapsody eval output", async () => {
    const bohRhap = (await import(
      "../clickbait-workspace/iteration-2/bohemian-rhapsody-queen/with_skill/outputs/bohemian-rhapsody.js"
    )).default;
    const { rpp, cueWavsNeeded } = buildRpp(bohRhap, defaultOpts);
    expect(rpp).toMatch(/^<REAPER_PROJECT/);
    expect(cueWavsNeeded.length).toBeGreaterThan(3);
    // Should have multiple tempo points (Bohemian Rhapsody has tempo changes)
    const ptCount = (rpp.match(/\bPT\b/g) ?? []).length;
    expect(ptCount).toBeGreaterThan(1);
  });
});
