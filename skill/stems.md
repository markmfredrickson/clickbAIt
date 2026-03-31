# Stems: Splitting, Analysis & Grid Fitting

## Stem splitting

When the user provides a full mix (MP3, WAV, etc.) and wants stems:

```bash
$CLICKBAIT_AUDIO split "<audio-file>" --output-dir "songs/<artist-slug>/stems" --model 6stem
```

**Always split into the song's project directory** (`songs/<artist-slug>/stems/`), not `/tmp` or any other location. The stems will be used as audio tracks in REAPER, so they need to live alongside the song file.

Models: `6stem` (default — vocals, drums, bass, guitar, piano, other), `4stem` (vocals, drums, bass, other), `finetune` (best quality 4-stem, slower). The model auto-downloads on first use (~84-333 MB, cached).

Output is JSON with stem file paths. Runs on GPU (Metal) by default, takes a few minutes per song.

## After splitting: parallel analysis

Once stems exist, run targeted analysis in parallel for better results:

1. **Vocals stem -> Whisper transcription** (much cleaner than full mix)
   ```bash
   $CLICKBAIT_AUDIO transcribe "<dir>/<song>_vocals.wav"
   ```

2. **Drums stem -> BPM/tempo detection** (cleanest rhythmic signal)
   ```bash
   $CLICKBAIT_AUDIO analyze "<dir>/<song>_drums.wav"
   ```

3. **Full mix -> BPM/tempo for comparison**
   ```bash
   $CLICKBAIT_AUDIO analyze "<original-file>"
   ```

Compare drum-stem BPM with full-mix BPM and online lookups. Agreement = high confidence. Divergence = flag to user.

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
$CLICKBAIT_AUDIO analyze "<path-to-stem>"
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

### Step S4: Incorporate into the song project

Once confirmed:
- Set section boundaries from beat positions
- If tempo warping detected, note recording BPM — user may want to unstretch
- Add `audio()` nodes for each stem:
  ```typescript
  audio("Guitars", "stems/guitars.mp3"),
  audio("Bass", "stems/bass.mp3", { soffs: 0.164 }),  // trim silence
  ```
- Place at correct beat offset if they don't start at beat 0
- Continue with normal Step 3/Step 4 flow to generate RPP

### Unstretch workflow

If grid fitting reveals variable tempo and user wants to flatten:

1. Run unstretch analyzer:
   ```bash
   $CLICKBAIT_AUDIO unstretch "<path-to-stem>"
   ```
2. Report: detected BPM, estimated recording BPM, tempo deviation map
3. Unstretching happens in REAPER (for now) — tell user the recording BPM and to use REAPER's stretch markers or time-stretch
