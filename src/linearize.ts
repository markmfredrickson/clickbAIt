import type { Node, Event, Span, Sequence, Song, Audio, Duration } from "./dsongl/index.js";
import { Curve } from "./curve.js";

export interface LinearEvent {
  beat: number;
  seconds: number;
  type: Event["type"] | "tempo" | "timesig" | "audio";
  value: string;
  tag?: string;
  /** For audio events: path to audio file */
  file?: string;
  /** For audio events: source offset in seconds (trim from start) */
  soffs?: number;
  /** For audio events: file-absolute source end in seconds; caps item length */
  sourceEnd?: number;
  /** For audio events: path to .beats.json sidecar for stretch markers */
  beatsFile?: string;
  /** For audio events: emit a stretch marker every Nth beat (default 1) */
  smStride?: number;
}

interface Context {
  beatOffset: number;
  bpm: number;
  timeSignature: [number, number];
  tag?: string;
}

/** Resolve a Duration to beats using the active time signature. */
function durationBeats(d: Duration, ts: [number, number]): number {
  if ("beats" in d) return d.beats;
  return d.bars * ts[0];
}

/** Collect all events from the tree with absolute beat positions. */
function walk(node: Node, ctx: Context, out: LinearEvent[]): void {
  switch (node.kind) {
    case "song": {
      const songCtx: Context = {
        beatOffset: 0,
        bpm: node.bpm,
        timeSignature: node.timeSignature,
      };
      out.push({ beat: 0, seconds: 0, type: "tempo", value: String(node.bpm) });
      out.push({ beat: 0, seconds: 0, type: "timesig", value: `${node.timeSignature[0]}/${node.timeSignature[1]}` });
      for (const child of node.children) {
        walk(child, songCtx, out);
      }
      break;
    }

    case "event": {
      const beat = ctx.beatOffset + (node.offset ?? 0);
      out.push({
        beat,
        seconds: 0, // filled in later
        type: node.type,
        value: node.value,
        tag: node.tag ?? ctx.tag,
      });
      break;
    }

    case "span": {
      walkSpan(node, ctx, out);
      break;
    }

    case "sequence": {
      walkSequence(node, ctx, out);
      break;
    }

    case "audio": {
      const beat = ctx.beatOffset + (node.offset ?? 0);
      out.push({
        beat,
        seconds: 0,
        type: "audio",
        value: node.name,  // track name
        file: node.file,
        soffs: node.soffs,
        sourceEnd: node.sourceEnd,
        beatsFile: node.beatsFile,
        smStride: node.smStride,
      });
      break;
    }
  }
}

function walkSpan(node: Span, ctx: Context, out: LinearEvent[]): void {
  const beat = ctx.beatOffset + (node.offset ?? 0);
  const bpm = node.bpm ?? ctx.bpm;
  const ts = node.timeSignature ?? ctx.timeSignature;
  const tag = node.tag ?? ctx.tag;

  const bpmChanged = node.bpm !== undefined && node.bpm !== ctx.bpm;
  const tsChanged = node.timeSignature !== undefined &&
    (node.timeSignature[0] !== ctx.timeSignature[0] || node.timeSignature[1] !== ctx.timeSignature[1]);

  if (bpmChanged) {
    out.push({ beat, seconds: 0, type: "tempo", value: String(bpm) });
  }
  if (tsChanged) {
    out.push({ beat, seconds: 0, type: "timesig", value: `${ts[0]}/${ts[1]}` });
  }

  const childCtx: Context = { beatOffset: beat, bpm, timeSignature: ts, tag };

  if (node.children) {
    for (const child of node.children) {
      walk(child, childCtx, out);
    }
  }

  // Restore BPM/timesig after span ends
  const dur = node.duration ? durationBeats(node.duration, ts) : 0;
  const endBeat = beat + dur;

  if (bpmChanged) {
    out.push({ beat: endBeat, seconds: 0, type: "tempo", value: String(ctx.bpm) });
  }
  if (tsChanged) {
    out.push({ beat: endBeat, seconds: 0, type: "timesig", value: `${ctx.timeSignature[0]}/${ctx.timeSignature[1]}` });
  }
}

function walkSequence(node: Sequence, ctx: Context, out: LinearEvent[]): void {
  const seqStart = ctx.beatOffset + (node.offset ?? 0);
  const bpm = node.bpm ?? ctx.bpm;
  const ts = node.timeSignature ?? ctx.timeSignature;
  const tag = node.tag ?? ctx.tag;

  let cursor = seqStart;
  for (const child of node.children ?? []) {
    const childCtx: Context = { beatOffset: cursor, bpm, timeSignature: ts, tag };
    walk(child, childCtx, out);
    cursor += childDuration(child, ts);
  }
}

/** Get the duration of a node in beats (for sequential placement). */
function childDuration(node: Node, ts: [number, number]): number {
  switch (node.kind) {
    case "event":
    case "audio":
      return 0;
    case "span":
    case "sequence": {
      const localTs = node.timeSignature ?? ts;
      if (node.duration) return durationBeats(node.duration, localTs);
      return 0;
    }
    case "song":
      return 0;
  }
}

/** Compute seconds for each event based on beat position and tempo changes. */
function assignSeconds(events: LinearEvent[]): void {
  // Sort by beat, with tempo/timesig events first at each beat
  events.sort((a, b) => {
    if (a.beat !== b.beat) return a.beat - b.beat;
    const priority = (e: LinearEvent) => (e.type === "tempo" || e.type === "timesig") ? 0 : 1;
    return priority(a) - priority(b);
  });

  // Resolve every event's seconds through the canonical Curve. The tempo
  // events (always anchored at beat 0 by linearize) define the map; with no
  // tempo events there's no defined timing, so seconds stay 0.
  const tempoMap = events
    .filter((e) => e.type === "tempo")
    .map((e) => ({ beat: e.beat, bpm: Number(e.value) }));
  if (tempoMap.length === 0) {
    for (const event of events) event.seconds = 0;
    return;
  }
  const curve = Curve.fromTempoMap(tempoMap);
  for (const event of events) {
    event.seconds = curve.toTime(event.beat);
  }
}

/** Find the minimum beat and pad with full bars if negative. Returns the shift amount. */
function computePadding(events: LinearEvent[], ts: [number, number]): number {
  const minBeat = Math.min(...events.map((e) => e.beat));
  if (minBeat >= 0) return 0;
  const beatsPerBar = ts[0];
  const barsNeeded = Math.ceil(Math.abs(minBeat) / beatsPerBar);
  return barsNeeded * beatsPerBar;
}

export interface LinearizeResult {
  events: LinearEvent[];
  /** Number of beats added at the start to accommodate negative offsets. */
  paddingBeats: number;
}

export interface LinearizeOptions {
  withPadding?: true;
  /** Minimum padding beats to prepend (e.g. for a slug region). */
  minPaddingBeats?: number;
}

export function linearize(root: Song): LinearEvent[];
export function linearize(root: Song, opts: LinearizeOptions & { withPadding: true }): LinearizeResult;
export function linearize(root: Song, opts: LinearizeOptions): LinearEvent[];
export function linearize(root: Song, opts?: LinearizeOptions): LinearEvent[] | LinearizeResult {
  const events: LinearEvent[] = [];
  walk(root, { beatOffset: 0, bpm: root.bpm, timeSignature: root.timeSignature }, events);

  // Pad for negative offsets, plus any caller-requested minimum
  const computed = computePadding(events, root.timeSignature);
  const shift = Math.max(computed, opts?.minPaddingBeats ?? 0);
  if (shift > 0) {
    for (const e of events) {
      e.beat += shift;
    }
    // Ensure tempo and timesig events exist at beat 0 so the padded region has valid timing
    events.push({ beat: 0, seconds: 0, type: "tempo", value: String(root.bpm) });
    events.push({ beat: 0, seconds: 0, type: "timesig", value: `${root.timeSignature[0]}/${root.timeSignature[1]}` });
  }

  // Deduplicate tempo/timesig restore events that match the initial state
  // (e.g. don't emit tempo 120 at beat 0 twice)
  dedupeMetaEvents(events);

  assignSeconds(events);

  if (opts?.withPadding) {
    return { events, paddingBeats: shift };
  }
  return events;
}

/** Remove duplicate tempo/timesig events at the same beat with the same value. */
function dedupeMetaEvents(events: LinearEvent[]): void {
  const seen = new Set<string>();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "tempo" || e.type === "timesig") {
      const key = `${e.type}@${e.beat}:${e.value}`;
      if (seen.has(key)) {
        events.splice(i, 1);
      } else {
        seen.add(key);
      }
    }
  }
}
