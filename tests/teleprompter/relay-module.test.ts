import { describe, it, expect } from "vitest";
import { relayMode, runModule, type RelayModule, type RelaySnapshot } from "../../src/teleprompter/relay-module.js";
import type { ShowState } from "../../src/teleprompter/show-state.js";

/**
 * Every relay module (lights now; the stage clock and others later) handles every relay mode.
 * The handler table is typed from the RelayMode union, so a new mode is a compile error in every
 * module until it decides what to do there.
 */
const show = (mode: ShowState["mode"]): ShowState => ({ mode, at: 0 });
const base = { session: true, playing: true, show: show("following"), lastReportMs: 1000, nowMs: 1100 };

describe("relayMode", () => {
  it("is halted when no session is running, whatever REAPER does", () => {
    expect(relayMode({ ...base, session: false })).toBe("halted");
  });
  it("is standby when the session runs but the transport is stopped", () => {
    expect(relayMode({ ...base, playing: false })).toBe("standby");
  });
  it("is standby after an explicit stop from the control", () => {
    expect(relayMode({ ...base, show: show("stopped") })).toBe("standby");
  });
  it("is playing while following the timeline", () => {
    expect(relayMode(base)).toBe("playing");
  });
  it("is vamping through a loop and its tap-out", () => {
    expect(relayMode({ ...base, show: show("vamping") })).toBe("vamping");
    expect(relayMode({ ...base, show: show("leaving") })).toBe("vamping");
  });
  it("is bailed when the band is off the timeline", () => {
    expect(relayMode({ ...base, show: show("out") })).toBe("bailed");
  });
  it("is lost when REAPER says it's playing but its position reports stop", () => {
    expect(relayMode({ ...base, nowMs: base.lastReportMs + 2000 })).toBe("lost");
  });
});

describe("runModule", () => {
  it("calls the handler for the snapshot's mode", () => {
    const seen: string[] = [];
    const m: RelayModule = {
      name: "spy",
      modes: {
        halted: () => seen.push("halted"),
        standby: () => seen.push("standby"),
        playing: (s) => seen.push(`playing@${s.beat}`),
        vamping: () => seen.push("vamping"),
        bailed: () => seen.push("bailed"),
        lost: () => seen.push("lost"),
      },
    };
    const snap: RelaySnapshot = { mode: "playing", beat: 12, beatAt: 0, show: show("following"), slug: null, songDir: null };
    runModule(m, snap, 0);
    expect(seen).toEqual(["playing@12"]);
  });

  it("rejects a module that leaves out a mode (checked by tsc)", () => {
    const partial = {
      name: "partial",
      modes: { halted() {}, standby() {}, playing() {}, vamping() {}, bailed() {} },
    };
    // @ts-expect-error -- no handler for "lost"
    const m: RelayModule = partial;
    expect(m.name).toBe("partial");
  });
});
