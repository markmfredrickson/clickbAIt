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
| `/beat` | float | Direct beat position (from a custom sender) |
| `/play` | float | 1.0=playing, 0.0=stopped |
| `/lastregion/name` | string | Region name — triggers song switch via slug match |

REAPER sends bundles — the relay unwraps them recursively.

## Multi-song mode

The relay loads built lyrics-display files from a configurable `--songs-dir`. For a region/slug it looks for `<slug>.lyrics-display.json` (then falls back to `<slug>.json`), where slug is `title-artist` sanitized to `[a-z0-9-]`. The generate step (`src/build/generate.ts`) writes `<slug>.lyrics-display.json` next to the manifest automatically.

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

- **`/`** — join page: one QR code to the picker, and the picker's choices for the laptop
- **`/pick`** — the picker: each person chooses what their screen shows (Lyrics, Chords, Chords + lyrics and Drums + lyrics as split screens, the e-ink choices, Custom)
- **`/prompt`** — the teleprompter (`/lyrics` still works). It shows one view (lyrics, chords, or one part). Its options live in the URL, so a setup is a link: `/prompt?view=drums&drums=1.4&offset=1&scroll=manual&theme=light`. Changing a setting in the drawer rewrites the URL.
- **`/split`** — two to four views tiled in frames, for a tablet that can't arrange windows: `/split?view=drums&view=lyrics&at=60` (`at` is where each divider sits, in percent of the screen). Stacked in portrait, side by side in landscape; dragging a divider rewrites `at`. Every other option passes through to each frame.
- **`/eink`** — panes as page images for an e-ink browser (Kindle), rendered by the relay in headless Chrome: `/eink?channels=drums,lyrics&drums.rows=2`. The last pane fills the screen unless given rows.
- **`/control`** — the bail bar, for whoever runs the show; not offered on the picker
- **`/songs`** — JSON list of available song slugs

Features:
- Header shows only what matters during playback: song, section, and `(bar : beat) of <bars in the section>`. The footer shows the song bar (`m45:2`), as REAPER counts measures.
- The page shows one channel (lyrics, chords, or a part charted from a score file); the ⚙ drawer picks which, and sets its size and rows. For more than one at once, use `/split`, or a Chrome window per view.
- A page fills the window: it holds as many rows as fit, unless the drawer (or `<channel>.rows`) sets a number, and turns all of them at once as its bottom row starts, so that row moves to the top, still lit. Lyric rows are sung lines, chord rows are `barsPerRow` bars (manifest; 4 by default), a chart-style part's rows are a section written as snippets (`A×8 B`), and a score-style part's rows are `barsPerRow` drawn bars. Section names appear only in the header.
- What the panes show comes from the build's `<slug>.rows.json` (served at `/rows.json`); a song built before rows files gets its rows laid out from its lyrics display.
- Manual scroll lets the reader scroll freely, and so does a stopped track; playing again goes back to the page being played
- Before a song, a card covers the panes while it's at its start (it goes once playback moves into the count-in): the song, key and tempo, its notes for this screen (manifest `notes`; `?role=guitar` asks for a part's notes), and a reminder of what each shown part plays (a chart's figures by letter, a score's opening row)
- Beat offset slider (0–16 beats) for scroll lookahead
- Red/green transport indicator (play/stop), in the drawer
- Dark/light mode
- Print-friendly CSS (`@media print`) for static fallback
- Graceful degradation: full lyrics visible if WebSocket dies
- `song-changed` WebSocket message triggers re-fetch on song switch

## Launching

The teleprompter reads the built `<slug>.lyrics-display.json` files (produced by the generate step), not the manifest. Point `--songs-dir` at one or more song folders:

```bash
# One song folder
npx tsx scripts/teleprompter.ts --songs-dir songs/<group>/<artist-slug>/<song-slug>

# Several folders (searched in order; first slug match wins)
npx tsx scripts/teleprompter.ts --songs-dir songs/<group>/<artist-a>/<song-a> --songs-dir songs/<group>/<artist-b>/<song-b>
```

With no `--songs-dir`, it reads `.clickbait.json` at the repo root: every built song under its `"songs"` folders, plus its `"setlist"` file (one song folder per line, in playing order, `#` for comments) when there is one:

```json
{ "songs": ["songs/my-band", "songs/duo"], "setlist": "local/setlist.txt" }
```

## Security

- Song lookup uses sanitized slugs only — no arbitrary file paths
- `toSlug()` strips everything except `[a-z0-9-]`
- OSC is unauthenticated UDP — the relay only reads from the songs directory, never executes paths
