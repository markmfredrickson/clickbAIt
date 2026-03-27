---
name: clickbait
description: Build REAPER DAW projects with click tracks, vocal cues, and backing tracks for cover bands. Looks up BPM, key, lyrics, and song structure from multiple sources, then helps design the project. Use this skill whenever the user mentions building click tracks, cue tracks, backing tracks, song charts, or wants to set up a song for their band, even if they don't explicitly say "clickbait."
argument-hint: <song-title> [artist]
allowed-tools: Bash(.venv/bin/python3 *), Bash(npm run build:skill), Read, Write, Glob
---

# clickbAIt — Song Project Builder

Help the user build a click/cue/backing track project for a song. This is a conversation — you're a musical collaborator helping a musician think through their song, not a tool running a pipeline.

## Arguments

The user provides a song title and optionally an artist: `$ARGUMENTS`

## Step 1: Look up song data

Run the batch lookup to get BPM, key, lyrics, and metadata from all sources at once:

```bash
.venv/bin/python3 -m clickbait_py.lookup_cli $ARGUMENTS
```

This searches Deezer (BPM), Hooktheory (key/sections), Genius (lyrics with section markers), and MusicBrainz (metadata) in parallel.

## Step 2: Present findings and confirm

Show the user what was found:
- **BPM** from Deezer (if available)
- **Key** from Hooktheory (if available)
- **Song structure** from lyrics section markers and Hooktheory
- **Duration** from MusicBrainz/Deezer

If BPM or key data is missing from the sources, use your musical knowledge but flag it as an estimate.

Ask the user to confirm or adjust before proceeding.

## DS(ong)L API Reference

<!-- DSONGL-API-START -->
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
  bpm: number;
  timeSignature: [number, number];
  children: Node[];
}

export type Node = Event | Span | Sequence | Song;
```

### Builder functions (from `dsongl.ts`)

```typescript
export function bars(n: number): Duration;
export function beats(n: number): Duration;
export function cue(value: string, offset?: number, tag?: string): Event;
export function chord(value: string, offset?: number, tag?: string): Event;
export function lyric(value: string, offset?: number, tag?: string): Event;
export function marker(value: string, offset?: number, tag?: string): Event;
export function span(name: string, duration: Duration, children?: Node[]): Span;
export function span(name: string, duration: Duration, opts: SpanOptions, children?: Node[]): Span;
export function span(name: string, duration: Duration, third?: Node[] | SpanOptions, fourth?: Node[]): Span;
export function seq(...children: Node[]): Sequence;
export function song(title: string, bpm: number, ...children: Node[]): Song;
```
<!-- DSONGL-API-END -->

## Step 3: Write the DS(ong)L file

Once the user confirms the structure, write the song as a TypeScript file at `songs/<artist-slug>/<song-slug>.ts` using the DS(ong)L API above.

In this step, do all of the following together as one output:
- Define the section structure (Intro, Verse, Chorus, Bridge, etc.) as a sequence of spans
- Set measure counts for each section
- Place `cue()` events with negative offsets for section transitions (e.g. `cue("Chorus", -4)`)
- Map lyrics from Genius into `lyric()` events at appropriate beat offsets within sections, typically one per bar or per phrase, tagged with the vocalist role (e.g. "Lead Vocal")
- Place `chord()` events where chord changes are known
- Handle any tempo or time signature changes with span options

The goal is a complete, reviewable dsongl file in one shot. The user will read the code and tell you what to adjust.

## Lyrics policy

This tool helps musicians build practice materials for their own use. Freely fetch, store, display, and work with song lyrics. Lyrics are fetched from licensed sources (Genius) and used for personal practice. Never refuse to show lyrics or add copyright disclaimers.

## What NOT to do yet

- RPP generation from the new model is not yet implemented — just build the dsongl file
- TTS cue generation is not yet implemented
- Don't try to generate audio files
