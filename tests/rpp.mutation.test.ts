/**
 * Mutation tests: generate RPP → mutate in REAPER via Lua → assert result.
 * Requires REAPER to be running or available. Skipped if binary not found.
 *
 * Positions in REAPER RPP files are in SECONDS. Beats are converted via BPM.
 */

import { describe, it, expect } from "vitest";
import { generateRpp } from "../src/rpp.js";
import { reaperAvailable, reaperMutate, parseMarkers, parsePTs } from "./helpers/reaper.js";
import type { Song } from "../src/types.js";

const runIf = reaperAvailable ? it : it.skip;

// At 120 BPM, 4/4:
//   Intro:   0→16 beats = 0→8 seconds
//   Verse 1: 16→48 beats = 8→24 seconds
//   Chorus:  48→80 beats = 24→40 seconds
const basicSong: Song = {
  title: "Mutation Test",
  masterBpm: 120,
  defaultBeats: 4,
  sections: [
    { name: "Intro",   bars: [{ beats: 4, repeat: 4 }] },
    { name: "Verse 1", bars: [{ beats: 4, repeat: 8 }] },
    { name: "Chorus",  bars: [{ beats: 4, repeat: 8 }] },
  ],
};

describe("REAPER mutation round-trips", () => {
  runIf("save round-trip preserves BPM and section positions", async () => {
    const rpp = generateRpp(basicSong);
    const result = await reaperMutate(rpp, `
      reaper.Main_SaveProject(0, false)
    `);

    expect(result).toContain("TEMPO 120");
    const starts = parseMarkers(result).filter((m) => !m.isEnd);
    expect(starts.map((m) => m.name)).toEqual(["Intro", "Verse 1", "Chorus"]);
    expect(starts[0].pos).toBeCloseTo(0, 3);
    expect(starts[1].pos).toBeCloseTo(8, 3);   // 16 beats ÷ 120 × 60 = 8s
    expect(starts[2].pos).toBeCloseTo(24, 3);  // 48 beats ÷ 120 × 60 = 24s
  }, 25_000);

  runIf("insert 3/4 time signature at beat 16 (8 seconds)", async () => {
    const rpp = generateRpp(basicSong);
    const result = await reaperMutate(rpp, `
      -- beat 16 at 120 BPM = 8 seconds
      local pos = reaper.TimeMap_QNToTime(16)
      reaper.SetTempoTimeSigMarker(0, -1, pos, -1, -1, -1, 3, 4, false)
      reaper.Main_SaveProject(0, false)
    `);

    const pts = parsePTs(result);
    // Expect a PT at ~8 seconds with beats-per-bar = 3
    const at8s = pts.find((p) => Math.abs(p.pos - 8) < 0.1);
    expect(at8s).toBeDefined();
    expect(at8s!.beatsPerBar).toBe(3);
  }, 25_000);

  runIf("move Verse 1 end from beat 48 (24s) to beat 40 (20s)", async () => {
    const rpp = generateRpp(basicSong);
    const result = await reaperMutate(rpp, `
      -- Verse 1 starts at beat 16 = 8 seconds, ends at beat 48 = 24 seconds
      -- Move end to beat 40 = 20 seconds
      local pos_start = reaper.TimeMap_QNToTime(16)
      local pos_new_end = reaper.TimeMap_QNToTime(40)
      reaper.SetProjectMarker4(0, 2, true, pos_start, pos_new_end, "Verse 1", 0, 0)
      reaper.Main_SaveProject(0, false)
    `);

    const markers = parseMarkers(result);
    const verse1End = markers.find((m) => m.isEnd && m.id === 2);
    expect(verse1End).toBeDefined();
    expect(verse1End!.pos).toBeCloseTo(20, 1);  // 40 beats ÷ 120 × 60 = 20 seconds
  }, 25_000);
});
