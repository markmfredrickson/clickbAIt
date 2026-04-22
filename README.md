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
- **Demucs** splits full mixes into stems (vocals, drums, bass, guitar, piano, other) with GPU acceleration
- **DBN beat tracker** finds beat positions from audio — Viterbi-based algorithm ported from madmom

All of this feeds into **DSongL**, a domain-specific language that programmatically generates REAPER project files and powers a web-based live lyrics display.

**What you get:**
- **Click + cues** — hear "Verse 2... 1, 2, 3, 4" in your in-ears before each section
- **Song structure** defined in DSongL, a TypeScript domain-specific language for show tracks — sections, lyrics, chords, tempo changes
- **Backing tracks** — stems aligned to the click with stretch markers for tempo matching
- **Live lyrics teleprompter** — REAPER drives a browser via OSC. Band scans a QR code, audience does karaoke

## Requirements (macOS only for now)

- **macOS** (Apple Silicon — Intel Macs need to build from source)
- **Node.js** 18+ and npm
- **REAPER** (for playback — not needed for generation)
- **Genius API token** (optional, for lyrics lookup — free at genius.com/api-clients)

## Install

```bash
git clone https://github.com/markmfredrickson/clickbAIt && cd clickbAIt
./setup.sh
```

`setup.sh` handles everything: Node dependencies, pre-built binary from [Releases](https://github.com/markmfredrickson/clickbAIt/releases), TTS voice model, Demucs/Whisper model downloads, and REAPER OSC config.

Then edit `.env` and add your `GENIUS_API_TOKEN` (optional, free, enables lyrics lookup).

<details>
<summary>Manual install (or building from source)</summary>

```bash
git clone https://github.com/markmfredrickson/clickbAIt && cd clickbAIt

# Install Node dependencies
npm install

# Build the Rust audio binary from source
cargo build --release

# Download models (Whisper, Piper TTS, Demucs)
target/release/clickbait-audio setup

# Set up environment
cp .env.example .env
# Edit .env and add your GENIUS_API_TOKEN (optional)

# Copy the REAPER OSC config (for teleprompter)
cp src/teleprompter/clickbait.ReaperOSC ~/Library/Application\ Support/REAPER/OSC/
```
</details>

## Quick start

### Build a song with Claude

The fastest way is with [Claude Code](https://claude.ai/code) or [Claude Cowork](https://claude.com/product/cowork):

```bash
# In Claude Code, run the skill:
/clickbait Valerie Amy Winehouse
```

Claude looks up BPM, key, lyrics, and structure, then writes a DSongL file and generates the REAPER project. You review and adjust.

**With stems** — if you have audio to split:

```
You:    /clickbait Save Me Aimee Mann
        I have the full mix at songs/aimee-mann/save-me.m4a

Claude: [splits stems via Demucs, analyzes drums for BPM, transcribes vocals]
        Found: 120 BPM from drum stem, Deezer confirms. Whisper got
        word-level timing. Here's the structure...
```

### Manual workflow

```bash
# 1. Look up song data
target/release/clickbait-audio lookup "Valerie" -a "Amy Winehouse"

# 2. Split stems (optional — if you have audio)
target/release/clickbait-audio split mix.m4a --output-dir songs/amy-winehouse/stems

# 3. Detect beats from drum stem
target/release/clickbait-audio beats songs/amy-winehouse/stems/drums.wav

# 4. Write a song file (see songs/example-songs/ for examples)
#    → songs/amy-winehouse/valerie.ts

# 5. Generate the REAPER project
npx tsx src/generate.ts songs/amy-winehouse/valerie.ts songs/amy-winehouse

# 6. Open in REAPER
open songs/amy-winehouse/valerie-amy-winehouse.rpp
```

### Teleprompter

```bash
# Start the teleprompter server
npx tsx scripts/teleprompter.ts --songs-dir ./songs/amy-winehouse

# Open http://localhost:3000 — scan the QR code on any device
# REAPER drives the scroll via OSC
```

REAPER setup for OSC: Preferences > Control/OSC/web > Add > Device IP `127.0.0.1`, Device port `9000`, Pattern config `clickbait`.

Features:
- Karaoke-style lyric highlighting synced to REAPER's transport
- Auto-scroll with adjustable beat offset for lookahead
- Multi-song support — switch tabs in REAPER, lyrics switch automatically
- Dark/light mode, adjustable text size, print-friendly CSS
- Works on any device with a browser — band scans QR to join

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

### Audio pipeline

```
Full mix (.wav/.mp3/.m4a)
  → Demucs stem split (vocals, drums, bass, guitar, piano, other)
  → Drum stem → DBN beat tracker → beat positions + BPM
  → Vocal stem → Whisper → word-level timestamps
  → Stretch markers align stems to click track in REAPER
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

Sections with `{ cue: true }` get automatic TTS announcements and count-ins. See `src/dsongl/` for the full API, or `songs/example-songs/` for a working example.

### Audio binary (clickbait-audio)

Rust binary at `crates/audio/`. Subcommands:

| Command | Purpose |
|---|---|
| `beats` | DBN beat tracker — energy (drums) or spectral-flux (mixes) activation |
| `split` | Demucs stem separation (6-stem default, GPU-accelerated) |
| `transcribe` | Whisper speech-to-text with word-level timestamps |
| `analyze` | BPM/key/onset extraction (legacy, being replaced by `beats`) |
| `lookup` | Parallel metadata from Deezer, Genius, MusicBrainz |
| `speak` | Piper TTS for cue generation |
| `duration` | Audio file duration (WAV, MP3, M4A) |
| `unstretch` | Detect tempo warping in stems |
| `setup` | Download Whisper, Piper, Demucs models |

## Versioning

All packages in this repository share a **compatibility epoch** defined by the major and minor version (`x.y`). Patch versions (`z`) may vary independently per package.

**The contract:** any package at version `x.y.*` is guaranteed to work with any other package at `x.y.*`. If a change in one package has implications for another, all packages move to `x.(y+1).0` together.

## Development

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Build the Rust binary
cargo build --release

# Build npm package
npm run build
```

Tests use [Vitest](https://vitest.dev/). The project follows TDD — write tests first, then implement.

### Skill development

The Claude Code skill lives in `skill/`. Editable sources:

| File | Purpose |
|---|---|
| `skill/SKILL.md.njk` | Nunjucks template — edit this, not the generated file |
| `skill/stems.md` | Stem splitting and analysis workflow |
| `skill/teleprompter.md` | Teleprompter architecture and REAPER setup |

The generated `SKILL.md` is built at release time and gitignored. To regenerate locally:

```bash
npm run build:skill
```

This injects live DSongL types and builder signatures from `src/dsongl/` into the template.

### Testing the skill end-to-end

`sandbox/` simulates a fresh user install. To populate it with current build products:

```bash
scripts/sandbox.sh
```

This runs `cargo build --release`, renders the skill, then copies everything into `sandbox/`. Open a separate Claude Code session there to test as a user would:

```bash
cd sandbox && claude
```

The sandbox is gitignored — re-run `scripts/sandbox.sh` whenever you want a fresh snapshot.

## Known issues

- **macOS only** — not tested on Linux or Windows
- **Apple Silicon only** for pre-built binaries — Intel Macs need to build from source
- **Audio stem timing** — stretch markers align stems to click but edge cases remain
- **TTS voices** sound like a GPS, not a bandmate — functional but not beautiful

## Project structure

```
src/
  dsongl/                    — Song model, DSL builders, slug
  linearize.ts               — Tree → flat timeline
  build-rpp.ts               — RPP file generation
  generate.ts                — End-to-end: song → cues + RPP + JSON
  teleprompter/              — "One Simple Track" browser lyrics display
crates/audio/                — Rust binary: beats, split, lookup, speak, transcribe, etc.
songs/
  example-songs/             — Example and demo songs
skill/                       — Claude Code skill sources (Nunjucks templates)
scripts/                     — Build, setup, and utility scripts
assets/                      — Click and count-in samples
```

## License

[MIT](LICENSE)

## Acknowledgments

Built with [Claude Code](https://claude.ai/code) by Anthropic. All AI-authored commits are tagged with `Co-Authored-By` for transparency.
