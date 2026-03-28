import { describe, it, expect } from "vitest";
import { linearize, type LinearEvent } from "../src/linearize.js";
import { song, seq, span, bars, beats, cue, chord, lyric, marker } from "../src/dsongl.js";

/** Helper: find events by type */
function ofType(events: LinearEvent[], type: string) {
  return events.filter((e) => e.type === type);
}

describe("linearize", () => {
  it("single span, one event at offset 0", () => {
    const s = song("Test", 120,
      span("A", bars(1), [marker("hi", 0)]),
    );
    const events = linearize(s);
    const markers = ofType(events, "marker");
    expect(markers).toHaveLength(1);
    expect(markers[0].beat).toBe(0);
    expect(markers[0].seconds).toBe(0);
    expect(markers[0].value).toBe("hi");
  });

  it("event with beat offset", () => {
    const s = song("Test", 120,
      span("A", bars(2), [marker("hi", 4)]),
    );
    const events = linearize(s);
    const markers = ofType(events, "marker");
    expect(markers[0].beat).toBe(4);
  });

  it("sequence of two spans", () => {
    const s = song("Test", 120,
      seq(
        span("A", bars(2), [marker("first", 0)]),
        span("B", bars(2), [marker("second", 0)]),
      ),
    );
    const events = linearize(s);
    const markers = ofType(events, "marker");
    expect(markers[0].beat).toBe(0);
    expect(markers[0].value).toBe("first");
    expect(markers[1].beat).toBe(8); // 2 bars × 4 beats
    expect(markers[1].value).toBe("second");
  });

  it("span nested in span", () => {
    const s = song("Test", 120,
      span("Outer", bars(4), [
        span("Inner", bars(2), { tag: "inner" }, [
          marker("deep", 2),
        ]),
      ]),
    );
    const events = linearize(s);
    const markers = ofType(events, "marker");
    expect(markers[0].beat).toBe(2);
    expect(markers[0].value).toBe("deep");
  });

  it("bars resolution with different time signatures", () => {
    const s44 = song("Test", 120,
      span("A", bars(2), [marker("end", 0)]),
    );
    // bars(2) in 4/4 = 8 beats total duration

    const s54 = song("Test", 120, { timeSignature: [5, 4] },
      span("A", bars(2), [marker("end", 0)]),
    );
    // bars(2) in 5/4 = 10 beats total duration

    // Verify by placing a span after and checking its offset
    const s44seq = song("Test", 120,
      seq(
        span("A", bars(2)),
        span("B", bars(1), [marker("here", 0)]),
      ),
    );
    const s54seq = song("Test", 120, { timeSignature: [5, 4] },
      seq(
        span("A", bars(2)),
        span("B", bars(1), [marker("here", 0)]),
      ),
    );
    const markers44 = ofType(linearize(s44seq), "marker");
    const markers54 = ofType(linearize(s54seq), "marker");
    expect(markers44[0].beat).toBe(8);
    expect(markers54[0].beat).toBe(10);
  });

  it("BPM inheritance — child without BPM uses parent", () => {
    const s = song("Test", 120,
      seq(
        span("A", bars(1), [marker("a", 0)]),
        span("B", bars(1), [marker("b", 0)]),
      ),
    );
    const events = linearize(s);
    const markers = ofType(events, "marker");
    // At 120 BPM, 4 beats = 2 seconds
    expect(markers[0].seconds).toBe(0);
    expect(markers[1].seconds).toBeCloseTo(2.0);
  });

  it("BPM override emits tempo event and adjusts seconds", () => {
    const s = song("Test", 120,
      seq(
        span("Slow", bars(1), [marker("a", 0)]),
        span("Fast", bars(1), { bpm: 240 }, [marker("b", 0)]),
        span("After", bars(1), [marker("c", 0)]),
      ),
    );
    const events = linearize(s);
    const tempos = ofType(events, "tempo");
    // Should have tempo events: 120 at start, 240 at beat 4, 120 restored at beat 8
    expect(tempos.length).toBeGreaterThanOrEqual(2);
    expect(tempos.find((e) => e.beat === 4)?.value).toBe("240");
    // The "After" span restores original BPM
    expect(tempos.find((e) => e.beat === 8)?.value).toBe("120");

    const markers = ofType(events, "marker");
    const a = markers.find((e) => e.value === "a")!;
    const b = markers.find((e) => e.value === "b")!;
    const c = markers.find((e) => e.value === "c")!;
    // a at beat 0: 0s
    expect(a.seconds).toBe(0);
    // b at beat 4: 4 beats at 120 BPM = 2s
    expect(b.seconds).toBeCloseTo(2.0);
    // c at beat 8: 2s + 4 beats at 240 BPM = 2s + 1s = 3s
    expect(c.seconds).toBeCloseTo(3.0);
  });

  it("time signature override resolves bars in child", () => {
    const s = song("Test", 120,
      seq(
        span("Waltz", bars(2), { timeSignature: [3, 4] }, [marker("a", 0)]),
        span("Normal", bars(1), [marker("b", 0)]),
      ),
    );
    const events = linearize(s);
    const markers = ofType(events, "marker");
    // bars(2) in 3/4 = 6 beats
    expect(markers[1].beat).toBe(6);
  });

  it("time signature change emits timesig events and reverts", () => {
    const s = song("Test", 120,
      seq(
        span("Normal", bars(1), [marker("a", 0)]),
        span("Waltz", bars(2), { timeSignature: [3, 4] }, [marker("b", 0)]),
        span("Back", bars(1), [marker("c", 0)]),
      ),
    );
    const events = linearize(s);
    const tsEvents = ofType(events, "timesig");
    // Should insert [3,4] at beat 4 and restore [4,4] at beat 10
    expect(tsEvents.find((e) => e.beat === 4)?.value).toBe("3/4");
    expect(tsEvents.find((e) => e.beat === 10)?.value).toBe("4/4");
  });

  it("negative offset, no underflow", () => {
    const s = song("Test", 120,
      seq(
        span("A", bars(4), [marker("a", 0)]),
        span("B", bars(4), [cue("heads up", -4)]),
      ),
    );
    const events = linearize(s);
    const cues = ofType(events, "cue");
    // B starts at beat 16, cue at -4 = beat 12
    expect(cues[0].beat).toBe(12);
  });

  it("negative offset underflow pads full bars", () => {
    const s = song("Test", 120,
      seq(
        span("A", bars(2), [cue("early", -4), marker("a", 0)]),
      ),
    );
    const events = linearize(s);
    const cues = ofType(events, "cue");
    const markers = ofType(events, "marker");
    // A starts at beat 0, cue at -4 would be beat -4
    // Pad 1 bar (4 beats in 4/4), shift everything by 4
    // cue now at beat 0, marker "a" now at beat 4
    expect(cues[0].beat).toBe(0);
    expect(markers[0].beat).toBe(4);
  });

  it("negative offset on first span in sequence pads and shifts all sections", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4), [cue("Intro", -8), marker("intro start", 0)]),
        span("Verse", bars(4), [cue("Verse", -4), marker("verse start", 0)]),
      ),
    );
    const events = linearize(s);
    const cues = ofType(events, "cue");
    const markers = ofType(events, "marker");
    // Intro at beat 0, cue at -8 → pad 2 bars (8 beats in 4/4)
    // After padding: cue "Intro" at beat 0, intro start at beat 8, verse start at beat 24
    expect(cues.find((e) => e.value === "Intro")?.beat).toBe(0);
    expect(markers.find((e) => e.value === "intro start")?.beat).toBe(8);
    expect(markers.find((e) => e.value === "verse start")?.beat).toBe(24);
    // Verse cue at -4 relative to verse start (beat 24) = beat 20, no extra padding needed
    expect(cues.find((e) => e.value === "Verse")?.beat).toBe(20);
  });

  it("tag inheritance — span tag flows to events, child tag wins", () => {
    const s = song("Test", 120,
      span("A", bars(1), { tag: "drums" }, [
        marker("inherited", 0),
        marker("own", 2, "vocals"),
      ]),
    );
    const events = linearize(s);
    const markers = ofType(events, "marker");
    expect(markers.find((e) => e.value === "inherited")?.tag).toBe("drums");
    expect(markers.find((e) => e.value === "own")?.tag).toBe("vocals");
  });

  it("seconds calculation with BPM changes", () => {
    const s = song("Test", 60, // 1 beat per second
      seq(
        span("A", beats(4), [marker("a", 0)]),
        span("B", beats(4), { bpm: 120 }, [marker("b", 0)]),
      ),
    );
    const events = linearize(s);
    const markers = ofType(events, "marker");
    // a at beat 0: 0s (60 BPM = 1 beat/sec)
    expect(markers[0].seconds).toBe(0);
    // b at beat 4: 4 beats at 60 BPM = 4s
    expect(markers[1].seconds).toBeCloseTo(4.0);
  });
});
