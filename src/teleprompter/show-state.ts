/**
 * The show's live state, as a pure function of (state, intent).
 *
 * One control on the prompter drives the whole thing and always says what it
 * will do next, so "what does a tap mean" depends only on where we are:
 *
 *   following --tap--> out --tap--> following (at the next section's downbeat)
 *   following --vamp-> vamping --tap--> leaving --(loop end)--> following
 *   any       --stop-> stopped
 *
 * Sections marked `vamp` engage themselves on arrival, so creating a vamp by
 * gesture is the rare case, not the common one.
 *
 * This lives apart from both the relay and the browser because all three need
 * to agree: the relay owns the instance and decides what to send REAPER, the
 * control page renders the button, and the lyrics display dims itself. Keeping
 * it pure is also what makes the awkward parts (loop wrap, arming, an untrusted
 * intent off a WebSocket) testable without a socket or a DOM.
 */

/** A section, as much of it as the state machine cares about. */
export interface ShowSection {
  name: string;
  /** Absolute beat where the section starts. */
  beat: number;
  durationBeats: number;
  /** Authored open vamp — loops on arrival until tapped out of. */
  vamp?: boolean;
}

export type ShowMode = "following" | "out" | "vamping" | "leaving" | "stopped";

export interface ShowState {
  mode: ShowMode;
  /** Loop range as section indices, inclusive. Only set while vamping/leaving. */
  loop?: { from: number; to: number };
  /** Section index this state was entered at — what the display names. */
  at: number;
  /** Set once we've auto-engaged a marked section, so leaving it doesn't
   *  immediately re-engage it on the same pass. */
  autoVamped?: number;
}

export type Intent =
  | { action: "tap" }
  | { action: "vamp"; from: number; to: number }
  | { action: "stop" }
  | { action: "restart" };

/** What the relay should do to REAPER as a result of a transition. */
export interface ShowEffect {
  /** Mute or unmute the click and cue tracks. */
  click?: boolean;
  cues?: boolean;
  /** Turn REAPER's repeat on or off. */
  repeat?: boolean;
  /** Loop bounds in beats, when repeat is being turned on. */
  loopBeats?: { from: number; to: number };
  /** Seek here (beats) — re-entry only. Unimplemented until locate is settled. */
  locateBeat?: number;
  /** Stop the transport. */
  transport?: "stop";
}

export interface Transition {
  state: ShowState;
  effect: ShowEffect;
}

export const initialState: ShowState = { mode: "following", at: 0 };

/**
 * Whether the one control should do anything right now. The transport being
 * stopped isn't a show state — it's the show not happening — so the bar greys
 * out rather than offering actions that can't complete.
 */
export function isControllable(state: ShowState, playing: boolean): boolean {
  return playing && state.mode !== "stopped";
}

/** Index of the section containing `beat`, clamped into range. */
export function sectionAt(sections: readonly ShowSection[], beat: number): number {
  if (sections.length === 0) return 0;
  for (let i = sections.length - 1; i >= 0; i--) {
    if (beat >= sections[i].beat) return i;
  }
  return 0;
}

/** Beat range a loop covers, from its section indices. */
function loopBeats(sections: readonly ShowSection[], loop: { from: number; to: number }) {
  const last = sections[loop.to];
  return { from: sections[loop.from].beat, to: last.beat + last.durationBeats };
}

/** Everything live goes quiet; offsets are released by the relay separately. */
const SILENT: ShowEffect = { click: false, cues: false };
const AUDIBLE: ShowEffect = { click: true, cues: true };

/**
 * Apply an intent. `beat` is where the transport is now — the tap that leaves
 * `out` defines the downbeat, so the caller passes the moment it arrived.
 */
export function apply(
  state: ShowState,
  intent: Intent,
  sections: readonly ShowSection[],
  beat: number,
  playing = true,
): Transition {
  const here = sectionAt(sections, beat);

  // Nothing to bail out of or vamp on when the transport isn't rolling, and
  // offering them is a trap: a vamp entered while stopped can never leave,
  // because leaving resolves at the loop end and the beat never gets there.
  // Stop stays available — it's the one thing that makes sense either way.
  if (!playing && intent.action !== "stop" && intent.action !== "restart") {
    return { state, effect: {} };
  }

  if (intent.action === "stop") {
    return { state: { mode: "stopped", at: here }, effect: { ...SILENT, transport: "stop", repeat: false } };
  }

  if (intent.action === "restart") {
    return { state: { mode: "following", at: here }, effect: AUDIBLE };
  }

  if (intent.action === "vamp") {
    // Contiguous and forward only: the cue track is linear, so a loop can only
    // replay the timeline in its own order (see the range rules in the notes).
    if (state.mode !== "following") return { state, effect: {} };
    if (!Number.isInteger(intent.from) || !Number.isInteger(intent.to)) return { state, effect: {} };
    if (intent.from > intent.to) return { state, effect: {} };
    if (intent.from < 0 || intent.to >= sections.length) return { state, effect: {} };
    const loop = { from: intent.from, to: intent.to };
    return {
      state: { ...state, mode: "vamping", loop, at: intent.from },
      // Click keeps running so the groove holds; the cue is muted so the
      // count-in isn't heard on every pass, only on the way out.
      effect: { click: true, cues: false, repeat: true, loopBeats: loopBeats(sections, loop) },
    };
  }

  // Anything that isn't a known action changes nothing. Intents arrive off an
  // open WebSocket on the band's LAN, so an unrecognised one must be inert —
  // falling through to the tap branch meant any stray string could bail the show.
  if (intent.action !== "tap") return { state, effect: {} };

  switch (state.mode) {
    case "following":
      return { state: { ...state, mode: "out", at: here }, effect: SILENT };

    case "out": {
      // Land at the START of the next section — the tap is its downbeat. With
      // no sections loaded (the relay starts before REAPER names a song) there
      // is nowhere to land, so come back audible and leave the transport alone
      // rather than indexing off the end.
      if (sections.length === 0) return { state: { mode: "following", at: 0 }, effect: AUDIBLE };
      const next = Math.min(here + 1, sections.length - 1);
      return {
        state: { mode: "following", at: next },
        effect: { ...AUDIBLE, locateBeat: sections[next].beat },
      };
    }

    case "vamping":
      // Committed, but the pass finishes first — that's what quantizes the
      // exit, and it's when the cue counts the band back in.
      return { state: { ...state, mode: "leaving" }, effect: { cues: true } };

    case "leaving":
    case "stopped":
      return { state, effect: {} };
  }
}

/**
 * Advance on transport position. Handles the two things that happen without
 * anyone touching the control: a marked section engaging its own vamp, and a
 * loop ending while we're leaving it.
 */
export function advance(
  state: ShowState,
  sections: readonly ShowSection[],
  beat: number,
): Transition {
  const here = sectionAt(sections, beat);

  if (state.mode === "leaving" && state.loop) {
    const { to } = loopBeats(sections, state.loop);
    if (beat >= to) {
      return {
        state: { mode: "following", at: Math.min(state.loop.to + 1, sections.length - 1), autoVamped: state.loop.from },
        effect: { repeat: false, ...AUDIBLE },
      };
    }
    return { state, effect: {} };
  }

  if (state.mode === "following" && sections[here]?.vamp && state.autoVamped !== here) {
    const loop = { from: here, to: here };
    return {
      state: { mode: "vamping", loop, at: here, autoVamped: here },
      effect: { click: true, cues: false, repeat: true, loopBeats: loopBeats(sections, loop) },
    };
  }

  return { state, effect: {} };
}

/** What the one control should say right now. The bar always names its action. */
export function controlLabel(
  state: ShowState,
  sections: readonly ShowSection[],
): { main: string; sub: string } {
  switch (state.mode) {
    case "following":
      return { main: "Bail", sub: "Kills click, cues and mixer control" };
    case "out": {
      const next = sections[Math.min(state.at + 1, sections.length - 1)];
      return { main: "Tap on the 1", sub: next ? next.name : "" };
    }
    case "vamping":
      return { main: "Tap to continue", sub: "Finishes the pass, then counts in" };
    case "leaving":
      return { main: "Leaving…", sub: "Finishing the pass" };
    case "stopped":
      return { main: "Stopped", sub: "Not coming back" };
  }
}
