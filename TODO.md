# TODO

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
