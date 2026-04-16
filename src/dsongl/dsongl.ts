import type { Duration, Event, Span, Sequence, Song, Audio, Node } from "./types.js";

// --- Duration sugar ---

export function bars(n: number): Duration { return { bars: n }; }
export function beats(n: number): Duration { return { beats: n }; }

// --- Event builders ---

/** Resolve an offset that might be a raw number or a Duration (from beats()). */
function resolveOffset(offset?: number | Duration): number | undefined {
  if (offset === undefined) return undefined;
  if (typeof offset === "number") return offset;
  if ("beats" in offset) return offset.beats;
  // bars not supported for event offsets — would need a time signature
  throw new Error("Cannot use bars() for event offsets — use beats() or a raw number");
}

export function cue(value: string, offset?: number | Duration, tag?: string): Event {
  return { kind: "event", type: "cue", value, offset: resolveOffset(offset), tag };
}

export function chord(value: string, offset?: number | Duration, tag?: string): Event {
  return { kind: "event", type: "chord", value, offset: resolveOffset(offset), tag };
}

export function lyric(value: string, offset?: number | Duration, tag?: string): Event {
  return { kind: "event", type: "lyric", value, offset: resolveOffset(offset), tag };
}

export function marker(value: string, offset?: number | Duration, tag?: string): Event {
  return { kind: "event", type: "marker", value, offset: resolveOffset(offset), tag };
}

// --- Structure builders ---

interface SpanOptions {
  bpm?: number;
  timeSignature?: [number, number];
  tag?: string;
  cue?: boolean;
}

export function span(name: string, duration: Duration, children?: Node[]): Span;
export function span(name: string, duration: Duration, opts: SpanOptions, children?: Node[]): Span;
export function span(name: string, duration: Duration, third?: Node[] | SpanOptions, fourth?: Node[]): Span {
  const opts = Array.isArray(third) ? {} : (third ?? {});
  const children = Array.isArray(third) ? third : fourth;
  return {
    kind: "span",
    name,
    duration,
    ...opts.bpm !== undefined && { bpm: opts.bpm },
    ...opts.timeSignature !== undefined && { timeSignature: opts.timeSignature },
    ...opts.tag !== undefined && { tag: opts.tag },
    ...opts.cue !== undefined && { cue: opts.cue },
    ...children !== undefined && { children },
  };
}

// --- Audio builder ---

interface AudioOptions {
  offset?: number;
  soffs?: number;
  beatsFile?: string;
}

export function audio(name: string, file: string, opts?: AudioOptions): Audio {
  return {
    kind: "audio",
    name,
    file,
    ...opts?.offset !== undefined && { offset: opts.offset },
    ...opts?.soffs !== undefined && { soffs: opts.soffs },
    ...opts?.beatsFile !== undefined && { beatsFile: opts.beatsFile },
  };
}

export function seq(...children: Node[]): Sequence {
  return { kind: "sequence", children };
}

interface SongOptions {
  timeSignature?: [number, number];
  artist?: string;
  key?: string;
  /** Seconds of silence at the start of stem audio files. Applied as default
   *  soffs to every audio() node so file-time beat 0 aligns with bar 1. */
  preRollSeconds?: number;
}

export function song(title: string, bpm: number, ...children: Node[]): Song;
export function song(title: string, bpm: number, opts: SongOptions, ...children: Node[]): Song;
export function song(title: string, bpm: number, ...args: (Node | SongOptions)[]): Song {
  const first = args[0];
  const hasOpts = first !== undefined && !Array.isArray(first) && typeof first === "object" && !("kind" in first);
  const opts = hasOpts ? (first as SongOptions) : {};
  const children = (hasOpts ? args.slice(1) : args) as Node[];
  return {
    kind: "song",
    title,
    ...opts.artist !== undefined && { artist: opts.artist },
    ...opts.key !== undefined && { key: opts.key },
    bpm,
    timeSignature: opts.timeSignature ?? [4, 4],
    ...opts.preRollSeconds !== undefined && { preRollSeconds: opts.preRollSeconds },
    children,
  };
}
