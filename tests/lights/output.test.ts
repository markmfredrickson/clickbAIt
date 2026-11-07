import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LightsOutput, loadLightsRig } from "../../src/lights/output.js";
import type { LightsFile } from "../../src/lights/events.js";
import type { Patch } from "../../src/lights/artnet.js";

/**
 * The Art-Net output: a song's lights at REAPER's beat (carried forward between REAPER's reports),
 * or a held look. Full frames every tick while the lights change, a slow keep-alive when static.
 */
const patch: Patch = [{ name: "a", address: 1, mode: "skybox5-7ch" }];
const gold = { a: [1, 0.72, 0.38] as [number, number, number] };
// a light that fades from black to white over beats 0..8, so every beat looks different
const fading: LightsFile = { fixtures: ["a"], looks: { off: {}, on: { a: [1, 1, 1] } }, events: [{ beat: 0, look: "off" }, { beat: 0, look: "on", fade: 8 }] };

function rig() {
  const sent: Buffer[] = [];
  const out = new LightsOutput({ patch, fallback: gold, send: (b) => sent.push(b), keepaliveMs: 250 });
  return { out, sent, dmx: () => sent[sent.length - 1].subarray(18) };
}

describe("LightsOutput", () => {
  it("sends a frame every tick while the lights are changing", () => {
    const { out, sent } = rig();
    out.setSong(fading);
    for (let t = 0; t < 10; t++) out.play(t * 0.1, t * 25, t * 25);
    expect(sent.length).toBe(10);
  });

  it("drops to a keep-alive when nothing changes", () => {
    const { out, sent } = rig();
    for (let t = 0; t <= 1000; t += 25) out.hold(gold, t);
    expect(sent.length).toBe(5); // t = 0, 250, 500, 750, 1000
  });

  it("carries the beat forward between REAPER's reports", () => {
    const { out, dmx } = rig();
    out.setSong(fading);
    out.play(2, 0, 0);
    out.play(3, 500, 500); // two beats a second
    out.play(3, 500, 750); // no new report; a quarter second later is beat 3.5
    expect(dmx()[0]).toBe(Math.round((3.5 / 8) * 255));
  });

  it("starts fresh after a hold, without the old tempo", () => {
    const { out, dmx } = rig();
    out.setSong(fading);
    out.play(2, 0, 0);
    out.play(3, 500, 500);
    out.hold(gold, 600);
    out.play(4, 10_000, 10_250);
    expect(dmx()[0]).toBe(Math.round((4 / 8) * 255));
  });

  it("plays the fallback look for a song without a light file", () => {
    const { out, dmx } = rig();
    out.setSong(null);
    out.play(4, 0, 0);
    expect(dmx()[0]).toBe(255); // gold's peak at full
    expect(dmx()[4]).toBeGreaterThan(0); // amber carries gold
  });

  it("switches to a new song's lights", () => {
    const { out, dmx } = rig();
    out.setSong({ fixtures: ["a"], looks: { red: { a: [1, 0, 0] } }, events: [{ beat: 0, look: "red" }] });
    out.play(1, 0, 0);
    expect([...dmx().subarray(1, 4)]).toEqual([255, 0, 0]);
  });
});

describe("loadLightsRig", () => {
  it("reads the patch, the Art-Net target and the held looks beside it", () => {
    const dir = mkdtempSync(join(tmpdir(), "lights-rig-"));
    writeFileSync(join(dir, "halted.dmx.json"), JSON.stringify({}));
    writeFileSync(join(dir, "standby.dmx.json"), JSON.stringify({ a: [1, 0.5, 0.2] }));
    writeFileSync(join(dir, "busk.dmx.json"), JSON.stringify({ a: [1, 1, 1] }));
    writeFileSync(join(dir, "rig.json"), JSON.stringify({
      artnet: { host: "127.0.0.1", universe: 0 },
      patch: [{ name: "a", address: 1, mode: "skybox5-7ch" }],
      looks: { halted: "halted.dmx.json", standby: "standby.dmx.json", busk: "busk.dmx.json" },
    }));
    const r = loadLightsRig(join(dir, "rig.json"));
    expect(r.artnet).toEqual({ host: "127.0.0.1", port: 6454, universe: 0 });
    expect(r.patch[0].mode).toBe("skybox5-7ch");
    expect(r.looks.standby.a).toEqual([1, 0.5, 0.2]);
    expect(r.looks.busk.a).toEqual([1, 1, 1]);
    expect(r.looks.halted).toEqual({});
  });
});
