/**
 * Where we are in the set, as a pure function of (state, event).
 *
 *   between --play--> playing --crosses end / end-song tap--> ringing
 *   ringing --ring-out elapsed / transport stop--> between
 *   ringing --seek back--> playing
 *   any     --song loaded--> between (with the new song ready)
 *
 * fader-now reads this to decide which mix the board should be in; the ring
 * out is the glide from the song's mix to the between-songs mix.
 *
 * Deliberate choices:
 * - A transport stop while playing is a pause (in rehearsal it usually means
 *   "let's talk"), so it changes nothing. Only the end of the ring-out, a stop
 *   during it, or an end-song tap finish a song.
 * - While bailed, the track's position is not the band's, so crossing the end
 *   of the song does not start the ring-out. Someone taps end-song instead.
 * - Only a transport START moves between → playing. Once a song has ended the
 *   track may still be running, and its positions must not restart the song.
 *
 * Times are milliseconds on the caller's clock, passed in so this stays pure.
 */

/** What the state machine needs to know about a song. */
export interface SetSong {
  id: string;
  /** Beat where the last section ends: crossing it starts the ring-out. */
  endBeat: number;
  /** Length of the ring-out glide, in seconds. 0 → snap between songs. */
  ringOutSec: number;
}

export type SetMode = "between" | "playing" | "ringing";

export interface SetState {
  mode: SetMode;
  song: SetSong | null;
  /** Last known transport position, in beats. */
  beat?: number;
  /** Set while ringing: when it started, and the beat it started at. */
  ring?: { startedAt: number; fromBeat: number };
}

export type SetEvent =
  | { type: "song-loaded"; song: SetSong }
  | { type: "transport"; playing: boolean; beat: number; now: number }
  | { type: "position"; beat: number; now: number; bailed: boolean }
  | { type: "end-song"; now: number }
  | { type: "tick"; now: number };

export const initialSetState: SetState = { mode: "between", song: null };

// A seek back has to move more than this far behind where the ring-out
// started, so jitter in the reported position is not mistaken for one.
const SEEK_BACK_BEATS = 1;

/** Ring-out progress, 0 at its start to 1 at its end. 1 when not ringing. */
export function ringProgress(state: SetState, now: number): number {
  if (state.mode !== "ringing" || !state.ring || !state.song) return 1;
  const ms = state.song.ringOutSec * 1000;
  if (ms <= 0) return 1;
  return Math.min(1, Math.max(0, (now - state.ring.startedAt) / ms));
}

function startRinging(state: SetState, now: number, fromBeat: number): SetState {
  const ringing: SetState = { ...state, mode: "ringing", ring: { startedAt: now, fromBeat } };
  return ringProgress(ringing, now) >= 1 ? between(ringing) : ringing;
}

function between(state: SetState): SetState {
  const { ring: _ring, ...rest } = state;
  return { ...rest, mode: "between" };
}

export function step(state: SetState, event: SetEvent): SetState {
  switch (event.type) {
    case "song-loaded":
      return { mode: "between", song: event.song };

    case "transport": {
      const s = { ...state, beat: event.beat };
      if (event.playing) {
        if (s.mode === "between" && s.song && event.beat < s.song.endBeat) {
          return { ...s, mode: "playing" };
        }
        return s;
      }
      return s.mode === "ringing" ? between(s) : s;
    }

    case "position": {
      const s = { ...state, beat: event.beat };
      if (s.mode === "playing" && s.song && event.beat >= s.song.endBeat && !event.bailed) {
        return startRinging(s, event.now, s.song.endBeat);
      }
      if (s.mode === "ringing" && s.ring) {
        if (event.beat < s.ring.fromBeat - SEEK_BACK_BEATS) {
          const { ring: _ring, ...rest } = s;
          return { ...rest, mode: "playing" };
        }
        return ringProgress(s, event.now) >= 1 ? between(s) : s;
      }
      return s;
    }

    case "end-song":
      if (state.mode !== "playing") return state;
      return startRinging(state, event.now, state.beat ?? 0);

    case "tick":
      return state.mode === "ringing" && ringProgress(state, event.now) >= 1 ? between(state) : state;
  }
}
