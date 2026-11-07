/**
 * Light levels to DMX to Art-Net.
 *
 * Colors arrive as RGB (0..1). Each fixture's dimmer carries brightness and its color channels carry
 * the color at full scale, so dim colors stay true. RGB is split onto the SkyBox's red, green, blue,
 * amber and white LEDs, and a color's fourth value drives the EXA's UV LED (the SkyBox 5 has none, so
 * it ignores UV). A light that goes dark keeps its last color, so a dim-out never swings color.
 */

import type { Look, RGB, RGBU } from "./events.js";

/** Fixture modes we drive: SkyBox 5 in 7-channel mode, SkyBox EXA in 8-channel mode. */
export type FixtureMode = "skybox5-7ch" | "skyboxexa-8ch";
/** One fixture: its name in the light files, DMX start address (1-based), and mode. */
export type Patch = { name: string; address: number; mode: FixtureMode }[];

/** White takes what red, green and blue share; amber (~ red + 0.6 green) takes what red and green share. */
export function rgbaw([r, g, b]: RGB): { r: number; g: number; b: number; a: number; w: number } {
  const w = Math.min(r, g, b);
  let r1 = r - w, g1 = g - w;
  const b1 = b - w;
  const a = Math.min(r1, g1 / 0.6);
  r1 -= a;
  g1 -= 0.6 * a;
  const clean = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  return { r: clean(r1), g: clean(g1), b: clean(b1), a: clean(a), w: clean(w) };
}

/** Turns levels into a 512-channel universe, remembering each light's last color for color hold. */
export class DmxEncoder {
  private lastFull = new Map<string, RGBU>();
  constructor(private patch: Patch) {}

  encode(levels: Look): Uint8Array {
    const dmx = new Uint8Array(512);
    const to = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
    for (const fx of this.patch) {
      const given = levels[fx.name] ?? [0, 0, 0];
      const hasUv = fx.mode === "skyboxexa-8ch";
      const c: RGBU = [given[0], given[1], given[2], hasUv ? (given[3] ?? 0) : 0];
      const level = Math.max(...c);
      let full: RGBU;
      if (level > 0.02) {
        full = c.map((v) => v / level) as RGBU;
        this.lastFull.set(fx.name, full);
      } else {
        full = this.lastFull.get(fx.name) ?? [0, 0, 0, 0];
      }
      const { r, g, b, a, w } = rgbaw([full[0], full[1], full[2]]);
      const vals = hasUv ? [level, r, g, b, a, w, full[3], 0] : [level, r, g, b, a, w, 0];
      vals.forEach((v, k) => (dmx[fx.address - 1 + k] = to(v)));
    }
    return dmx;
  }
}

/** An ArtDmx packet for one universe. */
export function artDmxPacket(dmx: Uint8Array, { universe = 0, sequence = 0 } = {}): Buffer {
  const head = Buffer.alloc(18);
  head.write("Art-Net\0", 0, "ascii");
  head.writeUInt16LE(0x5000, 8); // OpDmx
  head.writeUInt16BE(14, 10); // protocol version
  head[12] = sequence & 0xff;
  head[13] = 0; // physical
  head.writeUInt16LE(universe, 14); // SubUni + Net
  head.writeUInt16BE(dmx.length, 16);
  return Buffer.concat([head, Buffer.from(dmx)]);
}
