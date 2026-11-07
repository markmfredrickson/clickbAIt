/**
 * The lights as a relay module. What the rig shows in each relay mode:
 *
 *   halted    the halted look (house lights)
 *   standby   the standby look: warm front light with low reds, fine if the band starts to riff
 *   playing   the song's lights at REAPER's beat (standby look if the song has no light file)
 *   vamping   the same: the timeline repeats, so its lights do too
 *   bailed    the busk look: everyone lit, no timeline effects
 *   lost      the standby look, rather than freezing on whatever frame was last sent
 *
 * A song's light file is read again when it changes on disk (checked about once a second while it
 * plays), so a recompile shows up without switching songs.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RelayModule } from "../teleprompter/relay-module.js";
import { LightsOutput, type LightsRig } from "./output.js";
import { parseLights, type LightsFile } from "./events.js";

const RECHECK_MS = 1000;

export function lightsModule(rig: LightsRig, send: (packet: Buffer) => void): RelayModule {
  const out = new LightsOutput({ patch: rig.patch, fallback: rig.looks.standby, send, universe: rig.artnet.universe });
  let path: string | null = null;
  let mtime = -1;
  let checkedAt = -Infinity;

  /** Load the song's file if it appeared or changed since it was last read. */
  function refresh(): void {
    if (!path) return;
    const now = mtimeOf(path);
    if (now === mtime) return;
    mtime = now;
    out.setSong(now < 0 ? null : readLights(path));
  }

  const playSong = (s: { beat: number; beatAt: number }, now: number) => {
    if (now - checkedAt >= RECHECK_MS) {
      checkedAt = now;
      refresh();
    }
    out.play(s.beat, s.beatAt, now);
  };

  return {
    name: "lights",
    modes: {
      halted: (_, now) => out.hold(rig.looks.halted, now),
      standby: (_, now) => out.hold(rig.looks.standby, now),
      playing: playSong,
      vamping: playSong,
      bailed: (_, now) => out.hold(rig.looks.busk, now),
      lost: (_, now) => out.hold(rig.looks.standby, now),
    },
    song(slug, songDir) {
      path = slug && songDir ? join(songDir, `${slug}.lights.json`) : null;
      mtime = -1;
      out.setSong(null);
      refresh();
    },
  };
}

/** A file's modification time, or -1 if it isn't there. */
function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

/** A song's light file. A broken file, or one in another format version, is reported and treated as missing. */
function readLights(path: string): LightsFile | null {
  try {
    return parseLights(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    console.error(`  ✗ lights: could not read ${path}: ${(err as Error).message}`);
    return null;
  }
}
