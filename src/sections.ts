import type { Node, Song, Duration } from "@clickbait/dsongl";

/** A section boundary extracted from the song tree. */
export interface Section {
  name: string;
  beat: number;           // absolute beat position
  durationBeats: number;
  timeSignature: [number, number];
  bpm: number;
  cue?: boolean;          // if true, buildRpp auto-places a TTS cue before this section
}

interface Ctx {
  beatOffset: number;
  bpm: number;
  timeSignature: [number, number];
}

function durationBeats(d: Duration, ts: [number, number]): number {
  if ("beats" in d) return d.beats;
  return d.bars * ts[0];
}

function childDuration(node: Node, ts: [number, number]): number {
  if (node.kind === "event" || node.kind === "song") return 0;
  const localTs = node.timeSignature ?? ts;
  if (node.duration) return durationBeats(node.duration, localTs);
  return 0;
}

/**
 * Walk the song tree and extract named span boundaries.
 * Only top-level spans in sequences are treated as sections.
 */
export function extractSections(song: Song): Section[] {
  const sections: Section[] = [];
  const ctx: Ctx = { beatOffset: 0, bpm: song.bpm, timeSignature: song.timeSignature };
  walkChildren(song.children, ctx, sections, true);
  return sections;
}

function walkChildren(children: Node[], ctx: Ctx, out: Section[], isSequence: boolean): void {
  let cursor = ctx.beatOffset;

  for (const child of children) {
    const childCtx: Ctx = { ...ctx, beatOffset: isSequence ? cursor : ctx.beatOffset };

    if (child.kind === "span") {
      const beat = childCtx.beatOffset + (child.offset ?? 0);
      const bpm = child.bpm ?? ctx.bpm;
      const ts = child.timeSignature ?? ctx.timeSignature;
      const dur = child.duration ? durationBeats(child.duration, ts) : 0;

      if (child.name) {
        out.push({ name: child.name, beat, durationBeats: dur, timeSignature: ts, bpm, cue: child.cue });
      }

      if (child.children) {
        walkChildren(child.children, { beatOffset: beat, bpm, timeSignature: ts }, out, false);
      }
    } else if (child.kind === "sequence") {
      const seqBeat = childCtx.beatOffset + (child.offset ?? 0);
      const bpm = child.bpm ?? ctx.bpm;
      const ts = child.timeSignature ?? ctx.timeSignature;
      if (child.children) {
        walkChildren(child.children, { beatOffset: seqBeat, bpm, timeSignature: ts }, out, true);
      }
    }

    if (isSequence) {
      cursor += childDuration(child, ctx.timeSignature);
    }
  }
}
