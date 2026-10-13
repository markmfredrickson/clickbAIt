/**
 * What the relay can ask of the player, and REAPER's OSC for each.
 *
 * The relay talks to a `PlayerDriver`, not to REAPER, so another player can
 * stand in for it later. REAPER's side was probed live (2026-10-13): transport
 * and regions have their own OSC addresses, and everything else is a REAPER
 * action fired by command ID through `/action/<id>`, which needs the ACTION
 * pattern in clickbait.ReaperOSC and "Allow binding messages to REAPER actions"
 * switched on for the OSC device.
 */

export interface OscMessage {
  address: string;
  args: number[];
}

export interface PlayerDriver {
  play(): void;
  stop(): void;
  /** Jump to section k (0-based) of the song showing. */
  locateSection(k: number): void;
  /** Switch to project tab `tab` (1-based) and get the player to name the song in it. */
  selectTab(tab: number): void;
  toggleVideo(): void;
  toggleFullscreen(): void;
}

/** REAPER native action IDs. */
const ACTION = {
  /** "Project tabs: Switch to project tab k" is 3121 + k, for k = 1..10. */
  tabBase: 3121,
  lastNumberedTab: 10,
  nextTab: 40861,
  videoWindow: 50125,
  videoFullscreen: 50122,
};

export function reaperDriver(send: (m: OscMessage) => void): PlayerDriver {
  // REAPER's patterns want a float argument; 1 means "do it".
  const msg = (address: string) => send({ address, args: [1] });
  const action = (id: number) => msg(`/action/${id}`);
  return {
    play: () => msg("/play"),
    stop: () => msg("/stop"),
    // Region 1 is the song's title region; sections are regions 2, 3, ...
    locateSection: (k) => msg(`/region/${k + 2}`),
    selectTab(tab) {
      if (!Number.isInteger(tab) || tab < 1) throw new Error(`no project tab ${tab}`);
      action(ACTION.tabBase + Math.min(tab, ACTION.lastNumberedTab));
      for (let t = ACTION.lastNumberedTab; t < tab; t++) action(ACTION.nextTab);
      // After a switch REAPER reports nothing about the new project. Moving the
      // playhead off and back onto region 1 makes it send that region's name,
      // which is the song's slug.
      msg("/region/2");
      msg("/region/1");
    },
    toggleVideo: () => action(ACTION.videoWindow),
    toggleFullscreen: () => action(ACTION.videoFullscreen),
  };
}
