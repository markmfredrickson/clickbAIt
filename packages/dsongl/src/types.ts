/** Duration expressed in beats or bars (bars resolved via time signature). */
export type Duration = { beats: number } | { bars: number };

/** An instantaneous event at a beat offset. */
export interface Event {
  kind: "event";
  offset?: number;  // beats relative to parent; default 0; can be negative
  type: "chord" | "lyric" | "cue" | "marker";
  value: string;
  tag?: string;     // grouping label — could map to a track, person, instrument, whatever
}

/**
 * A span of musical time. Contains a set of children (Events or nested Spans)
 * with beat offsets relative to this Span's start.
 *
 * BPM and timeSignature are inherited from parent if not specified.
 * Duration is derived from children if not explicit.
 */
export interface Span {
  kind: "span";
  name?: string;
  offset?: number;            // beats relative to parent; default 0; can be negative
  bpm?: number;
  timeSignature?: [number, number];
  duration?: Duration;
  tag?: string;               // inherited by children unless overridden
  cue?: boolean;              // if true, buildRpp auto-places a TTS cue before this section
  children?: Node[];
}

/**
 * A Span whose children are placed end-to-end in list order.
 * Child offsets are derived from sequential placement (explicit offset still allowed
 * for children that need to break out, e.g. a cue at -4).
 */
export interface Sequence {
  kind: "sequence";
  name?: string;
  offset?: number;
  bpm?: number;
  timeSignature?: [number, number];
  duration?: Duration;
  tag?: string;
  children?: Node[];
}

/** Root of the tree. BPM and timeSignature are required (no parent to inherit from). */
export interface Song {
  kind: "song";
  title: string;
  artist?: string;
  key?: string;
  bpm: number;
  timeSignature: [number, number];
  children: Node[];
}

/** An audio file placed on the timeline, assigned to a named track. */
export interface Audio {
  kind: "audio";
  name: string;       // track name (e.g. "Guitars", "Bass")
  file: string;       // path to audio file
  offset?: number;    // beats relative to parent; default 0
  soffs?: number;     // source offset in seconds (trim from start of file)
}

/** Any node in the tree. */
export type Node = Event | Span | Sequence | Song | Audio;

/** A single word with timing (milliseconds) and optional confidence (0–1). */
export interface Word {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

/** A group of words that belong together as a lyric line. */
export type Phrase = Word[];
