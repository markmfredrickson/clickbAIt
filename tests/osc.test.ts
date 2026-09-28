import { describe, it, expect } from "vitest";
import { encode, decodeMessage, decodePacket, asFloat } from "../src/core/osc.js";

/** Round-trip helper: encode, then decode the bytes back. */
const round = (address: string, args?: Parameters<typeof encode>[1]) =>
  decodeMessage(encode(address, args));

describe("osc encode/decode", () => {
  it("round-trips an address with no arguments", () => {
    expect(round("/play")).toEqual({ address: "/play", args: [] });
  });

  it("round-trips ints, floats and strings", () => {
    expect(round("/action", [40044])).toEqual({ address: "/action", args: [40044] });
    const f = decodeMessage(encode("/track/1/volume", [0.5]));
    expect(f!.address).toBe("/track/1/volume");
    expect(f!.args[0]).toBeCloseTo(0.5, 6);
    expect(round("/marker/name", ["Chorus 2"])).toEqual({
      address: "/marker/name",
      args: ["Chorus 2"],
    });
  });

  it("keeps multiple arguments in order", () => {
    const m = round("/x", [1, "two", 3]);
    expect(m!.args).toEqual([1, "two", 3]);
  });

  it("pads to 4-byte boundaries for every address length mod 4", () => {
    // "/a" (2), "/ab" (3), "/abc" (4), "/abcd" (5) exercise each padding case.
    for (const addr of ["/a", "/ab", "/abc", "/abcd"]) {
      const buf = encode(addr, [7]);
      expect(buf.length % 4).toBe(0);
      expect(decodeMessage(buf)).toEqual({ address: addr, args: [7] });
    }
  });

  it("pads string arguments the same way", () => {
    for (const s of ["a", "ab", "abc", "abcd"]) {
      const buf = encode("/s", [s]);
      expect(buf.length % 4).toBe(0);
      expect(decodeMessage(buf)!.args).toEqual([s]);
    }
  });

  it("sends booleans as REAPER's 1.0 / 0.0 floats", () => {
    expect(decodeMessage(encode("/repeat", [true]))!.args[0]).toBeCloseTo(1, 6);
    expect(decodeMessage(encode("/repeat", [false]))!.args[0]).toBeCloseTo(0, 6);
  });

  it("asFloat keeps a whole number off the int path", () => {
    // A bare 1 encodes as int; asFloat(1) must encode as float, because REAPER
    // rejects an int where it wants a float (faders, /time).
    expect(encode("/x", [1]).includes(Buffer.from(",i", "ascii"))).toBe(true);
    expect(encode("/x", [asFloat(1)]).includes(Buffer.from(",f", "ascii"))).toBe(true);
    expect(decodeMessage(encode("/x", [asFloat(1)]))!.args[0]).toBeCloseTo(1, 5);
  });

  it("rejects an address that doesn't start with a slash", () => {
    expect(() => encode("play")).toThrow(/must start/);
  });

  it("returns null for malformed input rather than throwing", () => {
    expect(decodeMessage(Buffer.from([]))).toBeNull();
    expect(decodeMessage(Buffer.from("nonsense", "ascii"))).toBeNull();
    expect(decodeMessage(Buffer.from([0x2f, 0x61]))).toBeNull(); // "/a", unterminated
  });

  it("stops at an unknown type tag instead of misreading the rest", () => {
    // ",ix" — the x has no known width, so only the int is trusted.
    const body = Buffer.concat([
      Buffer.from("/x\0\0", "ascii"),
      Buffer.from(",ix\0", "ascii"),
      (() => { const b = Buffer.alloc(4); b.writeInt32BE(9); return b; })(),
    ]);
    expect(decodeMessage(body)!.args).toEqual([9]);
  });

  it("flattens a bundle into its messages", () => {
    const a = encode("/play");
    const b = encode("/track/3/mute", [1]);
    const size = (n: number) => { const s = Buffer.alloc(4); s.writeInt32BE(n); return s; };
    const bundle = Buffer.concat([
      Buffer.from("#bundle\0", "ascii"),
      Buffer.alloc(8), // timetag, ignored
      size(a.length), a,
      size(b.length), b,
    ]);
    expect(decodePacket(bundle)).toEqual([
      { address: "/play", args: [] },
      { address: "/track/3/mute", args: [1] },
    ]);
  });

  it("decodes a bare message through decodePacket too", () => {
    expect(decodePacket(encode("/stop"))).toEqual([{ address: "/stop", args: [] }]);
  });

  it("returns no messages for a truncated bundle rather than throwing", () => {
    const bundle = Buffer.concat([
      Buffer.from("#bundle\0", "ascii"),
      Buffer.alloc(8),
      (() => { const s = Buffer.alloc(4); s.writeInt32BE(999); return s; })(), // lies about size
      Buffer.from("/x\0\0", "ascii"),
    ]);
    expect(decodePacket(bundle)).toEqual([]);
  });
});
