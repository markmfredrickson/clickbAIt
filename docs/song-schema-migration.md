# Song schema migration: ms-perfect lyrics

Design notes from conversation 2026-04-26. Not yet implemented.

## Goal

Millisecond-perfect lyric sync. Retire the `.ts` per-song authoring format in
favor of an inert JSON manifest that explicitly references the artifacts
produced by `clickbait-audio`.

## Conceptual model

Borrowed from the `every_musician_drifts` project: a song is a strictly
monotonic curve in `(time, beat)` space. **Time and beat are co-equal axes**,
not derived from each other. The curve is the map between them.

- Today's "tempo map" is a degenerate version of this — piecewise-constant BPM,
  with seconds *computed* from beats. That asymmetry is what we're killing.
- Events (lyrics, cues, section boundaries) are points. Each may be authored in
  whichever coordinate is natural; the curve resolves the missing one.

**Neither axis is canonical.** This is settled, not an open question. Beat is
not "the truth" with time derived, nor the reverse. A built event always
carries both `(t, b)`, and both are first-class everywhere downstream
(teleprompter, REAPER projection, cues). The curve is the single bidirectional
map: `t → b` and `b → t` must round-trip within ε for any point on it.

Do not read decision #8 ("align is the *primary source of ms-perfect lyric
timing*") as "ms beats beats." That is the narrower claim that a sung word's
`t` comes from *measured audio* rather than from `b × tempo` guesswork — it
decides which **input populates** a lyric's timing, not which **axis is
fundamental**. The output still has both coordinates resolved.

## Decisions

1. **Linear interpolation between curve anchors.** No splines until evidence
   demands them.
2. **One curve per source.** A "source" is a recording, a stem-split group
   sharing a parent recording's curve, or eventually sheet music. Stems
   inherit a parent recording's curve by reference.
3. **Common case has two curves**: the recording's curve (the inline
   `beatMap`, see below) for stretch-marker generation, and the song's intended
   curve (`constantBpm` once stretched). Lyrics resolve against the song
   curve.

   **Recording curve = the clip's `beatMap`** (REVISED 2026-07-06, was
   "`.beats.json` + a single `anchor`"). The recording source carries an inline,
   authored beat-map: `source-time ↔ song-beat` control points, spelled as
   `{beat, t}` pins or `{startBeat, stride?, times[]}` runs (see
   `src/beat-map.ts`). The curve runs piecewise-linear through the points and
   extrapolates at the song BPM past the outermost pin. Point *density* is the
   only knob: pin every beat (a stride-1 run) and the curve follows the
   recording's micro-timing (detection just seeds this); leave a gap and those
   beats interpolate linearly — a deliberate stretch, e.g. a rubato intro
   compressed into fewer bars (Zombie: `{beat:0,t:1.07}` then a run from
   `startBeat:12` compresses 1.07→11.0s across 3 bars ≈ 16% faster); pin every
   Nth beat (a strided run) and the in-between beats float. This one structure
   absorbs the old `anchor`, `smStride`, `smLeadSource`, and hand-tuned intros.
   The map is inline (durable in the manifest) rather than a `.beats.json`
   reference; the detector's raw output is a regenerable cache.
4. **JSON + schema, no TS execution.** Inert data, validated (likely zod).
5. **No structural reuse.** Loops are unrolled in the source. Practice
   looping is a playback-time concern (REAPER region loop + count-in audio),
   not a schema concern. Static absolute lyric positions survive looping.
6. **Sections carry their lyric lines** (REVISED 2026-07-01, was "labels, flat
   list"). A section is an ordered entry with a length in `bars` and nests the
   lyric lines that belong to it, in sung order. Its start beat is NOT authored
   — sections run back-to-back from measure 1 beat 1, so each one's start is
   inferred from the lengths of the sections before it (see `sectionStarts` in
   `manifest.ts`). Carrying an absolute start alongside the length would be
   redundant and could silently disagree with the running total (REVISED
   2026-07-03, was "has a start beat *and* nests…").
   This makes section membership explicit so a pickup —
   sung a beat or two before the section downbeat — groups under its section
   instead of being guessed into the previous one from its measured beat.
   Timing is still measured (alignment), not authored; only the grouping is
   authored. The flat lyric text fed to the aligner is the sections' lines in
   order (an intermediate), so nothing drifts.
7. **`song.json` is a manifest** that explicitly references `clickbait-audio`
   outputs (`*.beats.json`, `*.analysis.json`, `*.align.json`, stems, cues).
   Each artifact carries a `produced-by` annotation for provenance.
8. **`clickbait-audio align` becomes the primary source of ms-perfect lyric
   timing.** Author text, run align, build merges alignment-derived `t` into
   the canonical lyric list. Fall back to `b` × curve when alignment is
   missing.
9. **Constants/macros** are authoring sugar at most — not runtime reuse. Add
   only if duplication actually hurts.
10. **No curve editor in clickbAIt for now.** REAPER is the UI; user + Claude
    edit conversationally.

## Schema sketch

```json
{
  "schema": "clickbait/song@1",
  "title": "Pink Pony Club",
  "artist": "Chappell Roan",
  "bpm": 107.1429,
  "timeSignature": [4, 4],

  "metadata":  { "file": "pink-pony-club.lookup.json",  "produced-by": "clickbait-audio lookup" },

  "sources": {
    "recording": {
      "kind": "audio",
      "file":     "source.m4a",
      "analysis": { "file": "source.analysis.json", "produced-by": "clickbait-audio analyze" },
      "beatMap": [
        { "beat": 0, "t": 1.07 },
        { "startBeat": 12, "times": [11.0, 11.73, 12.49, "…detected beats to end…"] }
      ]
    },
    "stems": {
      "kind": "audio-group",
      "curveRef": "recording",
      "produced-by": "clickbait-audio split --model htdemucs",
      "dir": "stems/htdemucs/source/",
      "files": {
        "vocals": "vocals.wav",
        "drums":  "drums.wav",
        "bass":   "bass.wav",
        "other":  "other.wav"
      }
    }
  },

  "songCurve": "constantBpm",

  "sections": [
    { "name": "Verse 1", "bars": 8, "cue": true },
    { "name": "Refrain", "bars": 8, "cue": true }
  ],

  "lyrics": {
    "text":      { "file": "pink-pony-club.lyrics.txt",  "produced-by": "human" },
    "alignment": { "file": "pink-pony-club.align.json",  "produced-by": "clickbait-audio align" },
    "lines": [
      { "b": 0,  "text": "I know you wanted me to stay" },
      { "b": 7,  "text": "But I can't ignore the crazy visions of me in L.A." }
    ]
  },

  "cues": {
    "dir": "cues/",
    "produced-by": "clickbait-audio speak"
  }
}
```

A lyric line may carry `{b}`, `{t}`, or both. Both → consistency check at
build (error if disagreement exceeds ε). Build emits a canonical artifact
with both coordinates populated for every event.

## What retires

- `.ts` per-song authoring (`pink-pony-club.ts` etc.)
- `src/dsongl/` DSL (`song()`, `seq()`, `span()`, `lyric()`, `bars()`, `beats()`)
- `preRollSeconds` field — replaced by an explicit recording-curve anchor

## What stays

- `src/tempo.ts` — `beatToSeconds`/`secondsToBeat` generalize to curve lookup
- `src/build-rpp.ts` — REAPER tempo envelope is now a *projection* of the
  song curve, not the source of truth
- `src/stretch-markers.ts` — same math, now framed as aligning recording
  curve → song curve
- `src/teleprompter/` — consumes the canonical built JSON; OSC seconds
  resolved through curve instead of tempo map
- `clickbait-audio` binary — no changes required; outputs already match
  what the manifest references

## Open before implementation

- **Lyrics-from-alignment authority**: is alignment the primary timing
  source (with `b` as fallback) or the override (with `b` as primary)?
  Need to inspect what `clickbait-audio align` emits to decide.
- **File extensions**: `<slug>.song.json` for source vs `<slug>.json` for
  built artifact. Avoid name collision with existing built JSON.
- **Anchor density in canonical curves**: store every detected beat (~500
  per song) or downsample? Self-contained vs file-ref to `.beats.json`.

## Migration steps (rough)

1. Pin `align.json` schema; decide its role as timing source.
2. Write zod schema for the manifest.
3. Write a one-shot converter: `.ts` source → `.song.json`, folding in
   existing `preRollSeconds` as a curve anchor.
4. Update `exportSongPayload`-equivalent to consume manifest, build
   canonical JSON with absolute `(t, b)` per event.
5. Generalize `tempo.ts` to a curve resolver.
6. Update teleprompter to use curve-based seconds → beat conversion.
7. Convert existing songs, diff teleprompter output before/after as sanity
   check.
8. Delete `src/dsongl/` and `.ts` song sources.
