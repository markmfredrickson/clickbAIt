import { describe, it, expect } from "vitest";
import {
  initialSetState,
  step,
  ringProgress,
  type SetState,
  type SetEvent,
  type SetSong,
} from "../../src/fader-now/set-state.js";

// A song whose last section ends at beat 128, with 4 s of ring-out.
const SONG: SetSong = { id: "somebody", endBeat: 128, ringOutSec: 4 };
const OTHER: SetSong = { id: "dirty-work", endBeat: 96, ringOutSec: 2 };

/** Run a sequence of events from a starting state. */
function run(events: SetEvent[], from: SetState = initialSetState): SetState {
  return events.reduce(step, from);
}

const load = (song = SONG): SetEvent => ({ type: "song-loaded", song });
const play = (beat = 0, now = 0): SetEvent => ({ type: "transport", playing: true, beat, now });
const stop = (beat: number, now: number): SetEvent => ({ type: "transport", playing: false, beat, now });
const at = (beat: number, now: number, bailed = false): SetEvent => ({ type: "position", beat, now, bailed });
const tick = (now: number): SetEvent => ({ type: "tick", now });
const endSong = (now: number): SetEvent => ({ type: "end-song", now });

/** A state playing SONG, at beat 100, time 50 s. */
const playing = () => run([load(), play(0, 0), at(100, 50_000)]);

describe("set state — starting a song", () => {
  it("starts between songs with nothing loaded", () => {
    expect(initialSetState).toEqual({ mode: "between", song: null });
  });

  it("loading a song while stopped stays between songs, with the song ready", () => {
    const s = run([load()]);
    expect(s.mode).toBe("between");
    expect(s.song).toEqual(SONG);
  });

  it("pressing play inside the song starts playing", () => {
    expect(run([load(), play(0, 0)]).mode).toBe("playing");
  });

  it("pressing play with no song loaded stays between songs", () => {
    expect(run([play(0, 0)]).mode).toBe("between");
  });

  it("pressing play past the song's end stays between songs", () => {
    expect(run([load(), play(130, 0)]).mode).toBe("between");
  });
});

describe("set state — ending a song", () => {
  it("crossing the end of the last section starts ringing out", () => {
    const s = step(playing(), at(128, 60_000));
    expect(s.mode).toBe("ringing");
    expect(ringProgress(s, 60_000)).toBe(0);
  });

  it("ring-out progress runs 0 → 1 over the ring-out, in seconds", () => {
    const s = step(playing(), at(128, 60_000));
    expect(ringProgress(s, 62_000)).toBeCloseTo(0.5, 9);
    expect(ringProgress(s, 64_000)).toBe(1);
    expect(ringProgress(s, 90_000)).toBe(1);
  });

  it("goes between songs when the ring-out has run its length", () => {
    const ringing = step(playing(), at(128, 60_000));
    expect(step(ringing, tick(63_999)).mode).toBe("ringing");
    expect(step(ringing, tick(64_000)).mode).toBe("between");
  });

  it("a song with no ring-out goes straight between songs", () => {
    const s = run([load({ ...SONG, ringOutSec: 0 }), play(0, 0), at(128, 60_000)]);
    expect(s.mode).toBe("between");
  });

  it("stopping the transport while ringing out goes between songs at once", () => {
    const ringing = step(playing(), at(128, 60_000));
    expect(step(ringing, stop(129, 61_000)).mode).toBe("between");
  });

  it("stopping the transport while playing is a pause, not an end", () => {
    expect(step(playing(), stop(100, 51_000)).mode).toBe("playing");
  });

  it("an end-song tap while playing starts ringing out from the tap", () => {
    const s = step(playing(), endSong(52_000));
    expect(s.mode).toBe("ringing");
    expect(ringProgress(s, 54_000)).toBeCloseTo(0.5, 9);
    expect(step(s, tick(56_000)).mode).toBe("between");
  });
});

describe("set state — bail, seek and vamp", () => {
  it("while bailed, crossing the song's end does not start ringing out", () => {
    const s = step(playing(), at(130, 61_000, true));
    expect(s.mode).toBe("playing");
  });

  it("while bailed, an end-song tap still ends the song", () => {
    const s = run([at(130, 61_000, true), endSong(62_000)], playing());
    expect(s.mode).toBe("ringing");
  });

  it("seeking back into the song while ringing out returns to playing", () => {
    const ringing = step(playing(), at(128, 60_000));
    expect(step(ringing, at(64, 61_000)).mode).toBe("playing");
  });

  it("the transport running on after an end-song tap does not resume the song", () => {
    // After the tap the track is still inside the song (the band bailed);
    // positions moving forward must not count as a seek back.
    const s = run([endSong(52_000), at(101, 52_500), at(102, 53_000)], playing());
    expect(s.mode).toBe("ringing");
    expect(step(s, tick(56_000)).mode).toBe("between");
  });

  it("after the song ends, the transport running on does not restart it", () => {
    const s = run([endSong(52_000), tick(56_000), at(104, 57_000)], playing());
    expect(s.mode).toBe("between");
  });

  it("stop, jump back and play after a song ended plays it again", () => {
    const s = run([at(128, 60_000), tick(64_000), stop(140, 65_000), play(0, 70_000)], playing());
    expect(s.mode).toBe("playing");
  });

  it("vamping on the last section never starts ringing out", () => {
    // Loop the last 16 beats (112–128) three times: positions wrap before 128.
    let s = run([at(112, 56_000)], playing());
    for (let pass = 0; pass < 3; pass++) {
      for (let b = 112; b < 128; b += 2) s = step(s, at(b, 60_000 + pass * 8_000 + (b - 112) * 500));
    }
    expect(s.mode).toBe("playing");
  });
});

describe("set state — changing songs", () => {
  it("loading another song while playing goes between songs with the new song ready", () => {
    const s = step(playing(), load(OTHER));
    expect(s.mode).toBe("between");
    expect(s.song).toEqual(OTHER);
  });

  it("loading another song while ringing out does the same", () => {
    const ringing = step(playing(), at(128, 60_000));
    const s = step(ringing, load(OTHER));
    expect(s).toMatchObject({ mode: "between", song: OTHER });
  });
});
