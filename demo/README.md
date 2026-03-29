# Demo Screencasts

Scripted, reproducible screencasts that update with each release.

## Quick start

```bash
# Record everything and compose into one video
./demo/render.sh --all

# Or record individually
./demo/render.sh --reaper-only    # REAPER playback screen capture (macOS)
./demo/render.sh --browser-only   # Playwright teleprompter recording
./demo/render.sh --cli-only       # VHS terminal recording
```

## Prerequisites

```bash
# Browser recording
npm install
npx playwright install chromium

# Terminal recording
brew install charmbracelet/tap/vhs

# Video compositing
brew install ffmpeg
```

### macOS Automation permissions (for REAPER recording)

The REAPER screencast uses AppleScript to position the window and control playback.
Your terminal app (e.g. Ghostty) needs **Automation** permission to control REAPER:

1. Run this to trigger the permission prompt:
   ```bash
   osascript -e 'tell application "REAPER" to activate'
   ```
2. Click **Allow** when macOS prompts
3. Verify in **System Settings > Privacy & Security > Automation** that your terminal has REAPER listed
4. If the prompt doesn't appear, reset and retry:
   ```bash
   tccutil reset AppleEvents com.mitchellh.ghostty  # replace with your terminal's bundle ID
   osascript -e 'tell application "REAPER" to activate'
   ```

## How it works

### REAPER screencast (`reaper-record.sh`)

macOS-only. Uses `ffmpeg -f avfoundation` to screen-capture REAPER playing a clickbAIt project:
1. Opens a `.rpp` file in REAPER
2. Positions/resizes the window via AppleScript
3. Triggers playback via OSC (action 1007)
4. Records the screen for a configurable duration
5. Stops playback and encodes to mp4

Set `REAPER_RPP` to choose a specific project, or it auto-finds one in `output/`.
Set `REAPER_DURATION` to control recording length (default 20s).

### Browser screencast (`teleprompter.spec.ts`)

Uses [Playwright](https://playwright.dev/) to:
1. Start the teleprompter demo server (simulated REAPER playback)
2. Record the browser UI showing lyrics highlighting and auto-scrolling
3. Demonstrate controls: dark mode, text size, look-ahead offset, scroll mode

The Playwright config (`playwright.config.ts`) sets 1280x720 resolution and enables
video recording automatically.

### Terminal screencast (`cli.tape`)

Uses [VHS](https://github.com/charmbracelet/vhs) with a declarative `.tape` script to:
1. Show `clickbait-audio` CLI help and subcommands
2. Demo audio analysis (BPM detection)
3. Demo TTS cue generation
4. Show teleprompter server startup

### Compositing (`render.sh`)

Stitches recordings together with ffmpeg:
- Title card (3s)
- "REAPER Project Playback" section card + screen capture
- "Live Teleprompter" section card + browser recording
- "Command Line Tools" section card + terminal recording

Output: `demo/output/clickbait-demo.mp4`

## CI integration

Add to `.github/workflows/release.yml`:

```yaml
on:
  release:
    types: [published]

jobs:
  screencast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: sudo snap install vhs
      - run: ./demo/render.sh --all
      - run: gh release upload ${{ github.event.release.tag_name }} demo/output/clickbait-demo.mp4
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Generating the demo song

The REAPER screencast uses "When the Saints Go Marching In" (public domain).
To generate the `.rpp` project if it doesn't exist yet:

```bash
/clickbait When the Saints Go Marching In - Traditional
```

Or directly:

```bash
npx tsx src/generate.ts songs/traditional/when-the-saints-go-marching-in.ts output/saints
```

## Updating for new features

- **New REAPER feature**: Adjust `reaper-record.sh` duration or project
- **New UI feature**: Add interactions to `teleprompter.spec.ts`
- **New CLI command**: Add steps to `cli.tape`
- **New section in video**: Add a card + recording in `render.sh`
