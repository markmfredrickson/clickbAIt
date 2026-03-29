# clickbAIt beta test

We asked AI to build our cover band's click tracks. You won't believe what happened next.

clickbAIt generates show tracks for cover bands — click tracks, spoken section cues, count-ins, and a live lyrics teleprompter that scrolls on any phone. You tell Claude what song you want, it builds you a REAPER project.

## What works

- Tell Claude a song name → it looks up BPM, key, structure, lyrics and builds a REAPER project
- Click track with spoken cues before each section ("Verse 2... 1, 2, 3, 4")
- Live lyrics on any phone/tablet — scan a QR code, lyrics scroll as REAPER plays
- Multiple songs — switch tabs in REAPER, lyrics switch automatically
- Works with Claude Code and Claude Cowork

## What's rough

- **macOS only** (Apple Silicon). Intel Macs need to build from source.
- **BYOK** — you need your own Claude API key. Costs a few cents per song.
- Audio stem import works but timing alignment is manual
- TTS voices sound like a GPS, not a bandmate
- AI-written code, still being reviewed. It works on my machine.

## Setup

**You need:**
- macOS with REAPER installed
- Node.js 18+ (`brew install node`)
- An Anthropic API key

**Install:**
```bash
git clone https://github.com/markmfredrickson/clickbAIt && cd clickbAIt
npm install

# Pre-built binary (Apple Silicon):
mkdir -p target/release
# Download clickbait-audio-macos-arm64.tar.gz from the GitHub release
tar xzf clickbait-audio-macos-arm64.tar.gz -C target/release/

# Or build from source (needs Rust):
# cargo build --release
# cp target/release/clickbait-audio target/debug/

# Download the TTS voice model
mkdir -p ~/.local/share/clickbait/voices
curl -L -o ~/.local/share/clickbait/voices/en_US-lessac-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
curl -L -o ~/.local/share/clickbait/voices/en_US-lessac-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

# Set up your API key
cp .env.example .env
# Edit .env — add your ANTHROPIC_API_KEY

# Set up REAPER OSC (for the teleprompter)
cp src/teleprompter/clickbait.ReaperOSC ~/Library/Application\ Support/REAPER/OSC/
```

## Build a song

In Claude Code:
```
/clickbait Valerie — Amy Winehouse
```

Claude looks up the song, writes the project file, generates TTS cues, and builds a REAPER project. Open the .rpp in REAPER and hit play.

## Teleprompter

```bash
npx tsx scripts/teleprompter.ts --songs-dir ./output
```

Open http://localhost:3000 on any device. Scan the QR code. Lyrics scroll as REAPER plays.

REAPER setup: Preferences > Control/OSC/web > Add > Device IP `127.0.0.1`, Device port `9000`, Pattern config `clickbait`.

## Feedback

If something breaks, tell me:
- What you tried
- What happened
- What you expected

This is a beta — weird stuff will happen. That's why you're here.
