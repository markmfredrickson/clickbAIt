# Stems: Splitting, Analysis & Grid Fitting

## Stem splitting

When the user provides a full mix (MP3, WAV, etc.) and wants stems:

```bash
.claude/skills/clickbait/bin/clickbait-audio split "<audio-file>" --output-dir "songs/<artist-slug>/<song-slug>/stems" --model 4stem
```

**Always split into the song's project directory** (`songs/<artist-slug>/<song-slug>/stems/`), not `/tmp` or any other location. The stems will be used as audio tracks in REAPER, so they need to live alongside the manifest.

Models: `4stem` (default — vocals, drums, bass, other), `6stem` (vocals, drums, bass, guitar, piano, other — use when piano/guitar separation is needed), `finetune` (best quality 4-stem, slower). The model auto-downloads on first use (~84-333 MB, cached).

Output is JSON with stem file paths. Runs on GPU (Metal) by default, takes a few minutes per song.

## After splitting: beats + alignment

The main skill's Step 2 (analyze) covers this; the short version:

1. **Beats — two passes, then unify.** Full mix with `--activation spectral-flux` (carries a pulse through drum-silent passages) and the drum stem with `--activation energy` (tight where drums play), merged with `npm run beats:unify`. The unified `<song>.beats.json` becomes the manifest's `beatMap` (source-second per beat), which drives every stem's stretch markers.

2. **Vocals stem -> forced alignment** (when Genius lyrics are available — the normal case):
   ```bash
   .claude/skills/clickbait/bin/clickbait-audio align "<dir>/<song>_vocals.wav" --text "<lyrics.txt>"
   ```
   Writes `<song>_vocals.align.json` with word + character timings. Uses wav2vec2 CTC — cannot hallucinate, handles long instrumental passages cleanly. Falls back to Whisper `transcribe` only if no lyrics can be fetched.

Compare the detected BPM (both passes) with online lookups. Agreement = high confidence. Divergence = flag to the user and trust the detected value.

There is no separate "pre-roll silence" field: silence before the first note is naturally encoded in the `beatMap` times (beat 0's source second is wherever the downbeat is), and stems trim it via `soffs`. `preRollBars` is a musical count-in, not a silence trim. The `analyze` command still exists for a rough onset/BPM cross-check, but the two-pass beats detection is the source of the grid.

## Phase: is the click on the right hits?

"Phase" in the QC output is a music problem wearing a math word. The beat
tracker has two separate jobs: find the spacing of the beats (the tempo), and
decide **which hits are the beats**. Phase is the second job. A grid with
perfect spacing can still be wrong the way a listener clapping on the wrong
half of the groove is wrong — every clap lands on a real hit, and every clap
is wrong.

What a phase error sounds and looks like:

- **Half a beat off (the common one).** The click sits on the "ands" — the
  off-beat eighths — instead of the beats. In REAPER the drums sound behind
  (or ahead of) the click by the same amount everywhere, and in busy sections
  the stretch markers still touch waveforms (there's a hat on every eighth),
  so it *looks* aligned while feeling wrong. In sparse sections the markers
  sit on air. Trust the feel and the sparse sections.
- **A mid-song slip.** The tracker can also *change* its answer at a fill or
  a section change: it can't skip a beat, so it "pays" for the switch by
  faking a short tempo surge — a run of stretch markers around 0.9x/1.1x is
  the fingerprint (the build refuses to proceed past ~8%). Before the slip
  the click is right; after it, everything is half a beat off.

Why detection gets this wrong: the tracker follows energy, and a drummer's
"1" is often the *quiet* option — kick + closed hat — while the snare and
open-hat accents (and a bass player pushing ahead of the beat, bleeding into
the drum stem) put more energy on the 2s, 4s, and "ands". The machine picks
the loud lattice; the musician counts the quiet one.

What to do about it:

- **The ear is the referee.** No onset statistic can settle which eighth is
  "1" in a straight-eighths song — both candidates sit on real hits. When the
  build prints the phase-ambiguity warning, play the click against the song
  and check that beat 1 of the click lands with the kick.
- **Fix phase by nudging, not re-detecting.** A wrong-but-consistent grid is
  one flip away from right. For 16th-heavy or syncopated drum parts, detect
  at **double the BPM window** so the tracker follows the eighth grid (dense
  evidence — it can't slip), then fold down and pick the side:
  ```bash
  clickbait-audio beats stems/source_drums.wav --min-bpm 190 --max-bpm 225 --start <drum entry> > detected.beats.json
  npx tsx src/authoring/fold-beats-cli.ts detected.beats.json --phase 1 > folded.beats.json
  ```
  `--phase 0|1` chooses which alternate eighths are the beats. If the click
  comes out on the "ands", flip the phase and rebuild — that's the whole fix.
- A mid-song slip means the quarter-note tracker guessed twice; the
  double-tempo detect + fold above makes the slip impossible rather than
  patching it.

## Working with pre-existing stems

When the user already has stems (from Karaoke Version, etc.), they may be tempo-warped. KV stems are often recorded at constant BPM then warped to match the original feel.

### Step S1: Identify the stems

If the user has pre-split stems, ask where they are. If they have a full mix, offer to split first.

Look for:
- **Click track** stem (easiest to analyze — prioritize)
- **Drum** stems (good for beat detection)
- **Pitched instrument** stems (guitar, piano, bass — more onsets than beats, that's normal)
- **Vocal** stems (best for lyrics transcription, least useful for beat detection)

### Step S2: Analyze onsets

Run the onset detector on the most useful stems (click first, then drums):

```bash
.claude/skills/clickbait/bin/clickbait-audio analyze "<path-to-stem>"
```

Output JSON: `bpm` (rough estimate), `onsets` (array of `{ time, strength }`), `duration`, `sampleRate`.

Run on 1-3 stems. Click track has cleanest onsets. Drums have extras (hi-hats, ghost notes). Pitched instruments have even more. That's expected.

### Step S3: Grid fitting

You have onset candidates (noisy but thorough) and song context (structure, time signature, approximate BPM from lookup/user). Your job: fit a beat grid.

1. **Calculate expected beats**: bars x beats_per_bar. At estimated BPM, compute expected beat spacing (60/BPM seconds).
2. **Anchor the grid**: Find first strong onset likely to be beat 1. Use click track if available.
3. **Walk through onsets**: For each expected beat, find nearest onset within +/-15% of beat spacing. Prefer stronger onsets.
4. **Handle gaps**: No onset for an expected beat? Interpolate from neighbors. Flag as low-confidence.
5. **Handle extras**: Onsets between beats are sub-beat events. Ignore for grid fitting, but they confirm tempo is correct.
6. **Check for tempo warping**: Compute inter-beat intervals. IBI variance > ~2% (CV > 0.02) = variable tempo, likely recorded at constant BPM then warped.
7. **Find recording BPM**: If variable tempo detected, histogram the IBIs. Peak snapped to nearest integer BPM = likely recording tempo.

Present the grid and any tempo warping analysis to the user for confirmation.

### Step S4: Incorporate into the manifest

Once confirmed:
- Fold the confirmed beat grid into the manifest's `beatMap` (via `init-manifest`, or by hand).
- If tempo warping detected, note the recording BPM — the user may want to unstretch.
- Wire the stems into `sources.stems`:
  ```json
  "stems": {
    "kind": "audio-group",
    "curveRef": "recording",
    "dir": "stems/",
    "files": { "vocals": "source_vocals.wav", "drums": "source_drums.wav", "bass": "source_bass.wav", "other": "source_other.wav" },
    "soffs": 0.164
  }
  ```
  `soffs` trims silence off the start of every stem; `sourceEnd` caps the end. Individual timing lives in the shared `beatMap`, not per-stem offsets.
- Continue with the normal Step 4/Step 5 flow to author the manifest and generate the RPP.

### Unstretch workflow

If grid fitting reveals variable tempo and user wants to flatten:

1. Run unstretch analyzer:
   ```bash
   .claude/skills/clickbait/bin/clickbait-audio unstretch "<path-to-stem>"
   ```
2. Report: detected BPM, estimated recording BPM, tempo deviation map
3. Unstretching happens in REAPER (for now) — tell user the recording BPM and to use REAPER's stretch markers or time-stretch
