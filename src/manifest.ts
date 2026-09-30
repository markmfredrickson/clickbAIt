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
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

/** A reference to a build-produced file. How it's made lives in the song's
 *  package.json recipe, not here — a manifest never restates its provenance. */
const ArtifactRef = z
  .object({
    file: z.string().min(1),
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
    /** Anchor for the RAW detected beat grid (`<source>.beats.json`): the song
     *  beat the FIRST detected beat lands on — negative for a pickup (beats before
     *  the downbeat at 0). `beats:smooth` reads this to convert raw beats → the
     *  beatMap sidecar; it's the one authored value detection can't infer.
     *  Defaults to 0. */
    startBeat: z.number().optional(),
    /** Where each song beat lands in this recording (see BeatMap). Either the
     *  inline map, or a ref to an external `<source>.beatmap.json` holding that
     *  same map (produced by `beats:smooth`) — the generated timing data lives
     *  in a sidecar so it's out of the hand-authored manifest and gets its own
     *  build dep. Resolve with `resolveBeatMap`. */
    beatMap: z.union([BeatMap, ArtifactRef]),
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
    /** Whether the click plays during this section. Omit = on. `click: false`
     *  DROPS the click for this section — the band plays free of the metronome
     *  (a click-recorded song whose ending was played by feel). Orthogonal to
     *  `smStride` (stretch markers): pair with `smStride: 0` for a ring-out (no
     *  click AND audio 1:1 to source end), or use alone for a grid-locked backing
     *  with no click. Only the TRAILING case (click off through the end) is
     *  implemented; mid-song click-off would need the click item split. */
    click: z.boolean().optional(),
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

/**
 * Transposition for the whole show track: bare semitones, or a spec object
 * with either explicit `steps` or a `from`/`to` key pair (steps inferred —
 * shortest distance, tritone resolves down; the pair also documents the keys
 * for later chart uses). `stems` overrides the semitones per stem (bass up a
 * fifth instead of down a fourth; `drums: 0` pins a clean drum stem back to
 * unshifted). `shifters` overrides the pitch-shift
 * engine per stem, by name (see SHIFTER_MODES in build/transpose.ts) or raw
 * REAPER pitchmode int. Lyric/beat timing is untouched — pitch-only.
 */
const TransposeSpec = z.union([
  z.number().int(),
  z
    .object({
      steps: z.number().int().optional(),
      from: z.string().min(1).optional(),
      to: z.string().min(1).optional(),
      stems: z.record(z.string(), z.number().int()).optional(),
      shifters: z.record(z.string(), z.union([z.string().min(1), z.number().int()])).optional(),
    })
    .strict()
    .refine((t) => (t.steps !== undefined) !== (t.from !== undefined && t.to !== undefined), {
      message: "transpose needs exactly one of `steps` or a full `from`/`to` key pair",
    }),
]);

/**
 * A practice-bundle audio variant: one rendered mix with the named stems muted
 * (click + cues always play). `mute` lists keys of `sources.stems.files`; an
 * empty list is the full mix, every key is click-only. When `bundle.variants`
 * is present it REPLACES the default list (full, minus-<each stem>, click-only)
 * — see src/build/bundle-variants.ts.
 */
const BundleVariant = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "variant id must be a kebab-case slug"),
    label: z.string().min(1).optional(),
    mute: z.array(z.string().min(1)),
  })
  .strict();

const BundleSpec = z
  .object({
    variants: z.array(BundleVariant).optional(),
  })
  .strict();

/**
 * One link from a score to our sections: these score bars play during this
 * section. Without `occurrence` the link applies to every section with that
 * name; with it, only to that one (1 = first), overriding a name-wide link.
 * The range must be exactly the section's length, or fill it exactly with
 * `repeat`. Repeating is never inferred from lengths that happen to divide:
 * the author states it.
 */
const ScoreSectionLink = z
  .object({
    section: z.string().min(1),
    occurrence: z.number().int().positive().optional(),
    /** [first, last] score bars, 1-based and inclusive. */
    bars: z
      .tuple([z.number().int().positive(), z.number().int().positive()])
      .refine(([a, b]) => a <= b, { message: "bars must be [first, last] with first <= last" }),
    repeat: z.number().int().min(2).optional(),
  })
  .strict();

/**
 * A score file (Guitar Pro, MusicXML, alphaTex) and which of its bars play in
 * which of our sections. The mapping belongs to the file, not to a track:
 * every track in it shares the same bars, so it is written once here and each
 * chart picks a track. The file's own section markers are only a check;
 * `sections` is the authority.
 */
const ScoreSpecSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "score id must be a kebab-case slug"),
    /** Relative to the song folder. */
    file: z.string().min(1),
    sections: z.array(ScoreSectionLink),
  })
  .strict();

/**
 * A chart channel: one track of a score, shown alongside the song. `kind`
 * says how to draw it; `instrument` groups channels, so a display can ask for
 * "guitar" and get every guitar chart.
 */
const ChartSpecSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "chart id must be a kebab-case slug"),
    kind: z.enum(["tab", "staff", "drums"]),
    instrument: z.string().min(1),
    /** Id of an entry in `scores`. */
    score: z.string().min(1),
    /** 0-based track index within the score. */
    track: z.number().int().nonnegative(),
  })
  .strict();

/**
 * The song's chords: a `.lab` file of chord segments in source-recording
 * seconds (see src/charts/lab.ts), placed on the beat grid at build. A
 * transposed song must say which key the file is in: `source`, the
 * recording's key, as a chord detector run on the audio writes it (the build
 * transposes it), or `played`, already in the band's key.
 */
const ChordsSpec = z
  .object({
    /** Relative to the song folder. */
    file: z.string().min(1),
    key: z.enum(["source", "played"]).optional(),
  })
  .strict();

export type ScoreSpec = z.infer<typeof ScoreSpecSchema>;
export type ChordsSpec = z.infer<typeof ChordsSpec>;
export type ChartSpec = z.infer<typeof ChartSpecSchema>;

/** Channel ids the display provides itself; a chart can't use them. */
export const BUILT_IN_CHANNELS = ["sections", "lyrics", "chords"] as const;

/** 1 → "1st", 2 → "2nd", 11 → "11th": for naming a section occurrence. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * Cross-checks a manifest's scores and charts against its sections.
 * Everything that could be read two ways is an error here rather than a
 * guess: an unknown section, two links for the same occurrence, a range that
 * doesn't match its section's length without a `repeat` saying how to fill
 * it, or a chart naming a score that isn't there.
 */
function checkCharts(
  m: { sections: { name: string; bars: number }[]; scores?: ScoreSpec[]; charts?: ChartSpec[] },
  ctx: z.RefinementCtx,
): void {
  const counts = new Map<string, number>();
  for (const s of m.sections) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  const barsOf = (name: string, occurrence: number) => m.sections.filter((s) => s.name === name)[occurrence - 1].bars;

  const scoreIds = new Set<string>();
  m.scores?.forEach((score, si) => {
    const where = `scores[${si}] ("${score.id}")`;
    const issue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message: `${where}: ${message}`, path: ["scores", si, ...path] });

    if (scoreIds.has(score.id)) issue(`another score already uses the id "${score.id}"`, ["id"]);
    scoreIds.add(score.id);

    const seenLinks = new Set<string>();
    score.sections.forEach((link, li) => {
      const count = counts.get(link.section) ?? 0;
      if (count === 0) {
        issue(`no section named "${link.section}" (have: ${[...counts.keys()].join(", ")})`, ["sections", li, "section"]);
        return;
      }
      if (link.occurrence !== undefined && link.occurrence > count) {
        issue(`${link.section} has ${count} occurrence(s), so there is no ${ordinal(link.occurrence)}`, ["sections", li, "occurrence"]);
        return;
      }
      const key = `${link.section}#${link.occurrence ?? "*"}`;
      const label = link.occurrence ? `${link.section} (${ordinal(link.occurrence)})` : `${link.section} (every occurrence)`;
      if (seenLinks.has(key)) issue(`two links for ${label}`, ["sections", li]);
      seenLinks.add(key);

      // A name-wide link covers every occurrence that has no link of its own.
      const overridden = new Set(
        score.sections.filter((l) => l.section === link.section && l.occurrence).map((l) => l.occurrence),
      );
      const covered = link.occurrence
        ? [link.occurrence]
        : Array.from({ length: count }, (_, i) => i + 1).filter((o) => !overridden.has(o));
      const [first, last] = link.bars;
      const length = last - first + 1;
      for (const o of covered) {
        const want = barsOf(link.section, o);
        const name = `${link.section} (${ordinal(o)})`;
        if (link.repeat === undefined && length !== want) {
          issue(
            `${name} is ${want} bars but score bars ${first}–${last} are ${length}; ` +
              `if the range should repeat to fill the section, state a repeat`,
            ["sections", li, "bars"],
          );
        } else if (link.repeat !== undefined && length * link.repeat !== want) {
          issue(
            `${name} is ${want} bars but score bars ${first}–${last} × ${link.repeat} are ${length * link.repeat}`,
            ["sections", li, "repeat"],
          );
        }
      }
    });
  });

  const chartIds = new Set<string>();
  m.charts?.forEach((chart, ci) => {
    const where = `charts[${ci}] ("${chart.id}")`;
    const issue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message: `${where}: ${message}`, path: ["charts", ci, ...path] });

    if ((BUILT_IN_CHANNELS as readonly string[]).includes(chart.id)) {
      issue(`"${chart.id}" is a built-in channel name`, ["id"]);
    }
    if (chartIds.has(chart.id)) issue(`another chart already uses the id "${chart.id}"`, ["id"]);
    chartIds.add(chart.id);
    if (!scoreIds.has(chart.score)) {
      issue(`no score with the id "${chart.score}" (have: ${[...scoreIds].join(", ") || "none"})`, ["score"]);
    }
  });
}

export const SongManifestSchema = z
  .object({
    schema: z.literal("clickbait/song@1"),
    title: z.string().min(1),
    artist: z.string().optional(),
    key: z.string().optional(),
    bpm: z.number().positive(),
    timeSignature: TimeSignature,
    transpose: TransposeSpec.optional(),

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
      .object({ dir: z.string().min(1) })
      .strict()
      .optional(),

    /** Practice-bundle rendering (mix-minus variants). Absent → defaults. */
    bundle: BundleSpec.optional(),

    /** Score files and which of their bars play in which sections. See ScoreSpecSchema. */
    scores: z.array(ScoreSpecSchema).optional(),

    /** Chart channels, each one track of a score (tab, staff, drums). See ChartSpecSchema. */
    charts: z.array(ChartSpecSchema).optional(),

    /** Chord file for the `chords` channel. See ChordsSpec. */
    chords: ChordsSpec.optional(),
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
    checkCharts(m, ctx);
    if (m.chords && m.transpose !== undefined && !m.chords.key) {
      ctx.addIssue({
        code: "custom",
        message: "chords.key is needed on a transposed song: \"source\" if the chord file is in the recording's key, \"played\" if it is in the band's",
        path: ["chords", "key"],
      });
    }
    // Every bundle variant's mute keys must name stems the manifest has.
    const stemKeys = new Set(Object.keys(m.sources.stems?.files ?? {}));
    m.bundle?.variants?.forEach((v, vi) => {
      v.mute.forEach((k, ki) => {
        if (!stemKeys.has(k)) {
          ctx.addIssue({
            code: "custom",
            message: `bundle.variants[${vi}] ("${v.id}") mutes "${k}", which is not a stem (have: ${[...stemKeys].join(", ") || "none"})`,
            path: ["bundle", "variants", vi, "mute", ki],
          });
        }
      });
    });
  });

export type SongManifest = z.infer<typeof SongManifestSchema>;
export type BeatMap = z.infer<typeof BeatMap>;
/** The zod schema for a BeatMap (value), for validating an external sidecar. */
export const BeatMapSchema = BeatMap;
export type Clip = z.infer<typeof Clip>;

/**
 * Resolve a manifest `beatMap` field to an inline BeatMap: return it as-is when
 * inline, or read+validate the referenced `<source>.beatmap.json` (path relative
 * to the song `dir`). The sidecar holds a bare BeatMap array.
 */
export function resolveBeatMap(
  beatMap: BeatMap | { file: string },
  dir: string,
): BeatMap {
  if (Array.isArray(beatMap)) return beatMap;
  const raw = JSON.parse(readFileSync(resolvePath(dir, beatMap.file), "utf8"));
  return BeatMapSchema.parse(raw);
}

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
