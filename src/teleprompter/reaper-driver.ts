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
  /** Jump a PLAYING track to section k. A region jump while playing moves
   *  only REAPER's edit cursor, so stop, jump and play again. */
  seekSection(k: number): void;
  /** Go to the start of the song, explicitly, whatever REAPER's stop setting. */
  restart(): void;
  /** Mute or unmute track n (1-based). */
  muteTrack(n: number, muted: boolean): void;
  /** Get the player to name the song showing. */
  identify(): void;
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
  /** "Transport: Go to start of project". */
  goToStart: 40042,
  videoWindow: 50125,
  videoFullscreen: 50122,
};

export function reaperDriver(send: (m: OscMessage) => void): PlayerDriver {
  // REAPER's patterns want a float argument; 1 means "do it".
  const msg = (address: string) => send({ address, args: [1] });
  const action = (id: number) => msg(`/action/${id}`);
  // REAPER says nothing about a project on its own. Moving the playhead off
  // and back onto region 1 makes it send that region's name, the song's slug.
  const identify = () => {
    msg("/region/2");
    msg("/region/1");
  };
  return {
    play: () => msg("/play"),
    stop: () => msg("/stop"),
    // Region 1 is the song's title region; sections are regions 2, 3, ...
    locateSection: (k) => msg(`/region/${k + 2}`),
    seekSection(k) {
      msg("/stop");
      msg(`/region/${k + 2}`);
      msg("/play");
    },
    restart: () => action(ACTION.goToStart),
    muteTrack: (n, muted) => send({ address: `/track/${n}/mute`, args: [muted ? 1 : 0] }),
    identify,
    selectTab(tab) {
      if (!Number.isInteger(tab) || tab < 1) throw new Error(`no project tab ${tab}`);
      action(ACTION.tabBase + Math.min(tab, ACTION.lastNumberedTab));
      for (let t = ACTION.lastNumberedTab; t < tab; t++) action(ACTION.nextTab);
      // After a switch REAPER reports nothing about the new project.
      identify();
    },
    toggleVideo: () => action(ACTION.videoWindow),
    toggleFullscreen: () => action(ACTION.videoFullscreen),
  };
}
