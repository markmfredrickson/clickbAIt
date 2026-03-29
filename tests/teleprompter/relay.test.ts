import { describe, it, expect } from "vitest";
import { parseOscFloat } from "../../src/teleprompter/relay.js";

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
