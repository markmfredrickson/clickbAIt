import { describe, it, expect } from "vitest";
import { artDmxPacket, rgbaw, DmxEncoder, type Patch } from "../../src/lights/artnet.js";

describe("artDmxPacket", () => {
  it("writes an ArtDmx header and the universe", () => {
    const dmx = new Uint8Array(512);
    dmx[0] = 255;
    const p = artDmxPacket(dmx, { universe: 0, sequence: 7 });
    expect(p.subarray(0, 8).toString("ascii")).toBe("Art-Net\0");
    expect(p.readUInt16LE(8)).toBe(0x5000); // OpDmx
    expect(p.readUInt16BE(10)).toBe(14); // protocol version
    expect(p[12]).toBe(7); // sequence
    expect(p.readUInt16LE(14)).toBe(0); // SubUni + Net
    expect(p.readUInt16BE(16)).toBe(512); // data length
    expect(p[18]).toBe(255);
    expect(p.length).toBe(18 + 512);
  });
});

describe("rgbaw", () => {
  it("puts the common part of red, green and blue on white", () => {
    expect(rgbaw([1, 1, 1])).toEqual({ r: 0, g: 0, b: 0, a: 0, w: 1 });
  });
  it("puts what red and green share on amber (amber ~ red + 0.6 green)", () => {
    const o = rgbaw([1, 0.6, 0]);
    expect(o.a).toBeCloseTo(1, 5);
    expect(o.r).toBeCloseTo(0, 5);
    expect(o.g).toBeCloseTo(0, 5);
  });
  it("leaves pure blue alone", () => {
    expect(rgbaw([0, 0, 1])).toEqual({ r: 0, g: 0, b: 1, a: 0, w: 0 });
  });
});

const patch: Patch = [
  { name: "a", address: 1, mode: "skybox5-7ch" }, // dimmer R G B A W strobe
  { name: "L", address: 41, mode: "skyboxexa-8ch" }, // dimmer R G B A W UV strobe
];

describe("DmxEncoder", () => {
  it("puts brightness on the dimmer and the color at full scale", () => {
    const enc = new DmxEncoder(patch);
    const dmx = enc.encode({ a: [0.1, 0, 0], L: [0, 0, 0] });
    expect(dmx[0]).toBe(26); // dimmer: 10% of 255, rounded
    expect(dmx[1]).toBe(255); // red at full scale
    expect(dmx[6]).toBe(0); // strobe open
  });

  it("lays out the EXA's 8 channels with UV before strobe, at its address", () => {
    const enc = new DmxEncoder(patch);
    const dmx = enc.encode({ a: [0, 0, 0], L: [0, 0, 1] });
    expect(Array.from(dmx.subarray(40, 48))).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
  });

  it("holds a light's last color while it is dark, so a dim-out never swings color", () => {
    const enc = new DmxEncoder(patch);
    enc.encode({ a: [1, 0, 0], L: [0, 0, 0] });
    const dmx = enc.encode({ a: [0, 0, 0], L: [0, 0, 0] });
    expect(dmx[0]).toBe(0); // dimmer down
    expect(dmx[1]).toBe(255); // still red underneath
  });
});

describe("DmxEncoder UV", () => {
  it("drives the EXA's UV channel from a color's fourth value, at full scale under the dimmer", () => {
    const enc = new DmxEncoder(patch);
    const dmx = enc.encode({ a: [0, 0, 0], L: [0, 0, 0, 0.4] });
    expect(dmx[40]).toBe(102); // dimmer: 40%
    expect(dmx[46]).toBe(255); // UV
    expect(Array.from(dmx.subarray(41, 46))).toEqual([0, 0, 0, 0, 0]); // no visible color
  });

  it("mixes UV with color, the brightest of them setting the dimmer", () => {
    const enc = new DmxEncoder(patch);
    const dmx = enc.encode({ a: [0, 0, 0], L: [0.5, 0, 0, 0.25] });
    expect(dmx[40]).toBe(128); // dimmer: red's 50%
    expect(dmx[41]).toBe(255); // red at full scale
    expect(dmx[46]).toBe(128); // UV at half of red
  });

  it("ignores UV on a SkyBox 5, which has no UV LED", () => {
    const enc = new DmxEncoder(patch);
    const dmx = enc.encode({ a: [0, 0, 0, 1], L: [0, 0, 0] });
    expect(dmx[0]).toBe(0); // dark rather than a dimmer up on no color
  });
});
