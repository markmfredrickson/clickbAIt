import { describe, it, expect } from "vitest";
import { lightsAt, parseLights, LIGHTS_SCHEMA, type LightsFile } from "../../src/lights/events.js";

/**
 * lights(beat): a song's lights are looks (static states) plus beat-keyed events.
 * The state at any beat is computed from the file alone, so a jump lands exactly.
 */
const RED: [number, number, number] = [1, 0, 0];
const BLUE: [number, number, number] = [0, 0, 1];
const GOLD: [number, number, number] = [1, 0.72, 0.38];

const song = (events: LightsFile["events"]): LightsFile => ({
  schema: LIGHTS_SCHEMA,
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
    schema: LIGHTS_SCHEMA,
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

/**
 * A dimmer event scales some lights' look to a fraction, fading there from wherever the level
 * stands, and holds until the next dimmer event on that light. Flashes and tints ride on top.
 */
describe("lightsAt dimmer", () => {
  it("scales the named lights' look and leaves the others alone", () => {
    const s = song([{ beat: 0, look: "warm" }, { beat: 4, dimmer: ["a"], to: 0.5 }]);
    close(lightsAt(s, 4).a, GOLD.map((x) => x * 0.5));
    close(lightsAt(s, 4).b, GOLD);
    close(lightsAt(s, 3).a, GOLD); // full before it
  });

  it("fades from wherever the level stands, so a change mid-fade doesn't jump", () => {
    const s = song([{ beat: 0, look: "cool" }, { beat: 0, dimmer: ["a"], to: 0, fade: 4 }, { beat: 2, dimmer: ["a"], to: 1, fade: 2 }]);
    expect(lightsAt(s, 1).a[2]).toBeCloseTo(0.75, 5);
    expect(lightsAt(s, 2).a[2]).toBeCloseTo(0.5, 5); // the second fade starts where the first had got to
    expect(lightsAt(s, 3).a[2]).toBeCloseTo(0.75, 5);
    expect(lightsAt(s, 4).a[2]).toBeCloseTo(1, 5);
  });

  it("runs alongside a look fade without restarting it", () => {
    const s = song([{ beat: 0, look: "warm" }, { beat: 8, look: "cool", fade: 4 }, { beat: 10, dimmer: ["a"], to: 0.5 }]);
    close(lightsAt(s, 10).a, [0.25, 0.18, 0.345]); // halfway through the look fade, at half level
    close(lightsAt(s, 12).a, BLUE.map((x) => x * 0.5));
  });

  it("holds until the next dimmer event on that light", () => {
    const s = song([
      { beat: 0, look: "warm" },
      { beat: 1, dimmer: ["a"], to: 0.2 },
      { beat: 2, look: "cool" },
      { beat: 3, dimmer: ["b"], to: 0.5 },
    ]);
    close(lightsAt(s, 20).a, BLUE.map((x) => x * 0.2)); // through a look cut and another light's dimmer
  });

  it("puts flashes on top at full strength, and a blackout still wins", () => {
    const s = song([
      { beat: 0, look: "cool" },
      { beat: 0, dimmer: ["a"], to: 0 },
      { beat: 4, flash: ["a"], color: RED, level: 1, decay: 1 },
      { beat: 8, flash: ["a"], color: RED, level: 1, decay: 1 },
      { beat: 8, blackout: 1 },
    ]);
    close(lightsAt(s, 4).a, RED);
    expect(lightsAt(s, 8).a).toEqual([0, 0, 0, 0]);
  });

  it("lands a jump into the middle of a fade where playing through it would", () => {
    const s = song([{ beat: 0, look: "warm" }, { beat: 0, dimmer: ["a", "b"], to: 0, fade: 8 }, { beat: 6, dimmer: ["a"], to: 1, fade: 4 }]);
    const direct = lightsAt(s, 7);
    for (let b = 0; b <= 7; b += 0.25) lightsAt(s, b);
    expect(lightsAt(s, 7)).toEqual(direct);
  });
});

/** Reading a light file: the schema version is checked and every event must be one the reader knows. */
describe("parseLights", () => {
  const good = { schema: LIGHTS_SCHEMA, fixtures: ["a"], looks: { r: { a: [1, 0, 0] } }, events: [{ beat: 0, look: "r" }, { beat: 1, dimmer: ["a"], to: 0.5, fade: 1 }] };

  it("reads a valid file", () => {
    expect(parseLights(good)).toEqual(good);
  });

  it("refuses a file with no schema or another version, naming what it found", () => {
    const { schema: _, ...none } = good;
    expect(() => parseLights(none)).toThrow(/schema/);
    expect(() => parseLights({ ...good, schema: "clickbait/lights@9" })).toThrow(/lights@9/);
  });

  it("refuses an event it doesn't know rather than reading it as a tint", () => {
    expect(() => parseLights({ ...good, events: [{ beat: 2, strobe: ["a"], rate: 8 }] })).toThrow(/event/);
  });

  it("refuses an event that names a look or light the file doesn't have", () => {
    expect(() => parseLights({ ...good, events: [{ beat: 0, look: "nope" }] })).toThrow(/nope/);
    expect(() => parseLights({ ...good, events: [{ beat: 0, dimmer: ["zz"], to: 1 }] })).toThrow(/zz/);
  });
});
