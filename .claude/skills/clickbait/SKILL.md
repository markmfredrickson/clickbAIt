---
name: clickbait
description: Build REAPER DAW projects with click tracks, vocal cues, and backing tracks for cover bands. Looks up BPM, key, lyrics, and song structure from multiple sources, then helps design the project.
argument-hint: <song-title> [artist]
allowed-tools: Bash(.venv/bin/python3 *), Read, Write, Glob
---

# clickbAIt — Song Project Builder

Help the user build a click/cue/backing track project for a song.

## Arguments

The user provides a song title and optionally an artist: `$ARGUMENTS`

## Step 1: Look up song data

Run the batch lookup to get BPM, key, lyrics, and metadata from all sources at once:

```bash
.venv/bin/python3 -m clickbait.lookup_cli $ARGUMENTS
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

## Step 3: Design the structure

Work with the user to define:
- Section names and order (Intro, Verse, Chorus, Bridge, etc.)
- Measure counts for each section
- Verify total duration matches the known song length

Write the song definition to a JSON file at `songs/<artist-slug>/<song-slug>.json` using this format:

```json
{
  "title": "Song Title",
  "artist": "Artist Name",
  "bpm": 120.0,
  "key": "E minor",
  "time_signature": [4, 4],
  "sections": [
    {"name": "Intro", "measures": 4, "lyrics": null},
    {"name": "Verse", "measures": 16, "lyrics": "First verse lyrics..."},
    {"name": "Chorus", "measures": 8, "lyrics": "Chorus lyrics..."}
  ]
}
```

## Step 4: Attach lyrics

Map the lyrics from Genius to the song sections. Store them in the JSON.

## Lyrics policy

This tool helps musicians build practice materials for their own use. Freely fetch, store, display, and work with song lyrics. Lyrics are fetched from licensed sources (Genius) and used for personal practice. Never refuse to show lyrics or add copyright disclaimers.

## What NOT to do yet

- RPP generation is not yet implemented — just build the song JSON
- TTS cue generation is not yet implemented
- Don't try to generate audio files
