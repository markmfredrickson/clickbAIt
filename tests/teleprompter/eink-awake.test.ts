import { describe, it, expect } from "vitest";
import { needsTapReminder } from "../../src/teleprompter/eink/awake.js";

const MIN = 60_000;

describe("needsTapReminder", () => {
  const sleep = 10 * MIN;

  it("reminds after a song once half the sleep timer has passed", () => {
    expect(needsTapReminder({ sinceTouchMs: 4 * MIN, sleepMs: sleep, songEnded: true })).toBe(false);
    expect(needsTapReminder({ sinceTouchMs: 5 * MIN, sleepMs: sleep, songEnded: true })).toBe(true);
  });

  it("doesn't remind mid-song while there's time left", () => {
    expect(needsTapReminder({ sinceTouchMs: 7 * MIN, sleepMs: sleep, songEnded: false })).toBe(false);
  });

  it("reminds mid-song two minutes before the timer runs out", () => {
    expect(needsTapReminder({ sinceTouchMs: 8 * MIN, sleepMs: sleep, songEnded: false })).toBe(true);
  });

  it("scales with a longer timer", () => {
    const hour = 60 * MIN;
    expect(needsTapReminder({ sinceTouchMs: 29 * MIN, sleepMs: hour, songEnded: true })).toBe(false);
    expect(needsTapReminder({ sinceTouchMs: 30 * MIN, sleepMs: hour, songEnded: true })).toBe(true);
    expect(needsTapReminder({ sinceTouchMs: 57 * MIN, sleepMs: hour, songEnded: false })).toBe(false);
    expect(needsTapReminder({ sinceTouchMs: 58 * MIN, sleepMs: hour, songEnded: false })).toBe(true);
  });
});
