# TODO

## Downbeat detection (CRITICAL — blocks end-to-end auto-gen)

The DBN beat tracker we have finds the beat *pulse* but does not know which
beat is the drummer's "one." Every heuristic attempt (drum-stem first strong
onset, floor-to-bar-boundary, bass-first, etc.) fails on at least one of the
four test songs because the signals that mark a downbeat vary by song:

- Like a Stone: first drum hit = bar 1 ✓ with drum heuristic
- My Favorite Mistake: pickup line before bar 1 → drum heuristic snaps wrong
- Seven Nation Army: bass riff = bar 1, drums come in on bar 5 → drum heuristic trims too aggressively
- Save Me: half-time / triplet feel, no clear drum downbeat → every heuristic off by fractions of a beat

**This is a DSP/ML problem, not an LLM problem.** An LLM cannot reliably
identify downbeats from audio; the input signal doesn't contain the
information at the level the LLM reasons about. We need either:

1. **DBNDownBeatTracker port.** madmom's downbeat tracker (BSD-2) does joint
   beat + downbeat tracking with a larger state space (tempo × bar-position).
   Port to Rust alongside our current DBN beat tracker. Gets us ~90% of
   standard 4/4 pop/rock.
2. **Time-sig-aware tracker.** Extends (1) to handle meter changes and odd
   phrase lengths (Dirty Work, Dani California). Substantially harder.
3. **KV-trained model.** Ultimate solution — see below.

Until we have this, the generator requires a per-song manual bar-1 override
(a single REAPER/source time). That's the operational answer for now but it
breaks the "10 songs in 30 minutes unattended" goal.

## Train custom models on Karaoke Version (KV) data

KV provides stems *plus* hand-authored section timings and word-level lyric
timings across thousands of songs. That's exactly the supervised target we
want: given full-mix audio, output `(sections[], lyrics_with_timings[])` in
one shot. Today we bolt together wav2vec2 CTC (for word timing) + Genius
sections + heuristics (for the structure Genius misses); a KV-trained model
would collapse the pipeline, eliminate Genius as a dependency, and catch
things Genius never marks (Intros, Pre/Post-Chorus, Ramps, Solos, Breaks,
Outros).

Pilot: fine-tune wav2vec2-large on KV audio + word timings, eval vs current
`align` on held-out songs. Section detector: second head on the same backbone,
or a separate novelty/chroma classifier trained on KV section marks.

Until this lands, `scripts/build-dsongl.mjs` uses gap-based heuristics for
intro/pre-chorus/post-chorus/outro detection and asks the user to confirm or
split further.

## Syllable-level alignment (karaoke)

CTC forced alignment already emits character-level frame timings — grouping
to syllables is mechanical. Needed for true karaoke highlighting. Separate
from line/word timing, which is already solid enough for show-track use.

## Improve Whisper timing accuracy

### Silence-chunked transcription

Whisper's padding artifact (first word after silence gets startMs=0) and VAD
smearing across instrumental gaps (e.g. "Last dance with Mary Jane" smeared
across 7s of silence between verse and chorus) are the two biggest sources of
timing error we hit on Mary Jane's Last Dance.

Fix: run silence detection on the vocal stem, split into chunks of contiguous
vocal activity, transcribe each chunk independently, reassemble with offsets.

No ffmpeg crate currently — `crates/audio/` uses `symphonia` + `rubato` +
`hound`. Silence detection is a few lines of RMS-in-windows over symphonia's
decoded PCM; no need to add an ffmpeg dep just for this. Surface as
`clickbait-audio transcribe --split-silence` so the `.words.json` sidecar stays
drop-in compatible.

**Apply the same chunking to `align` (built since this was written).** The
forced aligner (wav2vec2 CTC, `align.rs`) has the identical failure: it must
place the whole transcript across the whole audio, so it smears words over
audio they aren't in. Aligning each silence-bounded phrase clip independently
(then offsetting) prevents it. Two concrete regression cases to build against:

- **Saints — dropped + smeared choruses.** Full-text align over the 158s mix
  stretched single words across the trombone solo (e.g. "Blow it Brother Holmes"
  ~5.8 s/word over a ~23s gap). Per-clip align should keep each phrase inside
  its own clip.
- **Seven Nation Army — trailing-word late start.** The final "home" of "go
  back home" is sung ~209s (right after "back"@209.04s) but CTC tags it at
  **225.34s — 16s late**, because it's the last word before a long outro and the
  Viterbi path lingers on blank, then commits late. Expected after chunking:
  "home" lands inside the final vocal phrase, not 16s into the outro. Onset-snap
  to vocal-stem energy is the finer follow-on; a cheap interim is clamping a
  trailing word's start when the pre-gap is implausibly large.

Display-side mitigation (independent of the above): highlight each word from its
start to the NEXT word's start, not its own `endMs` — CTC word ends are
unreliable. Does not fix a wrong *start* like the SNA "home" case.

### Forced alignment (larger win)

For songs where we already have published lyrics (Genius), the problem is
"align this known text to this audio" — much easier than Whisper's "figure out
what was said AND when." A forced aligner (wav2vec2 CTC + DTW, or Montreal
Forced Aligner) gives ~50ms word-level accuracy against known text.

Investigate: rust wav2vec2 bindings, or a small Python helper (maintainer-only,
not user-facing), or shell out to MFA. Evaluate accuracy vs. silence-chunked
Whisper on a few songs before committing to one path.

Either approach writes the same `.words.json` sidecar shape so the rest of the
pipeline is unchanged.

## Teleprompter: visual count-in cues

A lyrics display that brings the singer in, mirroring the spoken count-in cues
the RPP already generates (the "1, 2, 3, 4" WAVs one bar before a cued section).
Before each `cue: true` section, show a greyed count — e.g. "1 2 3 4" — that
highlights beat-by-beat leading into the section's first word, so the singer
knows exactly when to come in. Same idea could show the upcoming section label
("Chorus") greyed ahead of time.

Data: reuse the cue/count events the build ALREADY generates — don't re-derive.
`build-rpp.ts` computes the count-in beats (the count WAVs one bar before each
cued section) and the spoken section announcement two bars before; these
already respect the actual meter (odd bars, etc.), so no "assume 4" guesswork.
Surface those same events (beat + label, e.g. "1".."4" and "Chorus") into the
built artifact (LyricsDisplay or a sibling cues block), and the teleprompter
renders the visual count-in straight off them — the screen and the spoken cue
fire from one source of truth. No need to add `timeSignature` for this.

## Catalog migration: flagged song issues (2026-07-01)

Found while migrating the .ts catalog to manifests via `src/ts-to-manifest.ts`.
None block the songs that work (white-stripes, sheryl-crow); these are the
stragglers.

### Converter bug: fractional bars for time-signature-override sections
`ts-to-manifest.ts` computes a section's `bars` against the SONG's meter, not
the section's own. A 2/4 "Pickup" (`beats(2)`, `timeSignature:[2,4]`) becomes
`bars: 0.5` — which `manifestToSong` then reads as 0.5 bars of 2/4 = **1 beat**,
not the intended 1 bar / 2 beats. Meanwhile the converter's cumulative `b`
advances by the right 2 beats, so the manifest is internally inconsistent: the
RPP (via linearize) and the lyrics (via section `b`) drift 1 beat per pickup.
Fix: in `barsOf`/cursor, use `span.timeSignature?.[0] ?? songBeatsPerBar`.
Affects crowded-house (2 pickups). Re-convert after fixing.

### Converter: nested spans are dropped
The converter reads only top-level spans as sections and their `event` children
(lyrics/cues). It ignores nested *spans*. aimee-mann/save-me nests a 2/4
"Pickup" span (with `one`/`two` count cues) inside "Instrumental Break" — the
whole 2/4 bar and its counts vanish on conversion. Fix: flatten a nested span
into its own top-level manifest section, carrying its `timeSignature` and cues,
with correct beat accounting. (The manifest schema is flat — no sub-sections —
so flattening is the model, not nesting.)

### Alignment: duplicate/repeated lines mis-place words (needs windowed align)
aimee-mann chorus is the concrete case. A single global wav2vec2 CTC pass over a
song with repeated choruses + instrumental gaps spreads words across the gaps:
"'cause I can" pulled ~13 beats early (onto the prior chorus tail), "tell"
stranded at the true verse start (11-beat gap). Slicing is fine (right word
counts per line); the ALIGNMENT is wrong. Fix = windowed / silence-based
alignment (see the align-chunking section above), aligning each section/phrase
against only its own audio so repeats + gaps can't cross-contaminate.
Concern to honor: don't hard-cut at section boundaries — pickups sit before the
downbeat and phrases ring over. Prefer splitting at vocal SILENCES (never
bisects a sung phrase) and/or padded overlapping windows; section membership is
already explicit in the manifest, so ownership is safe under overlap.

### Crowded House: live-recording audio vs studio lyrics
The source recording is a LIVE version (chosen to match the band's live ending),
but `dont-dream-its-over.lyrics.txt` is the studio lyrics. Alignment mismatches,
especially at the ending. Fix: transcribe/edit the lyrics to match the live
performance before aligning. Also has 2/4 pickups (see converter bug above).
