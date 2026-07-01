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
import { song, seq, span, audio, bars } from "./dsongl/index.js";
import type { Song, Node } from "./dsongl/index.js";
import type { SongManifest } from "./manifest.js";
import { Curve } from "./curve.js";

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
  beats: readonly { time: number }[],
  manifestDir: string,
): Song {
  // Sections -> spans. Structure only (name, duration, cue, meter override);
  // lyrics stay out of the tree — build-lyrics measures their timing.
  const spans: Node[] = manifest.sections.map((s) =>
    span(s.name, bars(s.bars), {
      ...(s.cue !== undefined ? { cue: s.cue } : {}),
      ...(s.timeSignature ? { timeSignature: s.timeSignature } : {}),
    }),
  );

  // Stems -> audio tracks. All share the recording's beats and the anchor-
  // derived offset (and any group-level source trim).
  const stems = manifest.sources.stems;
  const rec = manifest.sources.recording;
  const offset = stemOffset(rec.anchor, beats);
  const beatsFile = resolve(manifestDir, rec.beats.file);
  const audios: Node[] = stems
    ? Object.entries(stems.files).map(([key, file]) =>
        audio(titleCase(key), resolve(manifestDir, stems.dir, file), {
          offset,
          beatsFile,
          ...(stems.soffs !== undefined ? { soffs: stems.soffs } : {}),
          ...(stems.sourceEnd !== undefined ? { sourceEnd: stems.sourceEnd } : {}),
        }),
      )
    : [];

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
