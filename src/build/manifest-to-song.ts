/**
 * Convert an inert `.song.json` manifest into an in-memory DSongL `Song`.
 *
 * The manifest is the durable, safe-to-load, front-end-agnostic source; DSongL
 * is the internal engine (linearize + build-rpp). This adapter is the only new
 * code — everything downstream (linearize, RPP emission) is reused unchanged.
 *
 * Only the RPP side needs the Song: sections → spans, stems → audio tracks,
 * plus tempo/meter. Lyrics are NOT put in the tree — their timing is measured
 * by build-lyrics from the alignment, a separate path.
 *
 * The stem `offset` (where the recording sits on the beat grid) is DERIVED from
 * the manifest's `recording.anchor` — the same single source the recording
 * curve uses for word beats — so the stems and the words can't drift apart.
 */

import { resolve } from "node:path";
import { song, seq, span, audio, bars, cue } from "../core/dsongl/index.js";
import type { Song, Node } from "../core/dsongl/index.js";
import type { SongManifest } from "../manifest.js";
import { sectionStarts } from "../manifest.js";
import { beatMapToBeats, beatMapCurve } from "../core/beat-map.js";
import { Curve } from "../core/curve.js";

/** Stable, slug-safe id for a pitch cue's synthesized WAV, from its notes.
 *  e.g. ["F#3","A#3","C#4"] → "tone-f-3-a-3-c-4". Idempotent under the cue-file
 *  slugging in build-rpp, so the write path and read path agree. */
export function toneSlug(notes: string[]): string {
  return "tone-" + notes.join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
}

/**
 * The stem's beat offset: where detected-beat-0 lands relative to the downbeat.
 * Equivalent to the offset the recording curve applies, derived from the same
 * anchor, so build-rpp's stem placement matches build-lyrics's word beats.
 */
export function stemOffset(
  anchor: { t: number; b: number },
  beats: readonly { time: number }[],
): number {
  const raw = new Curve(beats.map((bt, i) => ({ t: bt.time, b: i })));
  return anchor.b - raw.toBeat(anchor.t);
}

export function manifestToSong(
  manifest: SongManifest,
  manifestDir: string,
): Song {
  // Sections -> spans. Structure only (name, duration, cue, meter override);
  // lyrics stay out of the tree — build-lyrics measures their timing.
  const spans: Node[] = manifest.sections.map((s) => {
    const opts = {
      ...(s.cue !== undefined ? { cue: s.cue } : {}),
      ...(s.timeSignature ? { timeSignature: s.timeSignature } : {}),
    };
    // Manual cues become cue() events at section-relative beats. A pitch cue
    // (`tone`) carries its notes + duration; its `value` is a stable slug for the
    // synthesized WAV. A spoken cue keeps its label.
    const marks: Node[] = (s.cues ?? []).map((m) =>
      m.tone
        ? { ...cue(toneSlug(m.tone), m.at), tone: m.tone, toneBars: m.bars ?? 1 }
        : cue(m.label!, m.at),
    );
    return marks.length > 0 ? span(s.name, bars(s.bars), opts, marks) : span(s.name, bars(s.bars), opts);
  });

  // Stems -> audio tracks. All share the recording's beat-map: the offset (the
  // song beat of the recording's first control point) places the item on the
  // grid; the per-beat source times feed the stretch-marker engine in build-rpp
  // (passed there as a shared `recordingBeats`, not per node). Plus any
  // group-level source trim.
  const stems = manifest.sources.stems;
  const beatMap = manifest.sources.recording.beatMap;
  const { offset } = beatMapToBeats(beatMap, manifest.bpm);
  const audios: Node[] = [];
  if (stems) {
    const files = Object.entries(stems.files);
    if (stems.clips && stems.clips.length > 0) {
      // Clips assemble each stem from the source, laid end-to-end on the
      // timeline. A clip's timeline length in beats comes from the global
      // beat-map (source-seconds -> beats); silence advances the cursor with no
      // audio. Every stem shares the same clip arrangement, so each clip emits
      // one same-named node per stem -> grouped into one track downstream.
      const curve = beatMapCurve(beatMap, manifest.bpm);
      const bps = manifest.bpm / 60;
      let cursorBeat = offset; // timeline beat where the next clip begins
      for (const clip of stems.clips) {
        if ("silence" in clip) {
          cursorBeat += clip.silence * bps; // gap on the timeline
          continue;
        }
        const to = clip.from + clip.seconds;
        const lenBeats = curve.toBeat(to) - curve.toBeat(clip.from);
        for (const [key, file] of files) {
          audios.push(
            audio(titleCase(key), resolve(manifestDir, stems.dir, file), {
              offset: cursorBeat,
              soffs: clip.from,
              sourceEnd: to,
            }),
          );
        }
        cursorBeat += lenBeats;
      }
      // Clips must tile the section timeline, or audio and click drift apart.
      const clipsBeats = cursorBeat - offset;
      const songBeats = sectionStarts(manifest.sections, manifest.timeSignature).at(-1)!;
      if (Math.abs(clipsBeats - songBeats) > 0.25) {
        throw new Error(
          `clips span ${clipsBeats.toFixed(2)} beats but sections span ${songBeats} beats — they must match`,
        );
      }
    } else {
      for (const [key, file] of files) {
        audios.push(
          audio(titleCase(key), resolve(manifestDir, stems.dir, file), {
            offset,
            ...(stems.soffs !== undefined ? { soffs: stems.soffs } : {}),
            ...(stems.sourceEnd !== undefined ? { sourceEnd: stems.sourceEnd } : {}),
          }),
        );
      }
    }
  }

  return song(
    manifest.title,
    manifest.bpm,
    {
      ...(manifest.artist ? { artist: manifest.artist } : {}),
      ...(manifest.key ? { key: manifest.key } : {}),
      timeSignature: manifest.timeSignature,
    },
    seq(...spans),
    ...audios,
  );
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
