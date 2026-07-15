import { describe, it, expect } from "vitest";
import { clipAwareWords } from "../src/build/lyrics-display.js";
import { beatMapCurve } from "../src/core/beat-map.js";
import type { AlignInput } from "../src/build/lyrics-timing.js";

// Simple frame: 60 BPM (1 beat/sec) and a beat-map where source-second == beat,
// so every expected beat is hand-computable.
const bpm = 60;
const curve = beatMapCurve([{ startBeat: 0, times: [0, 1, 2, 3, 4, 5, 6, 7, 8] }], bpm);

const w = (text: string, sec: number): AlignInput["words"][number] => ({
  text,
  startMs: sec * 1000,
  endMs: sec * 1000 + 100,
  chars: [],
});
const align: AlignInput = { words: [w("a", 0.5), w("b", 1.5), w("c", 2.5), w("d", 3.5)] };
const near = (words: { startBeat: number }[]) => words.map((x) => +x.startBeat.toFixed(2));

describe("clipAwareWords", () => {
  it("maps words linearly for one clip over the whole region", () => {
    const { words } = clipAwareWords(align, curve, [{ from: 0, seconds: 4 }], 0, bpm);
    expect(words.map((x) => x.text)).toEqual(["a", "b", "c", "d"]);
    expect(near(words)).toEqual([0.5, 1.5, 2.5, 3.5]);
  });

  it("replays a region: words in a replayed source window appear again, at the replay's beats", () => {
    // clip0 = source 0..4 at timeline 0..4; clip1 = source 1..3 replayed at timeline 4..6.
    const { words } = clipAwareWords(align, curve, [{ from: 0, seconds: 4 }, { from: 1, seconds: 2 }], 0, bpm);
    expect(words.map((x) => x.text)).toEqual(["a", "b", "c", "d", "b", "c"]);
    expect(near(words)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5]);
  });

  it("skips a source region a clip doesn't include", () => {
    // Only source 2..4 plays → just c, d, at the timeline start.
    const { words } = clipAwareWords(align, curve, [{ from: 2, seconds: 2 }], 0, bpm);
    expect(words.map((x) => x.text)).toEqual(["c", "d"]);
    expect(near(words)).toEqual([0.5, 1.5]); // 2.5→0.5, 3.5→1.5 (offset into the clip)
  });

  it("advances the timeline across a silence clip", () => {
    // source 0..2 (a,b), then 2 beats of silence, then source 0..2 replayed (a,b).
    const { words } = clipAwareWords(
      align,
      curve,
      [{ from: 0, seconds: 2 }, { silence: 2 }, { from: 0, seconds: 2 }],
      0,
      bpm,
    );
    expect(words.map((x) => x.text)).toEqual(["a", "b", "a", "b"]);
    expect(near(words)).toEqual([0.5, 1.5, 4.5, 5.5]);
  });

  it("honors a non-zero offset (pickup) as the timeline origin", () => {
    const { words } = clipAwareWords(align, curve, [{ from: 0, seconds: 4 }], 2, bpm);
    expect(near(words)).toEqual([2.5, 3.5, 4.5, 5.5]);
  });
});
