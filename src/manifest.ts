/**
 * Song manifest schema (`<slug>.song.json`).
 *
 * An inert JSON manifest that explicitly references the artifacts produced by
 * `clickbait-audio` (beats, analysis, alignment, stems, cues) and carries the
 * authored song structure. This replaces the `.ts` DSongL authoring format.
 *
 * Conceptual model (see docs/song-schema-migration.md): a song is a strictly
 * monotonic curve in `(time, beat)` space — time and beat are co-equal axes.
 * A lyric line may be authored in `b` (beat), `t` (seconds), or both; the
 * builder resolves the missing coordinate through the song curve (and prefers
 * measured alignment for `t` when available).
 *
 * The zod schema is the single source of truth: `SongManifest` is its
 * `z.infer`, so there is no hand-written type to drift out of sync.
 */

import { z } from "zod";

/** A reference to a file produced by some tool, with provenance. */
const ArtifactRef = z
  .object({
    file: z.string().min(1),
    /** What produced this artifact, e.g. "clickbait-audio align" or "human". */
    "produced-by": z.string().min(1),
    /** Set when a human hand-edited the artifact (e.g. corrected beats). */
    edited: z.boolean().optional(),
  })
  .strict();

/** A positive integer (beats-per-bar, beat-unit). */
const PosInt = z.number().int().positive();

/** Time signature as [numerator, denominator]. */
const TimeSignature = z.tuple([PosInt, PosInt]);

/** A point fixing the curve: time (seconds) ↔ beat. */
const Anchor = z.object({ t: z.number(), b: z.number() }).strict();

/** The primary recording: source audio plus its analysis artifacts. */
const RecordingSource = z
  .object({
    kind: z.literal("audio"),
    file: z.string().min(1),
    beats: ArtifactRef,
    analysis: ArtifactRef.optional(),
    /** Anchors the recording curve into absolute time (e.g. pre-roll). */
    anchor: Anchor,
  })
  .strict();

/** A group of stems that inherit another source's curve by reference. */
const StemsSource = z
  .object({
    kind: z.literal("audio-group"),
    /** Name of the source whose curve these stems share (e.g. "recording"). */
    curveRef: z.string().min(1),
    "produced-by": z.string().min(1),
    dir: z.string().min(1),
    files: z.record(z.string(), z.string().min(1)),
    /** Seconds to trim from the start of each source file (skip an intro). */
    soffs: z.number().nonnegative().optional(),
    /** File-absolute source end in seconds; caps item length to sourceEnd - soffs. */
    sourceEnd: z.number().positive().optional(),
  })
  .strict();

/**
 * An authored lyric line. A line is a DISPLAY-organization unit (where text
 * wraps on the prompter), not the timing unit — timing is measured from
 * alignment at build. So a line is normally just `text` (+ optional `tag`);
 * `b`/`t` are rare MANUAL OVERRIDES for when alignment failed and you want to
 * pin it by hand.
 */
const LyricLine = z
  .object({
    text: z.string(),
    b: z.number().optional(),
    t: z.number().optional(),
    tag: z.string().optional(),
  })
  .strict();

/**
 * A section. Its start beat is the structural anchor; `lines` are the lyric
 * lines that belong to it (in sung order). Nesting makes section membership
 * explicit, so a pickup line — sung a beat or two before the section's
 * downbeat — still groups under its section instead of being guessed into the
 * previous one from its measured beat. Instrumental sections omit `lines`.
 * Lines across all sections, in order, are the full lyric fed to the aligner.
 */
const Section = z
  .object({
    name: z.string().min(1),
    b: z.number(),
    bars: z.number().positive(),
    cue: z.boolean().optional(),
    /** Meter for this section, if it differs from the song default (e.g. a 6/8
     *  bridge). Omitted = inherit the song's timeSignature. */
    timeSignature: TimeSignature.optional(),
    /** Manual spoken cues at beats relative to this section's start (e.g. a
     *  count-in "1,2,3,4" or a "hit"). Distinct from `cue` (which auto-announces
     *  the section name); these are extra band cues placed by hand. */
    cues: z.array(z.object({ at: z.number(), label: z.string().min(1) }).strict()).optional(),
    lines: z.array(LyricLine).optional(),
  })
  .strict();

export const SongManifestSchema = z
  .object({
    schema: z.literal("clickbait/song@1"),
    title: z.string().min(1),
    artist: z.string().optional(),
    key: z.string().optional(),
    bpm: z.number().positive(),
    timeSignature: TimeSignature,

    /**
     * Whole bars of count-in/cue lead-in before the song's downbeat. The
     * pre-roll lives at positive time but NEGATIVE beats (see
     * docs/timing-frames.md): it sets the song curve's `t0` (downbeat at
     * `preRollBars` bars in) and REAPER's `PROJOFFS` measure offset. Default 0.
     */
    preRollBars: z.number().int().nonnegative().default(0),

    metadata: ArtifactRef.optional(),

    sources: z
      .object({
        recording: RecordingSource,
        stems: StemsSource.optional(),
      })
      .strict(),

    /** The song's intended curve. Only constant-BPM for now. */
    songCurve: z.enum(["constantBpm"]),

    // Sections carry their own lyric lines (see Section). `alignment` is the
    // only lyric file ref — the measured per-word timing, too big to inline.
    // The flat lyric text fed to the aligner is the sections' lines in order
    // (an intermediate), not stored here, so nothing can drift.
    sections: z.array(Section),

    lyrics: z
      .object({
        alignment: ArtifactRef.optional(),
      })
      .strict(),

    cues: z
      .object({ dir: z.string().min(1), "produced-by": z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict()
  // Cross-field: any source's curveRef must name an existing source key.
  // An unresolvable reference has no curve to inherit — a build-time bug.
  .superRefine((m, ctx) => {
    const keys = new Set(Object.keys(m.sources));
    for (const [name, src] of Object.entries(m.sources)) {
      if (src && "curveRef" in src && !keys.has(src.curveRef)) {
        ctx.addIssue({
          code: "custom",
          message: `sources.${name}.curveRef "${src.curveRef}" names no source (have: ${[...keys].join(", ")})`,
          path: ["sources", name, "curveRef"],
        });
      }
    }
  });

export type SongManifest = z.infer<typeof SongManifestSchema>;
