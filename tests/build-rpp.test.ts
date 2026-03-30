import { describe, it, expect } from "vitest";
import { buildRpp } from "../src/build-rpp.js";
import { linearize } from "../src/linearize.js";
import { song, seq, span, bars, cue, marker, audio } from "@clickbait/dsongl";

const defaultOpts = {
  cueDir: "/tmp/cues",
  countDir: "/tmp/counts",
  clickDir: "/tmp/clicks",
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

  it("places DSL cue events as audio items", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4)),  // 16 beats
        span("Verse", bars(4), [cue("Verse", -8)]),  // cue 2 bars before
        span("Chorus", bars(4), [cue("Chorus", -8)]), // cue 2 bars before
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain('"Cues & Counts"');
    expect(rpp).toContain("/tmp/cues/verse.wav");
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

  it("reports unique cue WAVs needed from DSL cue events", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4)),
        span("Verse", bars(4), [cue("Verse", -4)]),
        span("Chorus", bars(4), [cue("Chorus", -4)]),
        span("Verse", bars(4), [cue("Verse", -4)]),   // repeat
        span("Chorus", bars(4), [cue("Chorus", -4)]),  // repeat
      ),
    );
    const { cueWavsNeeded } = buildRpp(s, defaultOpts);
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

  it("cue with negative offset on first section pads and appears in RPP", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4), [cue("Title", -12), cue("Intro", -4), marker("start", 0)]),
        span("Verse", bars(4), [cue("Verse", -4)]),
      ),
    );
    const { rpp, cueWavsNeeded } = buildRpp(s, defaultOpts);
    expect(cueWavsNeeded).toContain("Title");
    expect(cueWavsNeeded).toContain("Intro");
    expect(rpp).toContain("/tmp/cues/title.wav");
    expect(rpp).toContain("/tmp/cues/intro.wav");
    // Verify they're at different seconds by checking linearize directly
    const events = linearize(s);
    const titleCue = events.find(e => e.type === "cue" && e.value === "Title")!;
    const introCue = events.find(e => e.type === "cue" && e.value === "Intro")!;
    expect(titleCue.beat).toBe(0);
    expect(introCue.beat).toBe(8);
    expect(titleCue.seconds).toBe(0);
    expect(introCue.seconds).toBeGreaterThan(0);
  });

  it("includes click track with SOURCE CLICK", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4)),
        span("Verse", bars(4)),
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("NAME Click");
    expect(rpp).toContain("<SOURCE CLICK");
    expect(rpp).toContain("AUTO 1 0");
    expect(rpp).toContain("/tmp/clicks/accent.wav");
    expect(rpp).toContain("/tmp/clicks/beat.wav");
  });

  it("generates SOURCE MP3 track for audio node with mp3 file", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
        span("Verse", bars(4)),
      ),
      audio("Guitars", "stems/guitars.mp3"),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("NAME Guitars");
    expect(rpp).toContain("<SOURCE MP3");
    expect(rpp).toContain("FILE stems/guitars.mp3 1");
  });

  it("generates SOURCE WAVE track for audio node with wav file", () => {
    const s = song("Test", 120,
      span("Intro", bars(2)),
      audio("Pad", "stems/pad.wav"),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("NAME Pad");
    expect(rpp).toContain("<SOURCE WAVE");
    expect(rpp).toContain("FILE stems/pad.wav 1");
  });

  it("groups multiple audio nodes by track name", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
        span("Verse", bars(4)),
      ),
      audio("Guitars", "stems/guitars.mp3"),
      audio("Bass", "stems/bass.mp3"),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("NAME Guitars");
    expect(rpp).toContain("NAME Bass");
    // Should be separate tracks
    const trackCount = (rpp.match(/NAME Guitars|NAME Bass/g) ?? []).length;
    expect(trackCount).toBe(2);
  });

  it("includes SOFFS when audio has source offset", () => {
    const s = song("Test", 120,
      span("Intro", bars(2)),
      audio("Vocals", "stems/vocals.mp3", { soffs: 0.164 }),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("SOFFS 0.164");
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
