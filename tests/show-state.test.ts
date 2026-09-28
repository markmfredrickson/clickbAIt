import { describe, it, expect } from "vitest";
import {
  apply,
  advance,
  sectionAt,
  controlLabel,
  initialState,
  isControllable,
  type ShowSection,
  type ShowState,
} from "../src/teleprompter/show-state.js";

// 4/4, 4 beats per bar. Breakdown is an authored open vamp.
const SECTIONS: ShowSection[] = [
  { name: "Intro", beat: 0, durationBeats: 16 },
  { name: "Verse 1", beat: 16, durationBeats: 32 },
  { name: "Breakdown", beat: 48, durationBeats: 16, vamp: true },
  { name: "Chorus", beat: 64, durationBeats: 32 },
  { name: "Outro", beat: 96, durationBeats: 16 },
];

const tap = (s: ShowState, beat: number) => apply(s, { action: "tap" }, SECTIONS, beat);

describe("sectionAt", () => {
  it("finds the section containing a beat, and clamps past the ends", () => {
    expect(sectionAt(SECTIONS, 0)).toBe(0);
    expect(sectionAt(SECTIONS, 15.9)).toBe(0);
    expect(sectionAt(SECTIONS, 16)).toBe(1);
    expect(sectionAt(SECTIONS, 500)).toBe(4);
    expect(sectionAt(SECTIONS, -10)).toBe(0);
    expect(sectionAt([], 5)).toBe(0);
  });
});

describe("bail and re-entry", () => {
  it("a tap while following goes out and silences click and cues", () => {
    const t = tap(initialState, 20);
    expect(t.state.mode).toBe("out");
    expect(t.effect).toMatchObject({ click: false, cues: false });
  });

  it("a tap while out returns to following at the NEXT section's downbeat", () => {
    const out = tap(initialState, 20).state;          // in Verse 1
    const back = tap(out, 30);                         // still in Verse 1
    expect(back.state.mode).toBe("following");
    expect(back.state.at).toBe(2);                     // Breakdown
    expect(back.effect.locateBeat).toBe(48);           // its downbeat
    expect(back.effect).toMatchObject({ click: true, cues: true });
  });

  it("re-entry from the last section stays on the last section", () => {
    const out = tap(initialState, 100).state;          // Outro
    expect(tap(out, 100).state.at).toBe(4);
  });
});

describe("vamping", () => {
  it("a marked section engages its own vamp on arrival, click on and cue muted", () => {
    const t = advance(initialState, SECTIONS, 48);     // into Breakdown
    expect(t.state.mode).toBe("vamping");
    expect(t.state.loop).toEqual({ from: 2, to: 2 });
    expect(t.effect).toMatchObject({ click: true, cues: false, repeat: true });
    expect(t.effect.loopBeats).toEqual({ from: 48, to: 64 });
  });

  it("a tap while vamping commits to leaving and unmutes the cue for the count-in", () => {
    const vamping = advance(initialState, SECTIONS, 48).state;
    const leaving = tap(vamping, 52);
    expect(leaving.state.mode).toBe("leaving");
    expect(leaving.effect).toMatchObject({ cues: true });
    expect(leaving.effect.repeat).toBeUndefined();      // the pass still finishes
  });

  it("leaving resolves at the loop end, not at the tap", () => {
    const leaving = tap(advance(initialState, SECTIONS, 48).state, 52).state;
    expect(advance(leaving, SECTIONS, 60).state.mode).toBe("leaving");   // mid-pass
    const done = advance(leaving, SECTIONS, 64);                          // loop end
    expect(done.state.mode).toBe("following");
    expect(done.effect).toMatchObject({ repeat: false, click: true, cues: true });
  });

  it("does not re-engage the same marked section it just left", () => {
    const leaving = tap(advance(initialState, SECTIONS, 48).state, 52).state;
    const after = advance(leaving, SECTIONS, 64).state;
    expect(advance(after, SECTIONS, 63).state.mode).toBe("following");
  });

  it("an ad-hoc vamp spans a contiguous range of sections", () => {
    const t = apply(initialState, { action: "vamp", from: 1, to: 3 }, SECTIONS, 20);
    expect(t.state.mode).toBe("vamping");
    expect(t.effect.loopBeats).toEqual({ from: 16, to: 96 });
  });

  it("rejects a backwards or out-of-range vamp instead of looping nonsense", () => {
    for (const bad of [{ from: 3, to: 1 }, { from: -1, to: 2 }, { from: 1, to: 99 }]) {
      const t = apply(initialState, { action: "vamp", ...bad }, SECTIONS, 20);
      expect(t.state).toEqual(initialState);
      expect(t.effect).toEqual({});
    }
  });

  it("ignores a vamp requested while not following", () => {
    const out = tap(initialState, 20).state;
    expect(apply(out, { action: "vamp", from: 1, to: 2 }, SECTIONS, 20).state).toEqual(out);
  });
});

describe("stop", () => {
  it("stops from any state and silences everything", () => {
    for (const s of [initialState, tap(initialState, 20).state, advance(initialState, SECTIONS, 48).state]) {
      const t = apply(s, { action: "stop" }, SECTIONS, 20);
      expect(t.state.mode).toBe("stopped");
      expect(t.effect).toMatchObject({ click: false, cues: false, repeat: false, transport: "stop" });
    }
  });

  it("nothing re-arms from stopped without an explicit restart", () => {
    const stopped = apply(initialState, { action: "stop" }, SECTIONS, 20).state;
    expect(tap(stopped, 20).state.mode).toBe("stopped");
    expect(advance(stopped, SECTIONS, 48).state.mode).toBe("stopped");
    expect(apply(stopped, { action: "restart" }, SECTIONS, 20).state.mode).toBe("following");
  });
});

describe("controlLabel", () => {
  it("names the action, and while out names the section you'll land in", () => {
    expect(controlLabel(initialState, SECTIONS).main).toBe("Bail");
    const out = tap(initialState, 20).state;
    expect(controlLabel(out, SECTIONS)).toEqual({ main: "Tap on the 1", sub: "Breakdown" });
    expect(controlLabel(advance(initialState, SECTIONS, 48).state, SECTIONS).main).toBe("Tap to continue");
  });
});

describe("no song loaded", () => {
  // The relay starts before REAPER names a song, so every entry point has to
  // survive an empty section list. Re-entry used to index off the end here,
  // which threw inside the relay's socket handler and deafened the control
  // page for the rest of the session.
  it("bails and returns without a section list", () => {
    const out = apply(initialState, { action: "tap" }, [], 0);
    expect(out.state.mode).toBe("out");
    const back = apply(out.state, { action: "tap" }, [], 0);
    expect(back.state.mode).toBe("following");
    expect(back.effect.locateBeat).toBeUndefined();
    expect(back.effect).toMatchObject({ click: true, cues: true });
  });

  it("advances and labels without a section list", () => {
    expect(advance(initialState, [], 0).state).toEqual(initialState);
    expect(controlLabel(initialState, []).main).toBe("Bail");
    const out = apply(initialState, { action: "tap" }, [], 0).state;
    expect(controlLabel(out, []).main).toBe("Tap on the 1");
  });

  it("rejects a vamp with no sections, and non-integer bounds", () => {
    expect(apply(initialState, { action: "vamp", from: 0, to: 0 }, [], 0).state).toEqual(initialState);
    expect(
      apply(initialState, { action: "vamp", from: 0.5, to: 2 } as never, SECTIONS, 0).state,
    ).toEqual(initialState);
  });
});

describe("untrusted intents", () => {
  // These arrive off an open socket on the band's LAN. An unknown action used
  // to fall through to the tap branch, so any stray string could bail the show.
  it("an unknown action changes nothing", () => {
    for (const action of ["nonsense", "", "TAP", "bail", "play"]) {
      const t = apply(initialState, { action } as never, SECTIONS, 20);
      expect(t.state).toEqual(initialState);
      expect(t.effect).toEqual({});
    }
  });

  it("an unknown action can't sneak past while out either", () => {
    const out = apply(initialState, { action: "tap" }, SECTIONS, 20).state;
    expect(apply(out, { action: "nope" } as never, SECTIONS, 20).state).toEqual(out);
  });
});

describe("transport stopped", () => {
  // Found live: a vamp entered before the song started could never be left,
  // because leaving resolves at the loop end and the beat never advances.
  it("refuses a bail or a vamp when the transport isn't rolling", () => {
    const notPlaying = false;
    expect(apply(initialState, { action: "tap" }, SECTIONS, 0, notPlaying).state).toEqual(initialState);
    expect(apply(initialState, { action: "vamp", from: 1, to: 2 }, SECTIONS, 0, notPlaying).state)
      .toEqual(initialState);
  });

  it("still allows stop and restart while not rolling", () => {
    expect(apply(initialState, { action: "stop" }, SECTIONS, 0, false).state.mode).toBe("stopped");
    const stopped = apply(initialState, { action: "stop" }, SECTIONS, 0, false).state;
    expect(apply(stopped, { action: "restart" }, SECTIONS, 0, false).state.mode).toBe("following");
  });

  it("isControllable is false when stopped or when the show was ended", () => {
    expect(isControllable(initialState, true)).toBe(true);
    expect(isControllable(initialState, false)).toBe(false);
    const ended = apply(initialState, { action: "stop" }, SECTIONS, 0).state;
    expect(isControllable(ended, true)).toBe(false);
  });
});
