import { describe, it, expect } from "vitest";
import { parseOscFloat, secondsToBeats } from "../../src/teleprompter/relay.js";
import type { SongPayload } from "../../src/teleprompter/types.js";

/** Build a minimal OSC message with address and a single float arg. */
function buildOscMessage(address: string, value: number): Buffer {
  // Address: null-terminated, padded to 4 bytes
  const addrBuf = Buffer.from(address + "\0");
  const addrPadded = Buffer.alloc(Math.ceil(addrBuf.length / 4) * 4);
  addrBuf.copy(addrPadded);

  // Type tag: ",f\0" padded to 4 bytes
  const tagBuf = Buffer.alloc(4);
  tagBuf.write(",f\0");

  // Float: 32-bit big-endian
  const floatBuf = Buffer.alloc(4);
  floatBuf.writeFloatBE(value);

  return Buffer.concat([addrPadded, tagBuf, floatBuf]);
}

describe("parseOscFloat", () => {
  it("parses a /beat message with float value", () => {
    const msg = buildOscMessage("/beat", 42.5);
    const result = parseOscFloat(msg);
    expect(result).not.toBeNull();
    expect(result!.address).toBe("/beat");
    expect(result!.value).toBeCloseTo(42.5);
  });

  it("parses address with different path", () => {
    const msg = buildOscMessage("/position/bar", 7);
    const result = parseOscFloat(msg);
    expect(result).not.toBeNull();
    expect(result!.address).toBe("/position/bar");
    expect(result!.value).toBeCloseTo(7);
  });

  it("handles zero value", () => {
    const msg = buildOscMessage("/beat", 0);
    const result = parseOscFloat(msg);
    expect(result!.value).toBe(0);
  });

  it("handles negative value", () => {
    const msg = buildOscMessage("/beat", -4.5);
    const result = parseOscFloat(msg);
    expect(result!.value).toBeCloseTo(-4.5);
  });

  it("returns null for empty buffer", () => {
    expect(parseOscFloat(Buffer.alloc(0))).toBeNull();
  });

  it("returns null for non-float type tag", () => {
    // Build a message with ",s" type tag (string, not float)
    const addrBuf = Buffer.from("/beat\0\0\0"); // 8 bytes
    const tagBuf = Buffer.alloc(4);
    tagBuf.write(",s\0");
    const buf = Buffer.concat([addrBuf, tagBuf, Buffer.from("hello\0\0\0")]);
    expect(parseOscFloat(buf)).toBeNull();
  });
});

describe("secondsToBeats", () => {
  const simpleSong: SongPayload = {
    title: "Test",
    bpm: 120,
    tempoMap: [{ beat: 0, seconds: 0, bpm: 120 }],
    sections: [],
  };

  it("converts seconds to beats at constant tempo", () => {
    // 120 BPM = 2 beats/sec
    expect(secondsToBeats(0, simpleSong)).toBeCloseTo(0);
    expect(secondsToBeats(1, simpleSong)).toBeCloseTo(2);
    expect(secondsToBeats(4, simpleSong)).toBeCloseTo(8);
    expect(secondsToBeats(30, simpleSong)).toBeCloseTo(60);
  });

  const tempoChangeSong: SongPayload = {
    title: "Test",
    bpm: 120,
    tempoMap: [
      { beat: 0, seconds: 0, bpm: 120 },
      { beat: 8, seconds: 4, bpm: 60 },  // slows to 60 BPM at beat 8 (4 sec)
    ],
    sections: [],
  };

  it("handles tempo changes", () => {
    // First 4 seconds: 120 BPM → 8 beats
    expect(secondsToBeats(4, tempoChangeSong)).toBeCloseTo(8);
    // After tempo change: 60 BPM = 1 beat/sec
    // 4 sec + 2 sec at 60 BPM = 8 + 2 = 10 beats
    expect(secondsToBeats(6, tempoChangeSong)).toBeCloseTo(10);
  });

  it("handles empty tempo map", () => {
    const empty: SongPayload = { title: "T", bpm: 90, tempoMap: [], sections: [] };
    // Falls back to master BPM: 90 BPM = 1.5 beats/sec
    expect(secondsToBeats(2, empty)).toBeCloseTo(3);
  });
});
