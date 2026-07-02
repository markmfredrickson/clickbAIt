import { describe, it, expect } from "vitest";
import {
  RigSchema,
  hwoutField,
  recInputField,
  expandBandBlock,
  recordTrackSpecs,
} from "../src/rig.js";

describe("hwoutField", () => {
  it("encodes a stereo pair as first-channel − 1 (master 17/18 → 16)", () => {
    expect(hwoutField({ stereo: 17 })).toBe(16);
  });
  it("encodes a mono output as 1024 + (P − 1) (cue 19 → 1042, click 20 → 1043)", () => {
    expect(hwoutField({ mono: 19 })).toBe(1042);
    expect(hwoutField({ mono: 20 })).toBe(1043);
  });
});

describe("recInputField", () => {
  it("mono input N → N − 1", () => {
    expect(recInputField(1)).toBe(0);
    expect(recInputField(3)).toBe(2);
  });
  it("stereo pair starting at N → 1024 + (N − 1)", () => {
    expect(recInputField([1, 2])).toBe(1024);
    expect(recInputField([23, 24])).toBe(1046);
  });
});

describe("expandBandBlock", () => {
  const specs = expandBandBlock({
    channels: 16,
    arm: true,
    roundTrip: true,
    names: { "1": "Guitar Kr", "9": "Voc Mark" },
  });

  it("produces one mono track per channel", () => {
    expect(specs).toHaveLength(16);
    expect(specs.every((s) => s.nchan === 1)).toBe(true);
  });
  it("names known channels and reserves the rest", () => {
    expect(specs[0].name).toBe("X32 CH 01 (Guitar Kr)");
    expect(specs[8].name).toBe("X32 CH 09 (Voc Mark)");
    expect(specs[3].name).toBe("X32 CH 04"); // reserved, no parens
  });
  it("round-trips each channel: record input N and playback out to N", () => {
    // ch1: recInput 0, mono hwout 1024+0
    expect(specs[0].recInput).toBe(0);
    expect(specs[0].hwout).toBe(1024);
    // ch16: recInput 15, mono hwout 1024+15
    expect(specs[15].recInput).toBe(15);
    expect(specs[15].hwout).toBe(1039);
  });
});

describe("recordTrackSpecs (band block + drums)", () => {
  const rig = RigSchema.parse({
    bandBlock: { channels: 16, names: { "1": "Guitar Kr" } },
    drums: [
      { name: "X32 AUX 01/02 (Drums Mix)", channel: [21, 22] },
      { name: "X32 AUX 03 (Kick Drum)", channel: 23 },
      { name: "X32 AUX 04 (Snare Drum)", channel: 24 },
    ],
  });
  const specs = recordTrackSpecs(rig);

  it("appends the drum tracks after the 16 band tracks", () => {
    expect(specs).toHaveLength(19);
    expect(specs.slice(16).map((s) => s.name)).toEqual([
      "X32 AUX 01/02 (Drums Mix)",
      "X32 AUX 03 (Kick Drum)",
      "X32 AUX 04 (Snare Drum)",
    ]);
  });
  it("makes the drum mix stereo round-tripping card 21/22", () => {
    const mix = specs[16];
    expect(mix.nchan).toBe(2);
    expect(mix.recInput).toBe(1024 + 20); // stereo pair at 21
    expect(mix.hwout).toBe(20); // stereo out pair at 21
  });
  it("makes kick/snare mono round-tripping card 23/24", () => {
    expect(specs[17]).toMatchObject({ recInput: 22, hwout: 1024 + 22, nchan: 1 });
    expect(specs[18]).toMatchObject({ recInput: 23, hwout: 1024 + 23, nchan: 1 });
  });
});
