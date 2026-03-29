/** Data shapes for the teleprompter browser client. */

/** A single line of lyrics with its timing. */
export interface LyricLine {
  text: string;
  beat: number;
  seconds: number;
  tag?: string; // e.g. "Lead Vocal", "Backing Vocal"
}

/** A chord symbol with its timing. */
export interface ChordMark {
  chord: string;
  beat: number;
  seconds: number;
}

/** A section of the song (verse, chorus, etc.) with its lyrics and chords. */
export interface Section {
  name: string;
  beat: number;
  seconds: number;
  durationBeats: number;
  durationSeconds: number;
  lyrics: LyricLine[];
  chords: ChordMark[];
}

/** A tempo change point for seconds↔beats conversion. */
export interface TempoPoint {
  beat: number;
  seconds: number;
  bpm: number;
}

/** Full song payload sent to the browser on connect. */
export interface SongPayload {
  title: string;
  artist?: string;
  key?: string;
  bpm: number;
  /** Slug used for file lookup and RPP region identification. */
  slug: string;
  tempoMap: TempoPoint[];
  sections: Section[];
}

/** OSC position message relayed to clients. */
export interface PositionMessage {
  type: "position";
  beat: number;
  seconds: number;
}
