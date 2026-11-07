import { describe, it, expect } from "vitest";
import { lightsAt, type LightsFile } from "../../src/lights/events.js";

/**
 * lights(beat): a song's lights are looks (static states) plus beat-keyed events.
 * The state at any beat is computed from the file alone, so a jump lands exactly.
 */
const RED: [number, number, number] = [1, 0, 0];
const BLUE: [number, number, number] = [0, 0, 1];
const GOLD: [number, number, number] = [1, 0.72, 0.38];

const song = (events: LightsFile["events"]): LightsFile => ({
  fixtures: ["a", "b"],
  looks: {
    warm: { a: GOLD, b: GOLD },
    cool: { a: BLUE, b: BLUE },
    leftOnly: { a: RED },
  },
  events,
});

const close = (got: number[], want: number[]) => want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 5));

describe("lightsAt", () => {
  it("is dark before the first event", () => {
    const s = song([{ beat: 4, look: "warm" }]);
    expect(lightsAt(s, 0)).toEqual({ a: [0, 0, 0, 0], b: [0, 0, 0, 0] });
  });

  it("cuts to a look on its beat", () => {
    const s = song([{ beat: 4, look: "warm" }]);
    close(lightsAt(s, 4).a, GOLD);
    close(lightsAt(s, 10).b, GOLD);
  });

  it("leaves a fixture the look doesn't mention dark", () => {
    const s = song([{ beat: 0, look: "leftOnly" }]);
    expect(lightsAt(s, 1).b).toEqual([0, 0, 0, 0]);
  });

  it("fades from the previous look over the given beats", () => {
    const s = song([{ beat: 0, look: "warm" }, { beat: 8, look: "cool", fade: 4 }]);
    close(lightsAt(s, 8).a, GOLD); // fade starts at the old look
    close(lightsAt(s, 10).a, [0.5, 0.36, 0.69]); // halfway
    close(lightsAt(s, 12).a, BLUE); // done
    close(lightsAt(s, 20).a, BLUE);
  });

  it("adds a flash that decays exponentially and ends", () => {
    const s = song([{ beat: 0, look: "cool" }, { beat: 4, flash: ["a"], color: "white", level: 0.5, decay: 0.5 }]);
    close(lightsAt(s, 4).a, [0.5, 0.5, 1]); // blue + half white, clamped to 1
    close(lightsAt(s, 4.5).a, [0.5 * Math.exp(-1), 0.5 * Math.exp(-1), 1]);
    close(lightsAt(s, 3.9).a, BLUE); // not yet
    close(lightsAt(s, 4 + 0.5 * 5).a, BLUE); // over after five decays
    close(lightsAt(s, 4).b, BLUE); // only the named fixtures
  });

  it("swings a light's color at constant brightness with a tint", () => {
    const s = song([{ beat: 0, look: "warm" }, { beat: 2, tint: ["a"], color: BLUE, decay: 1 }]);
    const at = lightsAt(s, 2).a;
    close(at, BLUE); // fully swung on the beat, at the look's brightness (gold's peak is 1)
    expect(Math.max(...lightsAt(s, 3).a)).toBeCloseTo(1, 5); // brightness held while it swings back
  });

  it("gives the same answer whatever beat was asked before (a jump lands exactly)", () => {
    const s = song([{ beat: 0, look: "warm" }, { beat: 8, look: "cool", fade: 4 }, { beat: 9, flash: ["b"], color: RED, level: 1, decay: 1 }]);
    const direct = lightsAt(s, 10);
    lightsAt(s, 100);
    lightsAt(s, 0);
    expect(lightsAt(s, 10)).toEqual(direct);
  });

  it("does not depend on the order events are listed in the file", () => {
    const sorted = song([{ beat: 0, look: "warm" }, { beat: 8, look: "cool" }]);
    const shuffled = song([{ beat: 8, look: "cool" }, { beat: 0, look: "warm" }]);
    expect(lightsAt(shuffled, 9)).toEqual(lightsAt(sorted, 9));
  });
});

describe("lightsAt UV", () => {
  const UV: [number, number, number, number] = [0, 0, 0, 1];
  const uvSong = (events: LightsFile["events"]): LightsFile => ({
    fixtures: ["a"],
    looks: { warm: { a: GOLD }, glow: { a: [1, 0.72, 0.38, 0.4] } },
    events,
  });

  it("gives every light four channels, UV last and zero unless a look sets it", () => {
    expect(lightsAt(uvSong([{ beat: 0, look: "warm" }]), 1).a).toEqual([...GOLD, 0]);
  });

  it("fades UV like any other channel", () => {
    const s = uvSong([{ beat: 0, look: "warm" }, { beat: 8, look: "glow", fade: 32 }]);
    expect(lightsAt(s, 24).a[3]).toBeCloseTo(0.2, 5); // halfway up to 40%
  });

  it("flashes UV when the flash color has it, and a white flash leaves UV alone", () => {
    const s = uvSong([{ beat: 0, look: "warm" }, { beat: 4, flash: ["a"], color: UV, level: 0.5, decay: 0.5 }, { beat: 8, flash: ["a"], color: "white", level: 1, decay: 1 }]);
    expect(lightsAt(s, 4).a[3]).toBeCloseTo(0.5, 5);
    expect(lightsAt(s, 8).a[3]).toBe(0);
  });
});

describe("lightsAt blackout", () => {
  const s = song([
    { beat: 0, look: "warm" },
    { beat: 7.5, flash: ["a"], color: "white", level: 1, decay: 1 },
    { beat: 8, blackout: 2 },
  ]);

  it("knocks every light out for its length, flashes still decaying included", () => {
    expect(lightsAt(s, 8)).toEqual({ a: [0, 0, 0, 0], b: [0, 0, 0, 0] });
    expect(lightsAt(s, 9.9)).toEqual({ a: [0, 0, 0, 0], b: [0, 0, 0, 0] });
  });

  it("lets the lights back when it ends", () => {
    close(lightsAt(s, 10).b, GOLD);
  });
});
