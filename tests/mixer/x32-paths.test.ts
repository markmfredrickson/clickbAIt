import { describe, it, expect } from "vitest";
import { toX32, fromX32 } from "../../src/mixer/x32-paths.js";

// Paths are Mixing Station's (0-based, `ch.0` is channel 1); addresses are the
// X32's (1-based, two digits).
describe("toX32", () => {
  it("maps a channel fader", () => {
    expect(toX32("ch.0.mix.lvl")).toEqual({ address: "/ch/01/mix/fader", kind: "level" });
    expect(toX32("ch.31.mix.lvl")).toEqual({ address: "/ch/32/mix/fader", kind: "level" });
  });

  it("maps a channel mute", () => {
    expect(toX32("ch.4.mix.on")).toEqual({ address: "/ch/05/mix/on", kind: "on" });
  });

  it("maps a bus fader and mute", () => {
    expect(toX32("bus.0.mix.lvl")).toEqual({ address: "/bus/01/mix/fader", kind: "level" });
    expect(toX32("bus.15.mix.on")).toEqual({ address: "/bus/16/mix/on", kind: "on" });
  });

  it("rejects an index past the end of the bank", () => {
    expect(() => toX32("ch.32.mix.lvl")).toThrow(/ch\.32/);
    expect(() => toX32("bus.16.mix.lvl")).toThrow(/bus\.16/);
  });

  it("rejects a path it doesn't support rather than ignoring it", () => {
    expect(() => toX32("dca.0.lvl")).toThrow(/dca\.0\.lvl/);
    expect(() => toX32("ch.0.mix.pan")).toThrow(/ch\.0\.mix\.pan/);
    expect(() => toX32("ch.x.mix.lvl")).toThrow();
  });
});

describe("fromX32", () => {
  it("maps addresses back to paths", () => {
    expect(fromX32("/ch/01/mix/fader")).toEqual({ path: "ch.0.mix.lvl", kind: "level" });
    expect(fromX32("/ch/05/mix/on")).toEqual({ path: "ch.4.mix.on", kind: "on" });
    expect(fromX32("/bus/16/mix/fader")).toEqual({ path: "bus.15.mix.lvl", kind: "level" });
  });

  it("returns null for addresses outside the supported set", () => {
    // The board sends every change on /xremote; most of it is not ours to model.
    expect(fromX32("/ch/01/mix/pan")).toBeNull();
    expect(fromX32("/dca/1/fader")).toBeNull();
    expect(fromX32("/xinfo")).toBeNull();
  });
});
