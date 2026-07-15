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

/**
 * The recording's BEAT-MAP: where each song beat lands in the source audio,
 * as `source-time (seconds) ↔ song-beat` control points. This is the authored,
 * durable replacement for a detected `beats.json` + a single `anchor`.
 *
 * The curve runs piecewise-linear through the control points and extrapolates
 * at the song BPM past the outermost pin (see `beat-map.ts`). Density is the
 * only knob: pin every beat and the curve follows the recording's micro-timing;
 * leave a gap and those beats interpolate linearly (a deliberate stretch — e.g.
 * a rubato intro compressed into fewer bars); pin every Nth beat and the
 * in-between beats float (a loose/rubato feel). So this one structure absorbs
 * what used to be `anchor`, detected beats, `smStride`, and hand-tuned intros.
 *
 * `t` values are the reference recording's source seconds (file-absolute), NOT
 * project time; stems relate to them through their own `soffs`.
 */

/** A single pinned control point: song beat `beat` occurs at source time `t`. */
const BeatPin = z.object({ beat: z.number(), t: z.number() }).strict();

/**
 * A run of control points at evenly-spaced beat numbers: song beats
 * `startBeat, startBeat + stride, startBeat + 2·stride, …` occur at the given
 * source `times` (one per entry, in order). `stride` defaults to 1 (every beat).
 * A stride > 1 pins only every Nth beat and lets the rest float.
 */
const BeatRun = z
  .object({
    startBeat: z.number(),
    stride: z.number().int().positive().optional(),
    times: z.array(z.number()).min(1),
  })
  .strict();

const BeatMap = z.array(z.union([BeatPin, BeatRun])).min(1);

/** The primary recording: source audio plus its analysis artifacts. */
const RecordingSource = z
  .object({
    kind: z.literal("audio"),
    file: z.string().min(1),
    analysis: ArtifactRef.optional(),
    /** Where each song beat lands in this recording (see BeatMap). Replaces the
     *  old detected-`beats` reference + single `anchor`. */
    beatMap: BeatMap,
  })
  .strict();

/**
 * A clip that assembles part of a track from the source. Either AUDIO — play
 * `seconds` of source starting at `from` (source seconds; the global beatMap
 * gives its timeline length + internal stretch) — or SILENCE, a `silence`-second
 * gap on the timeline. Clips are laid end-to-end; a track's audio is their
 * concatenation. Boundaries are free source-time positions, NOT tied to
 * sections (a clip edge landing on a section edge is coincidence). See
 * docs/song-schema-migration.md.
 */
const AudioClip = z.object({ from: z.number().nonnegative(), seconds: z.number().positive() }).strict();
const SilenceClip = z.object({ silence: z.number().positive() }).strict();
const Clip = z.union([AudioClip, SilenceClip]);

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
    /**
     * Ordered clips assembling every stem from the source (all stems share the
     * arrangement). Absent = one implicit clip over the whole recording — the
     * default, byte-identical to the pre-clip single-item behavior. Use clips to
     * repeat/rearrange source regions (e.g. repeat a chorus as the outro). The
     * clips' total timeline length must equal the section timeline.
     */
    clips: z.array(Clip).min(1).optional(),
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
 * A section. Sections are an ORDERED list starting at measure 1, beat 1 in
 * REAPER; each one's start beat is INFERRED from the lengths of the sections
 * before it (see `sectionStarts`), never authored. So `bars` (its length) is
 * the only placement field — there is no absolute start, which would be
 * redundant with the running total and could silently disagree with it.
 *
 * `lines` are the lyric lines that belong to this section (in sung order).
 * Nesting makes section membership explicit, so a pickup line — sung a beat or
 * two before the section's downbeat — still groups under its section instead of
 * being guessed into the previous one from its measured beat. Instrumental
 * sections omit `lines`. Lines across all sections, in order, are the full
 * lyric fed to the aligner. Any offsets within a section (`cues[].at`) are
 * relative to the section start and resolved to absolute beats downstream.
 */
const Section = z
  .object({
    name: z.string().min(1),
    bars: z.number().positive(),
    cue: z.boolean().optional(),
    /** Meter for this section, if it differs from the song default (e.g. a 6/8
     *  bridge). Omitted = inherit the song's timeSignature. */
    timeSignature: TimeSignature.optional(),
    /** Stretch-marker stride for this section: emit a marker every Nth beat
     *  instead of every beat. Use for loose/rubato passages (e.g. a triplet-feel
     *  solo) where per-beat markers fight the performance — `smStride: 4` in 4/4
     *  pins only the downbeats and lets the feel between them play naturally.
     *  `smStride: 0` emits NO markers in this section — the audio plays 1:1
     *  (unwarped) between the surrounding sections' anchors. Use when the
     *  detected beats here are unreliable (e.g. a rubato, drum-less intro) and
     *  any stretching would only fight the recording. Omitted = every beat (1). */
    smStride: z.number().int().nonnegative().optional(),
    /** Source position (SECONDS) for this section's leading stretch marker
     *  (item 0). Only meaningful on the FIRST section, paired with `smStride: 0`:
     *  the whole section is one stretch segment from the file start to the next
     *  section's anchor, and this sets where in the source that segment begins.
     *  Default 0 (identity). Hand-tune a loose/rubato intro by ear in REAPER,
     *  then record the moved marker's source position here so regeneration
     *  reproduces it. Negative = the segment starts before source 0 (lead-in). */
    smLeadSource: z.number().optional(),
    /** Inline stretch markers for this section's audio, emitted VERBATIM as
     *  (item-seconds, source-seconds) pairs, for a hand-tuned loose intro
     *  captured from REAPER. Pair with `smStride: 0`: these replace the
     *  generated markers across the section, and the beat grid resumes at the
     *  next section. `soffs` (on the stems group) trims the item start to match.
     *  Item positions are relative to the item's left edge; source positions are
     *  file-absolute (may be negative — REAPER reads pre-file as silence). */
    stretchMarkers: z.array(z.object({ item: z.number(), source: z.number() }).strict()).optional(),
    /** Manual cues at beats relative to this section's start (e.g. a count-in
     *  "1,2,3,4", a "hit", or a cold-open pitch). Distinct from `cue` (which
     *  auto-announces the section name); these are extra band cues placed by
     *  hand. A cue is either SPOKEN (`label`, Piper TTS) or a PITCH (`tone`: note
     *  names sounded together and held for `bars`, synthesized — for a cold vocal
     *  open). One of `label`/`tone` is required. A pitch cue sits at its authored
     *  beat and is not onset-anchored, so it can overlap the count-in. */
    cues: z
      .array(
        z
          .object({
            at: z.number(),
            label: z.string().min(1).optional(),
            tone: z.array(z.string().min(1)).min(1).optional(),
            bars: z.number().positive().optional(),
          })
          .strict()
          .refine((c) => c.label !== undefined || c.tone !== undefined, {
            message: "a cue needs a `label` (spoken) or a `tone` (pitch)",
          }),
      )
      .optional(),
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

    /**
     * Bars the stems keep playing PAST the song end (natural decay, 1:1, no
     * stretch) while the click halts at the last section. For songs that end on
     * a hit or stop abruptly, so the backing rings out instead of hard-cutting.
     * Default 0. Fractional allowed.
     */
    ringOutBars: z.number().nonnegative().default(0),

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
export type BeatMap = z.infer<typeof BeatMap>;
export type Clip = z.infer<typeof Clip>;

/** A section as far as placement is concerned: length in bars, optional meter. */
type PlaceableSection = { bars: number; timeSignature?: readonly [number, number] };

/**
 * The absolute start beat of each section, inferred from order + length.
 *
 * Sections begin at measure 1 beat 1 and run back-to-back, so section `i`
 * starts where all sections before it end: the running sum of `bars ×
 * beats-per-bar`, honoring any per-section meter override (else the song
 * default). This is the single definition of "where a section starts" — every
 * consumer that needs an absolute section beat derives it here rather than
 * carrying a redundant authored value. `result[i]` is section `i`'s start;
 * `result[sections.length]` (one past the end) is the song-end beat.
 */
export function sectionStarts(
  sections: readonly PlaceableSection[],
  defaultTimeSignature: readonly [number, number],
): number[] {
  const starts: number[] = [];
  let beat = 0;
  for (const s of sections) {
    starts.push(beat);
    const beatsPerBar = s.timeSignature?.[0] ?? defaultTimeSignature[0];
    beat += s.bars * beatsPerBar;
  }
  starts.push(beat); // one past the last section = song end
  return starts;
}
