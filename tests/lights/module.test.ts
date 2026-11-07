import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lightsModule } from "../../src/lights/module.js";
import { runModule, type RelayMode, type RelaySnapshot } from "../../src/teleprompter/relay-module.js";
import type { LightsRig } from "../../src/lights/output.js";

/**
 * The lights as a relay module: what the rig shows in each relay mode, and loading a song's
 * light file on a song switch.
 */
type C = [number, number, number];
const rig: LightsRig = {
  artnet: { host: "127.0.0.1", port: 6454, universe: 0 },
  patch: [{ name: "a", address: 1, mode: "skybox5-7ch" }],
  looks: { halted: { a: [0.3, 0.3, 0.3] as C }, standby: { a: [1, 0.72, 0.38] as C }, busk: { a: [1, 1, 1] as C } },
};

function setup() {
  const sent: Buffer[] = [];
  const m = lightsModule(rig, (b) => sent.push(b));
  const dir = mkdtempSync(join(tmpdir(), "lights-song-"));
  writeFileSync(join(dir, "blue.lights.json"), JSON.stringify({ fixtures: ["a"], looks: { b: { a: [0, 0, 1] } }, events: [{ beat: 0, look: "b" }] }));
  let now = 0;
  const show = (mode: RelayMode) => {
    const snap: RelaySnapshot = { mode, beat: 4, beatAt: now, show: { mode: "following", at: 0 }, slug: "blue", songDir: dir };
    runModule(m, snap, now);
    now += 1000; // past the keep-alive, so every call sends
    return sent[sent.length - 1].subarray(18);
  };
  return { m, dir, show };
}

describe("lightsModule", () => {
  it("plays the song's light file, found beside the song", () => {
    const { m, dir, show } = setup();
    m.song?.("blue", dir);
    expect([...show("playing").subarray(1, 4)]).toEqual([0, 0, 255]);
  });

  it("keeps playing the song's lights through a vamp", () => {
    const { m, dir, show } = setup();
    m.song?.("blue", dir);
    expect([...show("vamping").subarray(1, 4)]).toEqual([0, 0, 255]);
  });

  it("plays the standby look for a song with no light file", () => {
    const { m, dir, show } = setup();
    m.song?.("no-such-song", dir);
    expect(show("playing")[4]).toBeGreaterThan(0); // amber: the gold standby look
  });

  it("shows the busk look while bailed and the song again after", () => {
    const { m, dir, show } = setup();
    m.song?.("blue", dir);
    expect(show("bailed")[5]).toBe(255); // white
    expect([...show("playing").subarray(1, 4)]).toEqual([0, 0, 255]);
  });

  it("shows the standby look between songs and when REAPER is lost", () => {
    const { m, dir, show } = setup();
    m.song?.("blue", dir);
    expect(show("standby")[4]).toBeGreaterThan(0);
    expect(show("lost")[4]).toBeGreaterThan(0);
  });

  it("shows the halted look when no session is running", () => {
    const { show } = setup();
    expect(show("halted")[0]).toBe(Math.round(0.3 * 255));
  });

  it("reloads the song's light file when it changes on disk", () => {
    const { m, dir, show } = setup();
    m.song?.("blue", dir);
    expect([...show("playing").subarray(1, 4)]).toEqual([0, 0, 255]);
    const file = join(dir, "blue.lights.json");
    writeFileSync(file, JSON.stringify({ fixtures: ["a"], looks: { r: { a: [1, 0, 0] } }, events: [{ beat: 0, look: "r" }] }));
    utimesSync(file, new Date(), new Date(Date.now() + 5000)); // a newer modification time
    expect([...show("playing").subarray(1, 4)]).toEqual([255, 0, 0]);
  });
});
