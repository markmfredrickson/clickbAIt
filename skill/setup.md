# clickbAIt — First-Time Setup

Run this once before building your first song:

```bash
.claude/skills/clickbait/bin/clickbait-audio setup
```

This downloads all required models (~300 MB total) to `~/.cache/clickbait/`. Safe to re-run — skips anything already downloaded.

---

## Genius API token (optional, recommended)

Genius provides lyrics with section markers ([Verse], [Chorus], etc.), which are used to build the song structure. Without it, Deezer and MusicBrainz metadata still work, but lyrics lookup is unavailable.

**Get a token:**

1. Go to [genius.com/api-clients](https://genius.com/api-clients) and sign in (free account)
2. Click **New API Client**
3. Fill in:
   - **App Name:** anything (e.g. "clickbAIt")
   - **App Website URL:** anything (e.g. `http://localhost`)
   - **Redirect URI:** `http://localhost` — required by the form, not actually used
4. Click **Save**
5. Copy the **Client Access Token** (not the client ID or secret — the token)

**Add it to `.env`** in your clickbAIt directory:

```
GENIUS_API_TOKEN=your-token-here
```

If `.env` doesn't exist yet, create it. That's all — no OAuth flow needed.

## Models downloaded by `setup`

- **wav2vec2** — CTC forced alignment (`align`), the primary path for lyric timing: it maps known lyrics onto the vocal stem and can't hallucinate. Saved to `~/.cache/clickbait/models/`.
- **Whisper** (`base.en`, ~150 MB) — transcription (`transcribe`), used only as a fallback when no lyrics can be fetched. Saved to `~/.cache/clickbait/models/`.
- **Piper** (`en_US-lessac-medium`, ~65 MB) — generates spoken section cues. Saved to `~/.cache/clickbait/voices/`.
- **Demucs** (4-stem, ~80 MB) — splits a full mix into stems (vocals/drums/bass/other). Saved to `~/.cache/demucs-rs/`.

All models are global — shared across projects and working directories.
