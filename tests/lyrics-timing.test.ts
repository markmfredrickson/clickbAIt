import { describe, it, expect } from "vitest";
import { Curve } from "../src/core/curve.js";
import {
  recordingCurveFromBeats,
  bridgeTokens,
  type AlignInput,
} from "../src/build/lyrics-timing.js";

/** Build a one-word align input with the given per-char (text, startMs, endMs). */
function word(text: string, chars: [string, number, number][]): AlignInput {
  return {
    words: [
      {
        text,
        startMs: chars[0][1],
        endMs: chars[chars.length - 1][2],
        chars: chars.map(([t, s, e]) => ({ text: t, startMs: s, endMs: e })),
      },
    ],
  };
}

describe("bridgeTokens", () => {
  // -- #1 Identity: same curve in and out -> song time == source time --------
  it("maps source time straight through when both curves match", () => {
    const rec = Curve.constantBpm(120); // recording time <-> beat
    const song = Curve.constantBpm(120); // beat <-> song time, no pre-roll
    const [tok] = bridgeTokens(word("hi", [["h", 1000, 1050], ["i", 1100, 1200]]), rec, song);
    expect(tok.startT).toBeCloseTo(1.0); // 1000ms
    expect(tok.startB).toBeCloseTo(2.0); // 120bpm -> 2 beats/sec
    expect(tok.endT).toBeCloseTo(1.2);
    expect(tok.chars[1].startT).toBeCloseTo(1.1); // "i" at 1100ms
  });

  // -- #2 Routes through BEAT, not seconds -----------------------------------
  it("converts via beat, not raw seconds, when tempos differ", () => {
    const rec = Curve.constantBpm(120); // source 2.0s -> beat 4
    const song = Curve.constantBpm(180); // beat 4 -> 4 / 3 beats/sec = 1.333s
    const [tok] = bridgeTokens(word("go", [["g", 2000, 2050], ["o", 2050, 2100]]), rec, song);
    expect(tok.startB).toBeCloseTo(4.0);
    expect(tok.startT).toBeCloseTo(4 / 3); // NOT 2.0
  });

  // -- #4 Char + word propagation --------------------------------------------
  it("populates every char and spans the word start..end", () => {
    const rec = Curve.constantBpm(120);
    const song = Curve.constantBpm(120);
    const [tok] = bridgeTokens(
      word("cat", [["c", 1000, 1050], ["a", 1100, 1180], ["t", 1200, 1260]]),
      rec,
      song,
    );
    expect(tok.chars).toHaveLength(3);
    expect(tok.chars.map((c) => c.text).join("")).toBe("cat");
    // strictly increasing char start times
    expect(tok.chars[0].startT).toBeLessThan(tok.chars[1].startT);
    expect(tok.chars[1].startT).toBeLessThan(tok.chars[2].startT);
    // word spans first char start .. last char end
    expect(tok.startT).toBeCloseTo(tok.chars[0].startT);
    expect(tok.endT).toBeCloseTo(tok.chars[2].endT);
  });

  // -- #5 Pre-roll shifts song time, leaves beat untouched -------------------
  it("applies the song curve's pre-roll offset to time but not beat", () => {
    const rec = Curve.constantBpm(120);
    const song = Curve.constantBpm(120, { t0: 8.0 }); // 8s slug pad
    const [tok] = bridgeTokens(word("hi", [["h", 1000, 1050], ["i", 1100, 1200]]), rec, song);
    expect(tok.startB).toBeCloseTo(2.0); // beat unchanged
    expect(tok.startT).toBeCloseTo(9.0); // 8.0 pad + 1.0
  });

  // -- #6 Internal consistency: beat fed back through song curve == time -----
  it("derived beat round-trips through the song curve to its time", () => {
    const rec = Curve.constantBpm(131);
    const song = Curve.constantBpm(122.449, { t0: 7.84 });
    const tokens = bridgeTokens(
      word("seven", [
        ["s", 16440, 16460], ["e", 16500, 16540], ["v", 16560, 16600],
        ["e", 16620, 16660], ["n", 16700, 16740],
      ]),
      rec,
      song,
    );
    for (const tok of tokens) {
      expect(song.toTime(tok.startB)).toBeCloseTo(tok.startT, 9);
      for (const c of tok.chars) {
        expect(song.toTime(c.startB)).toBeCloseTo(c.startT, 9);
      }
    }
  });
});

describe("recordingCurveFromBeats", () => {
  // -- #3 Anchor/offset: detected-beat index -> musical beat -----------------
  it("offsets detected beats so the anchor lands on its musical beat", () => {
    // 122.45 BPM-ish grid, first detected beat at 0.26s (mirrors Seven Nation Army).
    const beats = Array.from({ length: 60 }, (_, i) => ({ time: 0.26 + 0.49 * i }));
    // Declare: detected beat #2 is musical beat 0 (so offset = -2).
    const anchor = { t: beats[2].time, b: 0 };
    const rec = recordingCurveFromBeats(beats, anchor);

    // A word measured at detected beat 35's time should land on musical beat 33.
    expect(rec.toBeat(beats[35].time)).toBeCloseTo(33);
    // And the anchor time resolves to exactly its declared musical beat.
    expect(rec.toBeat(anchor.t)).toBeCloseTo(0);
  });

  it("supports a fractional anchor beat", () => {
    const beats = Array.from({ length: 20 }, (_, i) => ({ time: 0.5 * i }));
    // Anchor halfway between detected beats 4 and 5, called musical beat 1.0.
    const anchor = { t: 2.25, b: 1.0 };
    const rec = recordingCurveFromBeats(beats, anchor);
    expect(rec.toBeat(anchor.t)).toBeCloseTo(1.0);
    // One detected-beat later in time is one musical beat later.
    expect(rec.toBeat(2.75)).toBeCloseTo(2.0);
  });

  it("composes with bridgeTokens to mirror the Seven Nation Army case", () => {
    const beats = Array.from({ length: 60 }, (_, i) => ({ time: 0.26 + 0.49 * i }));
    // No bar-1 offset here (detected beat 0 = musical beat 0) — just showing
    // the measured onset lands near beat 33, the index that's plausible given
    // Jack White pushes ahead of the grid, NOT the eyeballed authored beat 35.
    const rec = recordingCurveFromBeats(beats, { t: beats[0].time, b: 0 });
    const song = Curve.constantBpm(122.449);
    // "I'm" measured at ~16.44s.
    const [tok] = bridgeTokens(word("im", [["i", 16440, 16460], ["m", 16520, 16540]]), rec, song);
    expect(tok.startB).toBeGreaterThan(32);
    expect(tok.startB).toBeLessThan(34); // ~33, not the authored 35
  });
});
