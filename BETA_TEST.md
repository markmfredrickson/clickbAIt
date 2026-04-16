# clickbAIt beta test

We asked AI to build our cover band's click tracks. You won't believe what happened next.

clickbAIt generates show tracks for cover bands — click tracks, spoken section cues, count-ins, backing tracks from stems, and a live lyrics teleprompter that scrolls on any phone. You tell Claude what song you want, it builds you a REAPER project.

## What works

- Tell Claude a song name and it looks up BPM, key, structure, lyrics and builds a REAPER project
- Click track with spoken cues before each section ("Verse 2... 1, 2, 3, 4")
- **Stem splitting** — give it a full mix (WAV, MP3, or M4A) and it separates vocals, drums, bass, guitar, piano using GPU-accelerated Demucs
- **Beat detection** — finds beat positions from drum stems for tight alignment
- **Lyrics from audio** — Whisper transcription with word-level timestamps, merged with Genius lyrics
- **Live lyrics on any phone/tablet** — scan a QR code, lyrics scroll as REAPER plays
- Multiple songs — switch tabs in REAPER, lyrics switch automatically
- Works with Claude Code and Claude Cowork

## What's rough

- **macOS only** (Apple Silicon). Intel Macs need to build from source.
- **BYOK** — you need your own Claude API key. Costs a few cents per song.
- TTS voices sound like a GPS, not a bandmate
- Stretch marker alignment is functional but not yet perfect for every song
- AI-written code, human-reviewed. It works on my machine.

## Prerequisites

- **macOS** (Apple Silicon recommended)
- **REAPER** installed
- **Node.js** 18+ (`brew install node`)
- **Claude Code** installed ([claude.ai/code](https://claude.ai/code))
- An **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com))
- A **Genius API token** (optional but recommended — free at [genius.com/api-clients](https://genius.com/api-clients))

## Install

```bash
git clone https://github.com/markmfredrickson/clickbAIt && cd clickbAIt
./setup.sh
```

setup.sh handles: Node dependencies, pre-built binary, TTS voice model, Demucs model download + GPU shader compilation, and REAPER OSC config.

After it finishes, edit `.env` and add your keys:

```bash
ANTHROPIC_API_KEY=sk-ant-...
GENIUS_API_TOKEN=...          # optional but gets you lyrics
```

### Verify your install

```bash
bash scripts/check-deps.sh
```

This checks that the binary, voice model, API key, and optional dependencies are all in place.

## Build your first song

Open the project in Claude Code:

```bash
claude
```

Then run the skill:

```
/clickbait Valerie — Amy Winehouse
```

Claude will:
1. Look up BPM, key, lyrics, and structure from Deezer, Genius, and MusicBrainz
2. Present findings and ask you to confirm or adjust
3. Write a DSongL song file (TypeScript DSL)
4. Generate TTS cue WAVs and build a REAPER project (.rpp)

Open the .rpp in REAPER and hit play. You should hear:
- A title announcement ("Valerie")
- Click track
- Section cues 2 bars before each section ("Verse 1... 1, 2, 3, 4")

### With stems

If you have audio to work with:

```
/clickbait Save Me — Aimee Mann
I have the full mix at songs/aimee-mann/save-me.m4a
```

Claude will split stems, detect beats from drums, transcribe vocals, and build a project with backing tracks aligned to the click via stretch markers.

## Teleprompter

After generating a song, start the lyrics server:

```bash
npx tsx scripts/teleprompter.ts --songs-dir ./songs/amy-winehouse
```

1. Open http://localhost:3000 on any device on your network
2. Scan the QR code or tap "Open Lyrics"
3. Configure REAPER: Preferences > Control/OSC/web > Add
   - Device IP: `127.0.0.1`
   - Device port: `9000`
   - Local listen port: `8000`
   - Pattern config: `clickbait`
4. Hit play in REAPER — lyrics scroll automatically

Features: dark/light mode, adjustable text size, beat offset slider for lookahead, print-friendly CSS for paper fallback.

## Troubleshooting

**"clickbait-audio not found"** — Run `./setup.sh` again, or build from source with `cargo build --release` and then `npm run build:skill`.

**Cues sound like chipmunks** — The TTS resamples to 44100 Hz but if your REAPER project is set to a different sample rate, pitch will be off. Check REAPER project settings.

**Stems won't split / GPU errors** — Demucs needs Metal (Apple GPU). If you see shader errors, try `./setup.sh` again — the GPU warmup step sometimes needs a second run.

**No lyrics scrolling** — Check that REAPER's OSC output is configured (step 3 above). The relay listens on UDP port 9000.

**Song structure looks wrong** — You can edit the `.ts` song file directly — it's just TypeScript. Change section names, bar counts, lyrics, then re-run the generate step. Claude can help.

**"ANTHROPIC_API_KEY not set"** — Edit `.env` in the project root.

## Building from source (Intel Macs or advanced users)

```bash
git clone https://github.com/markmfredrickson/clickbAIt && cd clickbAIt
npm install
cargo build --release
npm run build:skill

# Download models
target/release/clickbait-audio setup

# Copy REAPER OSC config
cp src/teleprompter/clickbait.ReaperOSC ~/Library/Application\ Support/REAPER/OSC/

# Set up environment
cp .env.example .env
```

## Feedback

If something breaks, tell me:
- What you tried (the `/clickbait` command or steps you took)
- What happened (error messages, unexpected behavior)
- What you expected

If Claude gets confused mid-song, you can always start fresh: delete the song directory under `songs/` and try again.

This is a beta — weird stuff will happen. That's why you're here.
