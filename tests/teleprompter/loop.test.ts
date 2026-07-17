import { describe, it, expect } from "vitest";
import { sectionLoopBounds, loopWrapTarget, type LoopSection } from "../../src/teleprompter/loop.js";

// A curve where beat = 2·time, i.e. time = beat/2 (120 BPM). Keeps the section
// starts (beats) trivially convertible to the times we assert on.
const toTime = (beat: number) => beat / 2;

const sections: LoopSection[] = [
  { name: "Intro", startBeat: 0 },
  { name: "Verse 1", startBeat: 16 },
  { name: "Guitar Solo", startBeat: 48 },
  { name: "Outro", startBeat: 80 },
];

describe("sectionLoopBounds", () => {
  it("bounds a single section from its start to the next section's start", () => {
    const b = sectionLoopBounds(sections, 1, 1, toTime, 100);
    expect(b).toEqual({ name: "Verse 1", startTime: 8, endTime: 24 });
  });

  it("bounds an instrumental section (no lyrics) the same way", () => {
    const b = sectionLoopBounds(sections, 2, 2, toTime, 100);
    expect(b).toEqual({ name: "Guitar Solo", startTime: 24, endTime: 40 });
  });

  it("runs a range ending at the last section to the media duration", () => {
    const b = sectionLoopBounds(sections, 3, 3, toTime, 100);
    expect(b).toEqual({ name: "Outro", startTime: 40, endTime: 100 });
  });

  it("spans a contiguous range: first section start to after the last", () => {
    // Verse 1 (start 8) through Guitar Solo (ends where Outro starts, 40).
    const b = sectionLoopBounds(sections, 1, 2, toTime, 100);
    expect(b).toEqual({ name: "Verse 1 – Guitar Solo", startTime: 8, endTime: 40 });
  });

  it("spans a range that ends at the final section (to duration)", () => {
    const b = sectionLoopBounds(sections, 2, 3, toTime, 100);
    expect(b).toEqual({ name: "Guitar Solo – Outro", startTime: 24, endTime: 100 });
  });

  it("throws on an invalid range", () => {
    expect(() => sectionLoopBounds(sections, 0, 4, toTime, 100)).toThrow(RangeError); // end past last
    expect(() => sectionLoopBounds(sections, -1, 0, toTime, 100)).toThrow(RangeError); // start < 0
    expect(() => sectionLoopBounds(sections, 2, 1, toTime, 100)).toThrow(RangeError); // start > end
  });
});

describe("loopWrapTarget", () => {
  it("wraps to the start once playback reaches the end", () => {
    expect(loopWrapTarget(24, 8, 24)).toBe(8); // at end
    expect(loopWrapTarget(25, 8, 24)).toBe(8); // past end
  });

  it("does not wrap while inside the loop", () => {
    expect(loopWrapTarget(8, 8, 24)).toBeNull();
    expect(loopWrapTarget(20, 8, 24)).toBeNull();
  });

  it("leaves an earlier scrub alone (manual lead-in)", () => {
    expect(loopWrapTarget(2, 8, 24)).toBeNull();
  });
});
