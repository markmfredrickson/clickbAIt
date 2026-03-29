# clickbAIt

We asked AI to build our cover band's click tracks. You won't believe what happened next.

> **Warning — AI-Assisted Code, Beta Quality**
>
> This software was developed with substantial AI assistance (Claude by Anthropic). While a human reviews and attests all code before it reaches `main`, this is early-stage software that has not been extensively tested in production. **Use at your own risk.**
>
> All AI-authored commits include a `Co-Authored-By` trailer for transparency. See [CLAUDE.md](CLAUDE.md) for the attestation workflow.

## What it does

clickbAIt builds **show tracks** — everything a band needs alongside their live playing: click tracks, spoken section cues, count-ins, backing tracks, and synchronized lyrics. Think of it as a stage manager in a REAPER project.

**AI runs through the whole pipeline:**
- **Claude** designs the song structure — looks up BPM, key, lyrics, and writes the project with you
- **Piper TTS** generates spoken cue announcements ("Verse 2", "Chorus")
- **Whisper** transcribes vocals for word-level lyric timing
- Stem splitting (Demucs) and audio analysis planned

All of this feeds into **DSongL**, a domain-specific language that programmatically generates REAPER project files and powers a web-based live lyrics display.

**What you get:**
- **Click + cues** — hear "Verse 2... 1, 2, 3, 4" in your in-ears before each section
- **Song structure** defined in DSongL, a TypeScript domain-specific language for show tracks — sections, lyrics, chords, tempo changes
- **Backing tracks** — place stems or audio files on the timeline, aligned to the click
- **Live lyrics teleprompter** — REAPER drives a browser via OSC. Band scans a QR code, audience does karaoke

## Requirements (macOS only for now)

- **Node.js** 18+ and npm
- **Rust** toolchain (for the audio binary)
- **REAPER** (for playback — not needed for generation)
- **Anthropic API key** (for AI-assisted song building via Claude Code / Cowork)
- **Genius API token** (optional, for lyrics lookup)

## Install

```bash
git clone <repo-url> && cd clickbAIt

# Install Node dependencies
npm install

# Build the Rust audio binary
cargo build

# Download the Piper TTS voice model
mkdir -p ~/.local/share/clickbait/voices
curl -L -o ~/.local/share/clickbait/voices/en_US-lessac-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
curl -L -o ~/.local/share/clickbait/voices/en_US-lessac-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

# Set up environment
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY (required) and GENIUS_API_TOKEN (optional)

# Copy the REAPER OSC config (for teleprompter)
cp src/teleprompter/clickbait.ReaperOSC ~/Library/Application\ Support/REAPER/OSC/
```

## Quick start

### Build a song with Claude

The fastest way is with [Claude Code](https://claude.ai/code) or [Claude Cowork](https://claude.com/product/cowork):

```bash
# In Claude Code, run the skill:
/clickbait Valerie Amy Winehouse
```

Claude looks up BPM, key, lyrics, and structure, then writes a DSongL file and generates the REAPER project. You review and adjust.

Example conversation:

```
You:    /clickbait When the Saints Go Marching In

Claude: [looks up BPM, key, structure from multiple sources]
        Found: ~129 BPM, key of G, 4/4 time. Traditional spiritual,
        standard verse form. Does this look right?

You:    Yes. I have a 78rpm recording at tests/fixtures/audio/saints-78rpm.mp3.
        There's a spoken intro from 5-18 seconds, then instrumental until
        about 40 seconds, then vocals with call-and-response.

Claude: [analyzes onsets, writes DSongL file with audio() node, soffs=18]
        Here's the structure — 4-bar intro, 12-bar instrumental, then
        3 verses with call-and-response lyrics. Ready to generate?

You:    Generate it.

Claude: [runs generate.ts → RPP + cue WAVs + teleprompter JSON]
        Done! Open output/setlist/when-the-saints-go-marching-in-traditional.rpp
```

### Manual workflow

```bash
# 1. Look up song data
target/debug/clickbait-audio lookup "Valerie" -a "Amy Winehouse"

# 2. Write a song file (see songs/traditional/ for examples)
#    → songs/amy-winehouse/valerie.ts

# 3. Generate the REAPER project
npx tsx src/generate.ts songs/amy-winehouse/valerie.ts ./output

# 4. Open in REAPER
open output/valerie-amy-winehouse.rpp
```

### Teleprompter

```bash
# Start the teleprompter server
npx tsx scripts/teleprompter.ts --songs-dir ./output

# Open http://localhost:3000 — scan the QR code on any device
# REAPER drives the scroll via OSC
```

REAPER setup for OSC: Preferences > Control/OSC/web > Add > Device IP `127.0.0.1`, Device port `9000`, Pattern config `clickbait`.

## How it works

```
Song definition (.ts)  →  linearize  →  buildRpp  →  REAPER project (.rpp)
                                           ↓
                                    Piper TTS cues (.wav)
                                           ↓
                                    Teleprompter JSON (.json)
                                           ↓
                          REAPER → OSC → relay → WebSocket → browser
```

### Song files (DSongL)

Songs are TypeScript files using a builder DSL:

```typescript
export default song("Valerie", 148, { artist: "Amy Winehouse", key: "Eb" },
  seq(
    span("Intro", bars(4), [ chord("Eb", 0) ]),
    span("Verse 1", bars(8), { cue: true }, [
      chord("Eb", 0),
      lyric("Well sometimes I go out by myself", 0, "Lead Vocal"),
      // ...
    ]),
  ),
);
```

Sections with `{ cue: true }` get automatic TTS announcements and count-ins. See `src/types.ts` and `src/dsongl.ts` for the full API.

## Development

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Lint (if ruff is installed)
.venv/bin/ruff check .
```

Tests use [Vitest](https://vitest.dev/). The project follows TDD — write tests first, then implement.

## Known issues

- **Audio stem import is experimental** — stems land in the RPP but LENGTH and path handling have edge cases
- **Piper TTS sample rate** — some REAPER versions may play cues at the wrong speed (22050 Hz vs 44100 Hz project). Resample if needed.
- **macOS only** — not tested on Linux or Windows
- **No pre-built binaries** — you need Rust toolchain to build `clickbait-audio`

## Project structure

```
src/
  types.ts, dsongl.ts     — Song model and DSL builder
  linearize.ts             — Tree → flat timeline
  build-rpp.ts             — RPP file generation
  generate.ts              — End-to-end: song → cues + RPP + JSON
  teleprompter/            — "One Simple Track" browser lyrics display
crates/audio/              — Rust binary: lookup, analyze, speak, duration
songs/                     — Song definitions (gitignored except traditional/)
scripts/                   — Launchers and utilities
assets/                    — Click and count-in samples
```

## License

[MIT](LICENSE)

## Acknowledgments

Built with [Claude Code](https://claude.ai/code) by Anthropic. All AI-authored commits are tagged with `Co-Authored-By` for transparency.
