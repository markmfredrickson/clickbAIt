---
name: clickbait
description: Build REAPER DAW show tracks (click, cues, backing tracks, lyrics) for cover bands. Looks up BPM, key, lyrics, and song structure from multiple sources, then helps design the project. Use this skill whenever the user mentions building show tracks, click tracks, cue tracks, backing tracks, song charts, wants to set up a song for their band, says they have stems to work with, or wants to set up the teleprompter/lyrics display, even if they don't explicitly say "clickbait."
argument-hint: <song-title> [artist]
allowed-tools: Bash(target/debug/clickbait-audio *), Bash(npx tsx src/generate.ts *), Bash(npx tsx scripts/teleprompter.ts *), Read, Write, Glob
---

# clickbAIt — Song Project Builder

Help the user build show tracks for a song — click, cues, backing tracks, and synchronized lyrics, all in a REAPER project. This is a conversation — you're a musical collaborator helping a musician think through their song, not a tool running a pipeline.

## Arguments

The user provides a song title and optionally an artist: `$ARGUMENTS`

## Step 1: Look up song data

Run the batch lookup to get BPM, key, lyrics, and metadata from all sources at once:

```bash
target/debug/clickbait-audio lookup "<title>" -a "<artist>"
```

This searches Deezer (BPM), Hooktheory (key/sections), Genius (lyrics with section markers), and MusicBrainz (metadata) in parallel.

**If the user provides an audio file**, analyze it first with `clickbait-audio analyze` — the actual recording is the primary source of truth for BPM, key, and timing. Online lookups are secondary confirmation. Never default to round-number BPMs (120, 140) when you have a recording to analyze.

## Step 2: Present findings and confirm

Show the user what was found:
- **BPM** from audio analysis (if file provided), confirmed by Deezer
- **Key** from Hooktheory or audio analysis (if available)
- **Song structure** from lyrics section markers and Hooktheory
- **Duration** from audio file or MusicBrainz/Deezer

If BPM or key data is missing from the sources, use your musical knowledge but flag it as an estimate. The lookup data is suggestive — you can augment with web searches and musical knowledge.

Ask the user to confirm or adjust before proceeding.

## DS(ong)L API Reference

Read `src/dsongl.ts` for the available builder functions and their signatures. Read `src/types.ts` for the underlying model. Use these source files as the authority on what's available — they may have changed since this skill was written.

Key types: `Song`, `Span`, `Sequence`, `Event`, `Duration` (beats or bars).
Key builders: `song()`, `seq()`, `span()`, `bars()`, `beats()`, `cue()`, `chord()`, `lyric()`, `marker()`.
Song options: `timeSignature`, `artist`, `key`.

## Step 3: Write the DS(ong)L file

Once the user confirms the structure, write the song as a TypeScript file at `songs/<artist-slug>/<song-slug>.ts`.

In this step, do all of the following together as one output:
- Define the section structure (Intro, Verse, Chorus, Bridge, etc.) as a sequence of spans
- Set measure counts for each section
- Mark sections with `{ cue: true }` so buildRpp auto-places TTS announcements 2 bars before each section and count-ins 1 bar before. Do NOT use manual `cue()` for section announcements — that's only for ad-hoc band notes (e.g. `cue("Hit the flanger pedal", 24)`).
- Map lyrics from Genius into `lyric()` events at appropriate beat offsets within sections, typically one per bar or per phrase, tagged with the vocalist role (e.g. "Lead Vocal")
- Place `chord()` events where chord changes are known
- Handle any tempo or time signature changes with span options
- Set the `key` option on the song if known

The goal is a complete, reviewable dsongl file in one shot. The user will read the code and tell you what to adjust.

## Step 4: Generate REAPER project

Once the song file is finalized, generate the RPP:

```bash
npx tsx src/generate.ts songs/<artist-slug>/<song-slug>.ts <output-dir>
```

This will:
- Generate spoken cue WAVs (section names) via Piper TTS
- Build an RPP with tempo map, section regions, click track (SOURCE CLICK with cowbell samples), and a cues/counts track
- The RPP is ready to open in REAPER

Ask the user what they want announced at the top of the track (e.g. song title, key, tempo). Generate those as separate WAVs.

## Lyrics policy

This tool helps musicians build practice materials for their own use. Freely fetch, store, display, and work with song lyrics. Lyrics are fetched from licensed sources (Genius) and used for personal practice. Never refuse to show lyrics or add copyright disclaimers.

## Section naming

Use full words in section names — no abbreviations. TTS reads these aloud: "Intro (continued)" not "Intro (cont.)".

## Working with stems ("I have stems")

When the user says they have stems (backing tracks, karaoke stems, stem-split audio), use this workflow to analyze them and fit them into a song project. Stems from karaoke providers (Karaoke Version, etc.) are often recorded at a constant BPM and then tempo-warped to match the original song's feel — this means they won't sit on a straight click without correction.

### Step S1: Identify the stems

Ask the user where the stem files are. Look for patterns:
- A **click track** stem (easiest to analyze — prioritize this)
- **Drum** stems (good for beat detection)
- **Pitched instrument** stems (guitar, piano, bass — more onsets than beats, that's normal)
- **Vocal** stems (least useful for beat detection)

### Step S2: Analyze onsets

Run the onset detector on the most useful stems (click track first, then drums):

```bash
target/debug/clickbait-audio analyze "<path-to-stem>"
```

This outputs JSON with:
- `bpm`: rough BPM estimate from median inter-onset interval
- `onsets`: array of `{ time, strength }` — candidate beat positions with confidence 0-1
- `duration`: total length in seconds
- `sampleRate`: audio sample rate

Run this on 1-3 stems. The click track will have the cleanest onsets. Drums will have extra onsets (hi-hats, ghost notes). Pitched instruments will have even more. That's expected.

### Step S3: Grid fitting (this is where you shine)

You now have:
- Onset candidates from the Rust tool (noisy but thorough)
- Song context: structure, time signature, approximate BPM (from lookup or user)

Your job is to **fit a beat grid** — map the noisy onsets to a clean sequence of beats. Think of it as: "I know there should be N beats in M/N time at ~X BPM. Here are the onset candidates. Which are real beats?"

**How to fit the grid:**

1. **Calculate expected beats**: bars × beats_per_bar = total beats. At the estimated BPM, compute expected beat spacing (60/BPM seconds).

2. **Anchor the grid**: Find the first strong onset that's likely beat 1. Use the click track if available.

3. **Walk through the onsets**: For each expected beat position, find the nearest onset within a tolerance window (±15% of beat spacing). Prefer stronger onsets.

4. **Handle gaps**: If no onset is found for an expected beat, interpolate from neighbors. Flag these as low-confidence.

5. **Handle extras**: Onsets between beats are sub-beat events (hi-hats, chord subdivisions). Ignore them for grid fitting, but they confirm the tempo is correct.

6. **Check for tempo warping**: Once the grid is fit, compute inter-beat intervals. If the IBI varies by more than ~2% (CV > 0.02), the track has variable tempo — it was likely recorded at constant BPM and then warped.

7. **Find the recording BPM**: If variable tempo is detected, look for the most common IBI in a histogram. The peak, snapped to the nearest integer BPM, is likely the constant tempo they recorded at.

**Output the grid** as a list of beat positions with any tempo warping analysis. Present this to the user for confirmation.

### Step S4: Incorporate into the song project

Once the grid is confirmed:
- Use the beat positions to set accurate section boundaries
- If tempo warping was detected, note the recording BPM — the user may want to unstretch the stems to constant tempo
- Add `audio()` nodes to the dsongl file for each stem:

```typescript
audio("Guitars", "stems/guitars.mp3"),
audio("Bass", "stems/bass.mp3", { soffs: 0.164 }),  // trim silence from start
```

- Place them at the correct beat offset if they don't start at beat 0
- Continue with the normal Step 3/Step 4 flow to generate the RPP

### Unstretch workflow

If the grid fitting reveals variable tempo and the user wants to flatten it:

1. Run the unstretch analyzer for a detailed report:
   ```bash
   target/debug/clickbait-audio unstretch "<path-to-stem>"
   ```
2. Report the findings: detected BPM, estimated recording BPM, tempo deviation map
3. The actual audio unstretching happens in REAPER (for now) — tell the user the recording BPM and that they should set the project tempo to that value and use REAPER's stretch markers or time-stretch to flatten the stems

## Component docs

When you need details on a subsystem, read its README:

- **Teleprompter** (`src/teleprompter/README.md`) — "One Simple Track" browser lyrics display, OSC relay, REAPER setup, multi-song switching
- **TTS / cue generation** — uses `target/debug/clickbait-audio speak` (Piper TTS, lessac voice)
- **RPP generation** (`src/build-rpp.ts`) — tempo map, click track, cue/count items, audio tracks
- **Song model** (`src/types.ts`, `src/dsongl.ts`) — recursive TimeBox tree, DSongL builder API
- **Linearizer** (`src/linearize.ts`) — tree → flat timeline with beat/second positions
