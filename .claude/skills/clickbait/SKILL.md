---
name: clickbait
description: Build REAPER DAW show tracks (click, cues, backing tracks, lyrics) for cover bands. Looks up BPM, key, lyrics, and song structure from multiple sources, then helps design the project. Use this skill whenever the user mentions building show tracks, click tracks, cue tracks, backing tracks, song charts, wants to set up a song for their band, says they have stems to work with, or wants to set up the teleprompter/lyrics display, even if they don't explicitly say "clickbait."
argument-hint: <song-title> [artist]
allowed-tools: Bash(.claude/skills/clickbait/bin/clickbait-audio *), Bash(mkdir *), Read, Write, Glob
---

# clickbAIt — Song Project Builder

Help the user build show tracks for a song — click, cues, backing tracks, and synchronized lyrics, all in a REAPER project. This is a conversation — you're a musical collaborator helping a musician think through their song, not a tool running a pipeline.

**Working directory:** All paths are relative to your working directory (the directory where this Claude session was launched). Never construct absolute paths or prepend the session directory to relative paths.

**Reading data:** Use the `Read` tool to read JSON sidecars and song files directly — do not shell out to `cat` or `node -e` to parse them. You can reason about JSON content after reading it.

## Binary

The binary is always at `.claude/skills/clickbait/bin/clickbait-audio`. Use that path directly in all commands — no variable needed.

All commands write progress to stderr and JSON to stdout. Never redirect stderr (`2>&1`) — keep stdout clean for JSON output.

If the binary is missing, tell the user to run `setup.sh`.

## First run: check configuration

Check whether `.claude/skills/clickbait/bin/clickbait-audio` exists. If not, tell the user to run `setup.sh`.

Check whether `.env` exists and has a `GENIUS_API_TOKEN` set:
- If missing or empty, offer to help. It's free — instructions in `skill/setup.md`. Write or update `.env`:
  ```
  GENIUS_API_TOKEN=your-token-here
  ```
- If present, proceed silently.

If this looks like a first run (no `songs/` directory or it's empty), suggest running setup to download models:
```bash
.claude/skills/clickbait/bin/clickbait-audio setup
```
See `skill/setup.md` for details.

## Arguments

The user provides a song title and optionally an artist: `$ARGUMENTS`

## Step 1: Stems and audio analysis

**Check for stems or audio first, before any web lookups.**

If the user mentions stems, audio files, or backing tracks:
1. If they have a full mix (not yet split), split it into the song's project directory. The binary accepts WAV, MP3, and M4A — pass the file directly, no conversion needed:
   ```bash
   $CLICKBAIT_AUDIO split "<audio-file>" --output-dir "songs/<artist-slug>/stems" --model 6stem
   ```
   Stems live alongside the song file — they'll be referenced as audio tracks in REAPER.
2. Once stems exist, check for cached sidecars before running anything expensive:
   - `<drums-stem>.analysis.json` — cached BPM/onsets
   - `<vocals-stem>.words.json` — cached Whisper transcription

   If sidecars exist, use the `Read` tool to read them directly — the binary will also use them automatically. If missing, run:
   ```bash
   .claude/skills/clickbait/bin/clickbait-audio analyze "<drums-stem>"
   .claude/skills/clickbait/bin/clickbait-audio transcribe "<vocals-stem>"
   .claude/skills/clickbait/bin/clickbait-audio analyze "<original-file>"
   ```
   Each command writes its sidecar alongside the input file. Read sidecars with the `Read` tool and reason about the JSON content directly. Sidecars are human-editable — if Whisper got a lyric wrong or the BPM is off, edit the JSON and the next run will use your correction.

3. Record stem analysis results — they are the source of truth. Web data supplements, never overrides.

**If no audio is provided**, skip to Step 2 and use online sources only.

## Step 2: Look up song data

```bash
.claude/skills/clickbait/bin/clickbait-audio lookup "<title>" -a "<artist>" > "songs/<artist-slug>/<song-slug>.lookup.json"
```

This fetches from Deezer (BPM), Genius (lyrics with section markers), and MusicBrainz (metadata) in parallel. Saving to a sidecar lets you `Read` it directly and re-use it without re-fetching.

**When audio is available**, online data serves as a bumper — it cross-checks stem analysis but never overrides it:
- If Deezer BPM agrees with drum stem BPM → high confidence
- If they diverge → flag to user and trust the stem
- Genius lyrics are the truth on words; Whisper provides the timing. Merge them: align Genius phrases to Whisper word timestamps using fuzzy matching. Auto-correct obvious phonetic near-misses (Whisper: "I will sublime" → Genius: "I Will Survive" → use Genius, say nothing). Only ask the user when a match is genuinely ambiguous — a line Genius doesn't have, or a section where timing is too far off to align confidently.

  If the merge is clean enough to be useful, offer to write `songs/<artist-slug>/<song-slug>.lyrics.csv`:
  ```
  section,beat,text,tag
  Verse 1,0,"At first I was afraid",Lead Vocal
  Verse 1,4,"I was petrified",Lead Vocal
  ```
  - `section` — matches the span name in the DSongL file
  - `beat` — beat offset from the start of that section (derived from Whisper timestamps + BPM)
  - `text` — Genius-corrected lyric line
  - `tag` — vocalist role (default "Lead Vocal")

  If this file already exists, use it as-is — it's the human-edited version. Never overwrite it.

**When no audio is available**, online sources are primary: Deezer for BPM, Genius for lyrics and song structure markers.

## Step 3: Present findings and confirm

**Source-attribution rule (inviolate):** Every fact you present MUST be verbatim from a tool output, with the source named. Never claim a source confirms something unless the tool output literally contains that data. If a source returned nothing for a field, say "[source] returned no [field]." If you fill in a gap from your own musical knowledge, label it **"estimate"** — never dress it up as a confirmed finding.

Present findings in a table with a **Source** column so the user can verify each claim against the tool output:

| Field | Value | Source |
|---|---|---|
| **BPM** | 71.4 | drum stem DBN tracker (`beats` command) |
| **BPM cross-check** | 143.6 (÷2 = 71.8) | Deezer via `lookup` |
| **Key** | — | not returned by any source |
| **Key** | G minor | **estimate** (user/musical knowledge) |
| **Structure** | [Chorus], [Verse 2], [Chorus], [Bridge], [Chorus], [Outro] | Genius section markers via `lookup` |
| **Duration** | 4:34 | MusicBrainz via `lookup` |

Rules:
- If BPM or key data is missing from all sources, say so explicitly. Offer an estimate only if you have genuine musical knowledge, clearly labeled.
- Never default to round-number BPMs (120, 140) without evidence.
- When stem analysis and Deezer diverge, flag it and trust the stem.
- The user should be able to cross-check every row against the raw tool output. If they can't, you're doing it wrong.

Ask the user to confirm or adjust before proceeding.

## DS(ong)L API Reference

Import from `@clickbait/dsongl`. Types and builder signatures below are generated from the package source.

### Types

```typescript
export type Duration = { beats: number } | { bars: number };

export interface Event {
  kind: "event";
  offset?: number;  // beats relative to parent; default 0; can be negative
  type: "chord" | "lyric" | "cue" | "marker";
  value: string;
  tag?: string;     // grouping label — could map to a track, person, instrument, whatever
}

export interface Span {
  kind: "span";
  name?: string;
  offset?: number;            // beats relative to parent; default 0; can be negative
  bpm?: number;
  timeSignature?: [number, number];
  duration?: Duration;
  tag?: string;               // inherited by children unless overridden
  cue?: boolean;              // if true, buildRpp auto-places a TTS cue before this section
  children?: Node[];
}

export interface Sequence {
  kind: "sequence";
  name?: string;
  offset?: number;
  bpm?: number;
  timeSignature?: [number, number];
  duration?: Duration;
  tag?: string;
  children?: Node[];
}

export interface Song {
  kind: "song";
  title: string;
  artist?: string;
  key?: string;
  bpm: number;
  timeSignature: [number, number];
  children: Node[];
}

export interface Audio {
  kind: "audio";
  name: string;       // track name (e.g. "Guitars", "Bass")
  file: string;       // path to audio file
  offset?: number;    // beats relative to parent; default 0
  soffs?: number;     // source offset in seconds (trim from start of file)
}

export type Node = Event | Span | Sequence | Song | Audio;
```

### Builder functions

```typescript
export function bars(n: number): Duration ;
export function beats(n: number): Duration ;
export function cue(value: string, offset?: number, tag?: string): Event ;
export function chord(value: string, offset?: number, tag?: string): Event ;
export function lyric(value: string, offset?: number, tag?: string): Event ;
export function marker(value: string, offset?: number, tag?: string): Event ;
export function span(name: string, duration: Duration, children?: Node[]): Span;
export function span(name: string, duration: Duration, opts: SpanOptions, children?: Node[]): Span;
export function audio(name: string, file: string, opts?: AudioOptions): Audio ;
export function seq(...children: Node[]): Sequence ;
export function song(title: string, bpm: number, ...children: Node[]): Song;
```

## Step 4: Write the DS(ong)L file

Once the user confirms the structure, write the song as a TypeScript file at `songs/<artist-slug>/<song-slug>.ts`.

In this step, do all of the following together as one output:
- Define the section structure (Intro, Verse, Chorus, Bridge, etc.) as a sequence of spans
- Set measure counts for each section
- Mark sections with `{ cue: true }` so buildRpp auto-places TTS announcements 2 bars before each section and count-ins 1 bar before. Do NOT use manual `cue()` for section announcements — that's only for ad-hoc band notes (e.g. `cue("Hit the flanger pedal", 24)`).
- Map lyrics from Genius into `lyric()` events at appropriate beat offsets within sections, typically one per bar or per phrase, tagged with the vocalist role (e.g. "Lead Vocal")
- Place `chord()` events where chord changes are known
- Handle any tempo or time signature changes with span options
- Set the `key` option on the song if known
- Add `audio()` nodes for each stem if stems are available

**Preamble rules (inviolate):**
- Every song MUST start with a preamble span of at least 4 bars. Name it `"Title - Artist"` (e.g. `span("Save Me - Aimee Mann", bars(4))`). This is the clickbait region — title TTS cue and count-in go here. No audio, no lyrics, no backing tracks.
- Do NOT put `cue: true` on the preamble — there's nothing before it to announce.
- The preamble is NOT the song's intro — it's padding before the music starts. The actual musical intro (e.g. guitar figure) is a separate span named "Intro" that follows the preamble.
- Audio/backing tracks go inside the FIRST musical section (e.g., inside the Intro or Verse span), never as top-level siblings of `seq()` and never in the preamble.
- buildRpp auto-places: title cue at beat 0, section cue 2 bars before each `cue: true` section, count-in 1 bar before. With a 4-bar preamble these never overlap.

The goal is a complete, reviewable dsongl file in one shot. The user will read the code and tell you what to adjust.

## Step 5: Generate REAPER project

Once the song file is finalized, generate the RPP:

```bash
node_modules/.bin/clickbait-generate songs/<artist-slug>/<song-slug>.ts songs/<artist-slug>
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

## Useful notes

Hard-won lessons from building real songs. Check these before making assumptions.

**BPM detection:**
- Run `beats` with a wide range first (e.g. 60–150) to find the ballpark, then rerun with ±2 BPM to eliminate ghost beat false positives from drum fills.
- Run both drums (energy) and full mix (spectral-flux) and compare. If they disagree on a beat, that's a problem area.
- Deezer frequently returns double-time BPM. Always check if halving matches the drum tracker.

**Audio alignment & pickups:**
- Songs commonly have pickup beats before the intro or other sections. Use negative `offset` on audio nodes to place stems before a section's downbeat (e.g. `offset: -1` for a 1-beat pickup during the count-in).
- The first beat of audio rarely lands on beat 1 of bar 1. Expect to nudge the offset.

**Section boundaries:**
- Spectral flux energy-per-bar can help estimate section boundaries but isn't reliable for dynamically uniform songs.
- Whisper phrase timing + Genius section names is the primary approach.
- Songsterr is a useful reference for bar counts and structure when our tools can't determine boundaries.

**Endings:**
- Use `cue: true` on the Ending span for an auto count-in, plus manual `cue("1", 0)` for the final hit.
- For "end on 1, 2, 3" patterns, use manual cues with offsets (e.g. `cue("end on", -1)`, `cue("1", 0)`, `cue("2", 1)`, `cue("3", 2)`).
- Songs often need a short Ending span (1–4 bars) after the last musical section for the final hit + ring-out.

**Post-chorus / instrumental sections:**
- Songs often have instrumental bars between chorus and verse that don't fit either label. Use "Post-Chorus" or "Instrumental" as section names — TTS reads them to the band.

## Component docs

Read these when you need detail on a subsystem:

- **Stems** (`skill/stems.md`) — splitting, parallel analysis, grid fitting, unstretch
- **Teleprompter** (`skill/teleprompter.md`) — browser lyrics display, OSC relay, REAPER setup
- **TTS / cue generation** — `$CLICKBAIT_AUDIO speak` (Piper TTS, lessac voice)
