import { describe, expect, it } from "vitest";
import { sceneClock, type SceneFeatures } from "../../src/visuals/scene-state.js";

// 120 bpm, beat 0 at 1.0 s: the count-in starts two beats before it.
const timing = { curve: [{ t: 1, b: 0 }, { t: 1.5, b: 1 }] };
const sections = [
  { name: "Intro", start: 0, end: 16, bars: 4, beatsPerBar: 4 },
  { name: "Verse", start: 16, end: 48, bars: 8, beatsPerBar: 4 },
];
const timeOf = (b: number) => 1 + b / 2;

function features(): SceneFeatures {
  const steps = (48 + 2) * 4 + 1;
  const col = () => new Array<number>(steps).fill(0);
  const drums = { loud: col(), onset: col(), bright: col(), low: col(), mid: col(), high: col() };
  drums.onset[(8 + 2) * 4] = 1; // one hit, on beat 8
  return { startBeat: -2, stepsPerBeat: 4, stems: { drums } };
}

describe("sceneClock", () => {
  const clock = sceneClock(timing, sections, features());

  it("places a time in its section, bar and beat", () => {
    const s = clock.at(timeOf(17.5));
    expect(s.beat).toBeCloseTo(17.5);
    expect(s.countIn).toBe(false);
    expect(s.section).toMatchObject({ index: 1, name: "Verse" });
    expect(s.section!.beat).toBeCloseTo(1.5);
    expect(s.section!.progress).toBeCloseTo(1.5 / 32);
    expect(s.bar).toBe(1);
    expect(s.beatInBar).toBe(2);
    expect(s.phase).toBeCloseTo(0.5);
    expect(s.measure).toBe(5);
  });

  it("counts down to the next section", () => {
    expect(clock.at(timeOf(12)).next).toEqual({ name: "Verse", inBeats: 4 });
    expect(clock.at(timeOf(15)).next!.inBeats).toBeCloseTo(1);
    expect(clock.at(timeOf(16)).next).toBeNull(); // the last section
  });

  it("counts in before the downbeat", () => {
    const s = clock.at(0);
    expect(s.beat).toBeCloseTo(-2);
    expect(s.countIn).toBe(true);
    expect(s.section).toBeNull();
    expect(s.next).toEqual({ name: "Intro", inBeats: 2 });
  });

  it("reads a stem's features at the nearest step, without blending a hit into its neighbors", () => {
    const at = (b: number) => clock.at(timeOf(b)).f("drums", "onset");
    expect(at(8)).toBe(1);
    expect(at(8.1)).toBe(1); // nearest step is still beat 8
    expect(at(8.2)).toBe(0); // nearest step is 8.25
    expect(at(7.8)).toBe(0);
  });

  it("looks ahead to any beat", () => {
    const s = clock.at(timeOf(6));
    expect(s.f("drums", "onset")).toBe(0);
    expect(s.f("drums", "onset", 8)).toBe(1);
  });

  it("reads zero outside the features grid", () => {
    const s = clock.at(timeOf(0));
    expect(s.f("drums", "onset", -10)).toBe(0);
    expect(s.f("drums", "onset", 500)).toBe(0);
  });

  it("refuses a stem or feature the song doesn't have", () => {
    const s = clock.at(timeOf(0));
    expect(() => s.f("keys", "onset")).toThrow(/keys/);
    expect(() => s.f("drums", "wobble" as never)).toThrow(/wobble/);
  });

  it("gives the time of any beat, for cutting on beats", () => {
    expect(clock.timeOf(8)).toBeCloseTo(timeOf(8));
    expect(clock.timeOf(-2)).toBeCloseTo(0);
    expect(clock.at(clock.timeOf(17.5)).beat).toBeCloseTo(17.5);
  });

  it("gives the same state for the same time", () => {
    expect(JSON.stringify(clock.at(7.3))).toBe(JSON.stringify(clock.at(7.3)));
  });
});
