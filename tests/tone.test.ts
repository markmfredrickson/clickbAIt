import { describe, it, expect } from "vitest";
import { noteToFreq, chordWav } from "../src/build/tone.js";

describe("noteToFreq", () => {
  it("anchors A4 at 440 Hz", () => {
    expect(noteToFreq("A4")).toBeCloseTo(440, 6);
  });

  it("computes sharps and octaves (F#3 ≈ 185)", () => {
    expect(noteToFreq("F#3")).toBeCloseTo(184.997, 2);
    expect(noteToFreq("C4")).toBeCloseTo(261.626, 2);
  });

  it("handles flats (Bb4 == A#4)", () => {
    expect(noteToFreq("Bb4")).toBeCloseTo(noteToFreq("A#4"), 6);
  });

  it("is an octave apart for the same note name", () => {
    expect(noteToFreq("F#4") / noteToFreq("F#3")).toBeCloseTo(2, 6);
  });

  it("rejects a malformed note", () => {
    expect(() => noteToFreq("H2")).toThrow();
    expect(() => noteToFreq("F#")).toThrow();
  });
});

describe("chordWav", () => {
  it("writes a 16-bit mono PCM WAV with the right length", () => {
    const rate = 44100;
    const secs = 0.5;
    const buf = chordWav(["F#3", "A#3", "C#4"], secs, rate);
    // RIFF/WAVE header
    expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
    // fmt: PCM (1), mono (1 channel), 16-bit
    expect(buf.readUInt16LE(20)).toBe(1); // audioFormat = PCM
    expect(buf.readUInt16LE(22)).toBe(1); // channels
    expect(buf.readUInt16LE(34)).toBe(16); // bits per sample
    // data chunk length = samples * 2 bytes
    const dataLen = buf.readUInt32LE(40);
    expect(dataLen).toBe(Math.round(secs * rate) * 2);
  });

  it("is non-silent (the tone actually sounds)", () => {
    const buf = chordWav(["F#3"], 0.2, 44100);
    let peak = 0;
    for (let off = 44; off + 1 < buf.length; off += 2) {
      peak = Math.max(peak, Math.abs(buf.readInt16LE(off)));
    }
    expect(peak).toBeGreaterThan(1000); // well above silence
  });
});
