import { describe, it, expect } from "vitest";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { buildRpp } from "../src/build-rpp.js";
import { linearize } from "../src/linearize.js";
import { song, seq, span, bars, cue, marker, audio } from "@clickbait/dsongl";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "fixtures");

const defaultOpts = {
  cueDir: resolve(fixturesDir, "cues"),
  countDir: resolve(__dirname, "..", "assets", "counts"),
  clickDir: resolve(__dirname, "..", "assets", "clicks"),
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
    // First region uses the song slug (for teleprompter song switching)
    expect(rpp).toContain("MARKER 1");
    expect(rpp).toContain("test");
    expect(rpp).toContain("Verse");
    expect(rpp).toContain("MARKER 2");
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
    expect(rpp).toContain(`${defaultOpts.cueDir}/verse.wav`);
    expect(rpp).toContain(`${defaultOpts.cueDir}/chorus.wav`);
  });

  it("places count beat numbers 1 bar before cue sections", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4)),  // 16 beats
        span("Verse", bars(4), { cue: true }),  // starts beat 16
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    // Count for Verse: 1 bar before = beat 12, at 120bpm = 6s
    // Should have 4 count items (4/4 time): beats 12, 13, 14, 15
    expect(rpp).toContain(`${defaultOpts.countDir}/1.wav`);
    expect(rpp).toContain(`${defaultOpts.countDir}/2.wav`);
    expect(rpp).toContain(`${defaultOpts.countDir}/3.wav`);
    expect(rpp).toContain(`${defaultOpts.countDir}/4.wav`);
  });

  it("handles 5/4 time signature for counts", () => {
    const s = song("Test", 120, { timeSignature: [5, 4] },
      seq(
        span("Intro", bars(2)),  // 10 beats
        span("Head", bars(4), { cue: true }),   // starts beat 10
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    // Count should have 5 beats
    expect(rpp).toContain(`${defaultOpts.countDir}/5.wav`);
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
    // Title cue "Test" is always auto-injected
    expect(cueWavsNeeded.sort()).toEqual(["Chorus", "Test", "Verse"]);
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
    expect(rpp).not.toContain(`${defaultOpts.cueDir}/intro.wav`);
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
    expect(rpp).toContain(`${defaultOpts.cueDir}/title.wav`);
    expect(rpp).toContain(`${defaultOpts.cueDir}/intro.wav`);
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
    expect(rpp).toContain(`${defaultOpts.clickDir}/accent.wav`);
    expect(rpp).toContain(`${defaultOpts.clickDir}/beat.wav`);
  });

  it("generates SOURCE WAVE track for audio node", () => {
    const guitarsPath = resolve(fixturesDir, "stems", "guitars.wav");
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
        span("Verse", bars(4)),
      ),
      audio("Guitars", guitarsPath),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("NAME Guitars");
    expect(rpp).toContain("<SOURCE WAVE");
    expect(rpp).toContain(`FILE ${guitarsPath} 1`);
  });

  it("generates SOURCE WAVE track for audio node with wav extension", () => {
    const padPath = resolve(fixturesDir, "stems", "pad.wav");
    const s = song("Test", 120,
      span("Intro", bars(2)),
      audio("Pad", padPath),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("NAME Pad");
    expect(rpp).toContain("<SOURCE WAVE");
    expect(rpp).toContain(`FILE ${padPath} 1`);
  });

  it("groups multiple audio nodes by track name", () => {
    const guitarsPath = resolve(fixturesDir, "stems", "guitars.wav");
    const bassPath = resolve(fixturesDir, "stems", "bass.wav");
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
        span("Verse", bars(4)),
      ),
      audio("Guitars", guitarsPath),
      audio("Bass", bassPath),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("NAME Guitars");
    expect(rpp).toContain("NAME Bass");
    // Should be separate tracks
    const trackCount = (rpp.match(/NAME Guitars|NAME Bass/g) ?? []).length;
    expect(trackCount).toBe(2);
  });

  it("includes SOFFS when audio has source offset", () => {
    const vocalsPath = resolve(fixturesDir, "stems", "vocals.wav");
    const s = song("Test", 120,
      span("Intro", bars(2)),
      audio("Vocals", vocalsPath, { soffs: 0.164 }),
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
