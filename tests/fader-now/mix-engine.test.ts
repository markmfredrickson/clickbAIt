import { describe, it, expect } from "vitest";
import { MixEngine, type MixConfig, type SongMix, type Layer } from "../../src/fader-now/mix-engine.js";
import type { MixerPath, MixerValue } from "../../src/mixer/driver.js";

// The board, as the relay first reads it: the base mix.
//   ch.0  guitar      0 dB, on
//   ch.4  Caitlin    -5 dB, on
//   ch.16 music     -10 dB, off (the song turns it on)
const BOARD: Record<MixerPath, MixerValue> = {
  "ch.0.mix.lvl": 0,
  "ch.0.mix.on": true,
  "ch.4.mix.lvl": -5,
  "ch.4.mix.on": true,
  "ch.16.mix.lvl": -10,
  "ch.16.mix.on": false,
};

// Between songs: guitar muted, Caitlin's mic up 3 for banter.
// Bailed: the backing track pulled down 20.
const CONFIG: MixConfig = {
  between: { "ch.0.mix.on": false, "ch.4.mix.lvl": 3 },
  bail: { "ch.16.mix.lvl": -20 },
  glideSec: { toPlaying: 1, toBailed: 0.5, fromBailed: 0 },
};

// The song turns the backing track on. Guitar solo +3 over beats 64–80;
// Caitlin's vocal off for the glock part, beats 32–48.
const moves = (beat: number): Layer => ({
  ...(beat >= 64 && beat < 80 ? { "ch.0.mix.lvl": 3 } : {}),
  ...(beat >= 32 && beat < 48 ? { "ch.4.mix.on": false } : {}),
});
const SONG: SongMix = { settings: { "ch.16.mix.on": true }, moves, ringOutSec: 4 };
const NEXT_SONG: SongMix = { settings: {}, moves: () => ({}), ringOutSec: 2 };

/** A list of sends as an object (the last value for each path wins). */
const asMap = (sends: [MixerPath, MixerValue][]) => Object.fromEntries(sends);

/** An engine that has settled into playing SONG at beat 0 (time 10 s). */
function playingEngine(): MixEngine {
  const e = new MixEngine(BOARD, CONFIG);
  e.update("between", 0, 0);
  e.setSong(SONG);
  e.update("playing", 0, 0);
  e.update("playing", 0, 10_000);
  return e;
}

/** The value the engine currently has on the board for a path. */
const on = (e: MixEngine, path: MixerPath) => e.sent(path);

describe("mix engine — sent values are absolute", () => {
  it("sends base + move during a move", () => {
    const e = playingEngine();
    expect(asMap(e.update("playing", 64, 20_000))).toEqual({ "ch.0.mix.lvl": 3 });
  });

  it("looping over a +3 section many times never sends more than base + 3", () => {
    const e = playingEngine();
    const seen: number[] = [];
    for (let pass = 0; pass < 10; pass++) {
      for (const b of [60, 64, 70, 79, 60]) {
        e.update("playing", b, 20_000 + pass * 1_000 + b);
        seen.push(on(e, "ch.0.mix.lvl") as number);
      }
    }
    expect(Math.max(...seen)).toBe(3);
    expect(Math.min(...seen)).toBe(0);
  });

  it("stop inside a move, jump back before it, play: base, then base + move again", () => {
    const e = playingEngine();
    e.update("playing", 70, 20_000);
    expect(on(e, "ch.0.mix.lvl")).toBe(3);
    expect(asMap(e.update("playing", 10, 30_000))).toEqual({ "ch.0.mix.lvl": 0 });
    expect(asMap(e.update("playing", 64, 40_000))).toEqual({ "ch.0.mix.lvl": 3 });
  });

  it("playing layers song settings and moves on the base", () => {
    const e = playingEngine();
    expect(on(e, "ch.16.mix.on")).toBe(true); // song setting
    e.update("playing", 40, 20_000);
    expect(on(e, "ch.4.mix.on")).toBe(false); // move
    expect(on(e, "ch.4.mix.lvl")).toBe(-5); // base, untouched
  });

  it("bailed keeps song settings, drops moves and adds the bail mix", () => {
    const e = playingEngine();
    e.update("playing", 70, 20_000);
    e.update("bailed", 70, 21_000);
    e.update("bailed", 70, 25_000); // past the 0.5 s glide
    expect(on(e, "ch.0.mix.lvl")).toBe(0); // the solo move is gone
    expect(on(e, "ch.16.mix.on")).toBe(true); // song setting stays
    expect(on(e, "ch.16.mix.lvl")).toBe(-30); // base -10, bail -20
  });

  it("between songs is the base plus the between mix, and nothing from the song", () => {
    const e = new MixEngine(BOARD, CONFIG);
    e.setSong(SONG);
    e.update("between", 0, 0);
    expect(on(e, "ch.0.mix.on")).toBe(false);
    expect(on(e, "ch.4.mix.lvl")).toBe(-2);
    expect(on(e, "ch.16.mix.on")).toBe(false);
  });

  it("clamps a boost at the top of the fader", () => {
    const e = new MixEngine({ ...BOARD, "ch.0.mix.lvl": 8 }, CONFIG);
    e.setSong(SONG);
    e.update("playing", 0, 0);
    e.update("playing", 64, 10_000);
    expect(on(e, "ch.0.mix.lvl")).toBe(10);
  });

  it("sends only what changed", () => {
    const e = playingEngine();
    e.update("playing", 64, 20_000);
    expect(e.update("playing", 65, 20_500)).toEqual([]);
  });

  it("rejects a layer that names a path the board wasn't read for", () => {
    expect(() => new MixEngine(BOARD, { ...CONFIG, bail: { "ch.9.mix.lvl": -6 } })).toThrow(/ch\.9\.mix\.lvl/);
  });
});

describe("mix engine — nudges", () => {
  it("a nudge during a song moves the base, so it carries into later sections and songs", () => {
    const e = playingEngine();
    e.update("playing", 70, 20_000); // solo: guitar at +3
    e.boardChanged("ch.0.mix.lvl", 1, 20_500); // someone pulls it to +1
    expect(e.update("playing", 90, 30_000)).toEqual([["ch.0.mix.lvl", -2]]); // base is now -2

    e.update("between", 0, 40_000);
    e.setSong(NEXT_SONG);
    e.update("playing", 0, 50_000);
    e.update("playing", 0, 60_000);
    expect(on(e, "ch.0.mix.lvl")).toBe(-2);
  });

  it("a nudge between songs changes only the between mix", () => {
    const e = new MixEngine(BOARD, CONFIG);
    e.update("between", 0, 0);
    e.boardChanged("ch.4.mix.lvl", 1, 1_000); // banter mic from -2 to +1
    e.setSong(NEXT_SONG);
    e.update("playing", 0, 2_000);
    e.update("playing", 0, 10_000);
    expect(on(e, "ch.4.mix.lvl")).toBe(-5); // the song level is untouched
    e.update("between", 0, 20_000);
    e.update("between", 0, 30_000);
    expect(on(e, "ch.4.mix.lvl")).toBe(1); // and between songs remembers +1
  });

  it("a nudge while bailed changes only the bail mix", () => {
    const e = playingEngine();
    e.update("bailed", 10, 20_000);
    e.update("bailed", 10, 21_000);
    e.boardChanged("ch.16.mix.lvl", -25, 21_500); // bail mix from -30 to -25
    e.update("playing", 10, 22_000);
    expect(on(e, "ch.16.mix.lvl")).toBe(-10);
    e.update("bailed", 10, 23_000);
    e.update("bailed", 10, 24_000);
    expect(on(e, "ch.16.mix.lvl")).toBe(-25);
  });

  it("unmuting a mic the song keeps off holds until the song ends", () => {
    const e = playingEngine();
    e.update("playing", 34, 20_000); // glock part: Caitlin off
    e.boardChanged("ch.4.mix.on", true, 20_500); // someone turns her back on
    e.update("playing", 60, 21_000);
    e.update("playing", 36, 22_000); // loop back into the glock part
    expect(on(e, "ch.4.mix.on")).toBe(true);

    // The song ends, then gets played again without reloading (rehearsal).
    e.update("between", 0, 30_000);
    e.update("playing", 34, 40_000);
    e.update("playing", 34, 50_000);
    expect(on(e, "ch.4.mix.on")).toBe(false); // the hold ended with the song
  });

  it("a re-read takes the board as the base and re-applies the layers", () => {
    const e = playingEngine();
    e.update("playing", 70, 20_000);
    // A scene recall puts the board back to its scene values, guitar at -1.
    e.reread({ ...BOARD, "ch.0.mix.lvl": -1, "ch.16.mix.on": false });
    expect(asMap(e.update("playing", 70, 21_000))).toEqual({ "ch.0.mix.lvl": 2, "ch.16.mix.on": true });
  });

  it("after a restart, a boosted fader is not read as its base", () => {
    const e = playingEngine();
    e.update("playing", 70, 20_000); // guitar +3 for the solo
    const saved = JSON.parse(JSON.stringify(e.snapshot()));

    // The relay restarts; the board still shows the boost.
    const board = { ...BOARD, "ch.0.mix.lvl": 3, "ch.16.mix.on": true };
    const restored = MixEngine.restore(saved, CONFIG, board);
    restored.setSong(SONG);
    restored.update("playing", 90, 30_000);
    restored.update("playing", 90, 40_000);
    expect(on(restored, "ch.0.mix.lvl")).toBe(0);
  });

  it("a restart keeps nudges made to the between and bail mixes", () => {
    const e = new MixEngine(BOARD, CONFIG);
    e.update("between", 0, 0);
    e.boardChanged("ch.4.mix.lvl", 1, 1_000);
    const saved = JSON.parse(JSON.stringify(e.snapshot()));
    const restored = MixEngine.restore(saved, CONFIG, { ...BOARD, "ch.4.mix.lvl": 1, "ch.0.mix.on": false });
    restored.update("between", 0, 2_000);
    expect(on(restored, "ch.4.mix.lvl")).toBe(1);
  });
});

describe("mix engine — glides", () => {
  it("glides from the song's mix to the between mix over the ring-out", () => {
    const e = playingEngine();
    e.update("between", 100, 20_000); // ring-out starts: 4 s
    e.update("between", 100, 22_000);
    expect(on(e, "ch.4.mix.lvl")).toBeCloseTo(-3.5, 9); // halfway from -5 to -2
    e.update("between", 100, 24_000);
    expect(on(e, "ch.4.mix.lvl")).toBe(-2);
  });

  it("fading into a mute ends muted with the fader back at its base", () => {
    const e = playingEngine();
    e.update("between", 100, 20_000);
    e.update("between", 100, 22_000);
    // Halfway: still on, fader halfway down to the bottom (-90).
    expect(on(e, "ch.0.mix.on")).toBe(true);
    expect(on(e, "ch.0.mix.lvl")).toBeCloseTo(-45, 9);

    const end = e.update("between", 100, 24_000).filter(([p]) => p.startsWith("ch.0."));
    // The mute goes out before the fader is restored behind it.
    expect(end).toEqual([["ch.0.mix.on", false], ["ch.0.mix.lvl", 0]]);
  });

  it("fading in from a mute starts at the bottom, then unmutes, then rises", () => {
    const e = new MixEngine(BOARD, CONFIG);
    e.update("between", 0, 0); // guitar muted between songs
    e.setSong(NEXT_SONG);
    const start = e.update("playing", 0, 1_000).filter(([p]) => p.startsWith("ch.0."));
    expect(start).toEqual([["ch.0.mix.lvl", -90], ["ch.0.mix.on", true]]);
    e.update("playing", 0, 1_500);
    expect(on(e, "ch.0.mix.lvl")).toBeCloseTo(-45, 9);
    e.update("playing", 0, 2_000);
    expect(on(e, "ch.0.mix.lvl")).toBe(0);
  });

  it("a zero-length change into a mute mutes first, then sets the fader", () => {
    const e = new MixEngine(BOARD, { ...CONFIG, between: { "ch.0.mix.on": false, "ch.0.mix.lvl": -6 } });
    e.setSong(NEXT_SONG);
    e.update("playing", 0, 0);
    e.update("playing", 0, 10_000);
    e.setSong({ ...NEXT_SONG, ringOutSec: 0 });
    const sends = e.update("between", 0, 20_000).filter(([p]) => p.startsWith("ch.0."));
    expect(sends).toEqual([["ch.0.mix.on", false], ["ch.0.mix.lvl", -6]]);
  });

  it("a hand on a fader mid-glide stops that fader's glide and goes to the target mix", () => {
    const e = playingEngine();
    e.update("between", 100, 20_000);
    e.update("between", 100, 21_000);
    e.boardChanged("ch.4.mix.lvl", 0, 21_500); // someone grabs Caitlin's fader
    const sends = asMap(e.update("between", 100, 22_000));
    expect(sends).not.toHaveProperty("ch.4.mix.lvl"); // no longer gliding
    expect(sends).toHaveProperty("ch.0.mix.lvl"); // the guitar still is
    e.update("between", 100, 30_000);
    expect(on(e, "ch.4.mix.lvl")).toBe(0);

    // The nudge went to the between mix (+5 over base), not the base.
    e.setSong(NEXT_SONG);
    e.update("playing", 0, 40_000);
    e.update("playing", 0, 50_000);
    expect(on(e, "ch.4.mix.lvl")).toBe(-5);
    e.update("between", 0, 60_000);
    e.update("between", 0, 70_000);
    expect(on(e, "ch.4.mix.lvl")).toBe(0);
  });
});
