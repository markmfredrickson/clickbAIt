# clickbAIt: One Simple Track — Teleprompter

Browser-based karaoke-style lyrics display driven by REAPER via OSC. Band members and audience scan a QR code to follow along on any device.

## Architecture

```
REAPER → OSC (/time seconds) → Node relay → WebSocket → Browser
```

- REAPER sends transport position via built-in OSC output (configured with `clickbait.ReaperOSC`)
- Relay converts seconds→beats using the song's tempo map, broadcasts to browsers
- Browser gets full song payload on connect — OSC only sends current position
- Song switching: REAPER sends `/lastregion/name` on tab switch, relay matches slug to JSON file

## Key files

| File | Purpose |
|------|---------|
| `relay.ts` | OSC→WebSocket relay, HTTP server, multi-song switching |
| `export.ts` | Song tree → browser JSON payload (sections, lyrics, chords, timing) |
| `highlight.ts` | Pure functions: beat→section/lyric/scroll position |
| `types.ts` | Shared types: SongPayload, Section, TempoPoint, etc. |
| `index.ts` | Entry point: starts relay, prints QR to terminal |
| `client/` | Browser HTML/CSS/JS |
| `clickbait.ReaperOSC` | REAPER OSC pattern config |

## Song payload (SongPayload)

Served at `/song.json`. Contains everything the browser needs:

- `title`, `artist`, `key`, `bpm`, `slug`
- `tempoMap`: array of `{ beat, seconds, bpm }` for tempo changes
- `sections`: array of `{ name, beat, seconds, durationBeats, durationSeconds, lyrics[], chords[] }`
- Each lyric: `{ text, beat, seconds, tag? }`
- Each chord: `{ chord, beat, seconds }`

## OSC messages handled

| Address | Type | Purpose |
|---------|------|---------|
| `/time` | float | Transport position in seconds (from REAPER) |
| `/beat` | float | Direct beat position (from demo/custom) |
| `/play` | float | 1.0=playing, 0.0=stopped |
| `/lastregion/name` | string | Region name — triggers song switch via slug match |

REAPER sends bundles — the relay unwraps them recursively.

## Multi-song mode

The relay loads song JSONs from a configurable `--songs-dir`. File naming: `<slug>.json` where slug is `title-artist` sanitized to `[a-z0-9-]`. The generate step writes these sidecar files automatically.

Song switch: REAPER sends `/lastregion/name "Intro"` (or whatever the first region is). But for song identification, the first region in a clickbAIt RPP should match the song slug. The relay calls `toSlug()` on the region name and looks for a matching JSON file.

## REAPER setup

1. Copy `clickbait.ReaperOSC` to `~/Library/Application Support/REAPER/OSC/`
2. Preferences > Control/OSC/web > Add
   - Mode: Configure device IP+local port
   - Device IP: 127.0.0.1 | Device port: 9000
   - Local listen port: 8000
   - Pattern config: clickbait

The config sends: TIME, BEAT, TEMPO, PLAY, STOP, PAUSE, REPEAT, LAST_MARKER, LAST_REGION. Track/FX/VU counts set to 0 to minimize traffic.

## Browser client

- **`/`** — QR join page (scannable phone-to-phone, "Open Lyrics" button)
- **`/lyrics`** — Teleprompter view with karaoke-style highlighting
- **`/songs`** — JSON list of available song slugs

Features:
- Auto-scroll via `requestAnimationFrame` easing (not browser smooth scroll — Brave compat)
- Beat offset slider (±8 beats) for scroll lookahead
- Red/green transport indicator (play/stop)
- Dark/light mode
- Print-friendly CSS (`@media print`) for static fallback
- Graceful degradation: full lyrics visible if WebSocket dies
- `song-changed` WebSocket message triggers re-fetch on song switch

## Launching

```bash
# Single song from .ts file
npx tsx scripts/teleprompter.ts songs/amy-winehouse/valerie.ts

# Multi-song from JSON directory
npx tsx scripts/teleprompter.ts --songs-dir ./output

# Demo mode (simulated REAPER with loops)
npx tsx scripts/teleprompter-demo.ts
```

## Security

- Song lookup uses sanitized slugs only — no arbitrary file paths
- `toSlug()` strips everything except `[a-z0-9-]`
- OSC is unauthenticated UDP — the relay only reads from the songs directory, never executes paths
