/**
 * Relay modules: things that follow the show (lights now; a stage clock and others later).
 *
 * The relay reduces everything it knows to one mode per tick and calls that mode's handler on
 * every module. The handler table is typed from the RelayMode union, so adding a mode is a compile
 * error in every module until each one decides what to do there.
 *
 *   halted   no session (gig or practice) running: house lights
 *   standby  a session is running but no song is being performed
 *   playing  following the song's timeline
 *   vamping  a section repeating, including the tap-out that lets the loop finish
 *   bailed   the band is off the timeline
 *   lost     REAPER says it's playing but its position reports have stopped
 */

import type { ShowState } from "./show-state.js";

export type RelayMode = "halted" | "standby" | "playing" | "vamping" | "bailed" | "lost";

export interface RelaySnapshot<M extends RelayMode = RelayMode> {
  mode: M;
  /** REAPER's last reported beat, and when it arrived (ms, the relay's clock). */
  beat: number;
  beatAt: number;
  /** The show state machine's state, for modules that need the section or loop. */
  show: ShowState;
  slug: string | null;
  songDir: string | null;
}

export interface RelayModule {
  name: string;
  /** One handler per mode, called every relay tick (about 40 times a second). */
  modes: { [M in RelayMode]: (s: RelaySnapshot<M>, nowMs: number) => void };
  /** The showing song changed. */
  song?(slug: string | null, songDir: string | null): void;
  close?(): void;
}

/** Position reports this far apart while REAPER says it's playing mean it has gone quiet. */
export const LOST_AFTER_MS = 1500;

export interface ModeInputs {
  session: boolean;
  playing: boolean;
  show: ShowState;
  lastReportMs: number;
  nowMs: number;
}

export function relayMode({ session, playing, show, lastReportMs, nowMs }: ModeInputs): RelayMode {
  if (!session) return "halted";
  if (!playing || show.mode === "stopped") return "standby";
  if (nowMs - lastReportMs > LOST_AFTER_MS) return "lost";
  switch (show.mode) {
    case "out": return "bailed";
    case "vamping":
    case "leaving": return "vamping";
    case "following": return "playing";
  }
}

export function runModule(m: RelayModule, snap: RelaySnapshot, nowMs: number): void {
  // the handler table is exhaustive by type; TypeScript can't correlate the key with the snapshot
  (m.modes[snap.mode] as (s: RelaySnapshot, nowMs: number) => void)(snap, nowMs);
}
