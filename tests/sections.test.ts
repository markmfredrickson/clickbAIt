import { describe, it, expect } from "vitest";
import { extractSections } from "../src/build/sections.js";
import { song, seq, span, bars, beats } from "@clickbait/dsongl";

describe("extractSections", () => {
  it("extracts named spans from a sequence", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
        span("Verse", bars(4)),
        span("Chorus", bars(4)),
      ),
    );
    const sections = extractSections(s);
    expect(sections).toHaveLength(3);
    expect(sections[0]).toMatchObject({ name: "Intro", beat: 0, durationBeats: 8 });
    expect(sections[1]).toMatchObject({ name: "Verse", beat: 8, durationBeats: 16 });
    expect(sections[2]).toMatchObject({ name: "Chorus", beat: 24, durationBeats: 16 });
  });

  it("resolves bars with different time signatures", () => {
    const s = song("Test", 120, { timeSignature: [3, 4] },
      seq(
        span("Waltz", bars(4)),
      ),
    );
    const sections = extractSections(s);
    expect(sections[0].durationBeats).toBe(12); // 4 bars × 3 beats
    expect(sections[0].timeSignature).toEqual([3, 4]);
  });

  it("handles time signature override in span", () => {
    const s = song("Test", 120,
      seq(
        span("Normal", bars(2)),
        span("Odd", bars(2), { timeSignature: [5, 4] }),
        span("Back", bars(1)),
      ),
    );
    const sections = extractSections(s);
    expect(sections[0]).toMatchObject({ name: "Normal", beat: 0, durationBeats: 8 });
    expect(sections[1]).toMatchObject({ name: "Odd", beat: 8, durationBeats: 10 });
    expect(sections[2]).toMatchObject({ name: "Back", beat: 18, durationBeats: 4 });
  });

  it("carries BPM into sections", () => {
    const s = song("Test", 120,
      seq(
        span("Slow", bars(2)),
        span("Fast", bars(2), { bpm: 240 }),
      ),
    );
    const sections = extractSections(s);
    expect(sections[0].bpm).toBe(120);
    expect(sections[1].bpm).toBe(240);
  });

});
