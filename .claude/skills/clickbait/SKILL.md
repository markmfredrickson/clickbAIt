---
name: clickbait
description: Build REAPER DAW show tracks (click, cues, backing tracks, lyrics) for cover bands. Looks up BPM, key, lyrics, and song structure from multiple sources, then helps design the project. Use this skill whenever the user mentions building show tracks, click tracks, cue tracks, backing tracks, song charts, wants to set up a song for their band, says they have stems to work with, or wants to set up the teleprompter/lyrics display, even if they don't explicitly say "clickbait."
argument-hint: <song-title> [artist]
allowed-tools: Bash(target/release/clickbait-audio *), Bash(target/debug/clickbait-audio *), Bash(npx tsx src/generate.ts *), Bash(npx tsx scripts/teleprompter.ts *), Read, Write, Glob
---

# clickbAIt — Song Project Builder

Help the user build show tracks for a song — click, cues, backing tracks, and synchronized lyrics, all in a REAPER project. This is a conversation — you're a musical collaborator helping a musician think through their song, not a tool running a pipeline.

## Binary resolution

At the start of a session, resolve the binary path once:
```bash
CLICKBAIT_AUDIO="$([ -x target/release/clickbait-audio ] && echo target/release/clickbait-audio || echo target/debug/clickbait-audio)"
```
Use `$CLICKBAIT_AUDIO` for all subsequent commands. Prefer release for performance (especially stem splitting). If neither exists, tell the user to run `cargo build --release -p clickbait-audio`.

## Arguments

The user provides a song title and optionally an artist: `$ARGUMENTS`

## Step 1: Look up song data

Run the batch lookup to get BPM, key, lyrics, and metadata from all sources at once:

```bash
target/release/clickbait-audio lookup "<title>" -a "<artist>"
```

This searches Deezer (BPM), Hooktheory (key/sections), Genius (lyrics with section markers), and MusicBrainz (metadata) in parallel.

**If the user provides an audio file**, analyze it with `clickbait-audio analyze` and cross-reference with online lookups. The analyzer's BPM estimate can be wildly wrong for noisy or old recordings (it may return double/quadruple time). Use musical judgment: compare the analysis BPM against the lookup BPM, try halving/quartering if the analysis number is unreasonably high, and pick the tempo that makes musical sense for the genre. Never default to round-number BPMs (120, 140) — use the best available data.

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

**Intro rules (inviolate):**
- Every song MUST start with an Intro span of at least 4 bars. This is where the title TTS cue and count-in go. No audio, no lyrics, no backing tracks in the Intro — just the slug region and click.
- Do NOT put `cue: true` on the Intro — there's nothing before it to announce.
- Audio/backing tracks go inside the FIRST section after the Intro (e.g., inside the Verse span), never as top-level siblings of `seq()` and never in the Intro.
- buildRpp auto-places: title cue at beat 0, section cue 2 bars before each `cue: true` section, count-in 1 bar before. With a 4-bar intro these never overlap.

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

## Stems

When the user has audio to split, has pre-existing stems, or mentions backing tracks, read `.claude/skills/clickbait/stems.md` for the full workflow. Key capabilities:

- **Split a full mix** into 6 stems (vocals, drums, bass, guitar, piano, other) via Demucs
- **Parallel analysis**: vocals stem for Whisper transcription, drums stem for BPM, full mix for comparison
- **Grid fitting**: map noisy onsets to a clean beat grid using musical context
- **Unstretch**: detect and correct tempo warping from KV-style stems

## Component docs

When you need details on a subsystem, read its doc:

- **Stems** (`.claude/skills/clickbait/stems.md`) — splitting, parallel analysis, grid fitting, unstretch
- **Teleprompter** (`src/teleprompter/README.md`) — browser lyrics display, OSC relay, REAPER setup
- **TTS / cue generation** — `$CLICKBAIT_AUDIO speak` (Piper TTS, lessac voice)
- **RPP generation** (`src/build-rpp.ts`) — tempo map, click track, cue/count items, audio tracks
- **Song model** (`src/types.ts`, `src/dsongl.ts`) — recursive TimeBox tree, DSongL builder API
- **Linearizer** (`src/linearize.ts`) — tree → flat timeline with beat/second positions
