# Haiku delegations

Focused fuzzy tasks delegated to a Haiku subagent via the `Agent` tool. Read
this file when the skill's main flow says to run one. Each template below
gives: inputs to gather, the prompt to pass, the JSON shape to expect, and
where to write the result.

All calls share the same shape:

```
Agent({
  description: "<short>",
  subagent_type: "general-purpose",
  model: "haiku",
  prompt: "<the prompt from below, with inputs pasted in>"
})
```

After the call, extract the JSON block from the subagent's message, validate
its shape, and write the sidecar. On malformed output, re-invoke once with
"Return ONLY the JSON object. No prose, no code fences." prepended. Then
stop — don't loop.

---

## Lyric alignment

**When:** both Genius lyrics (from `lookup`) and Whisper `words.json` (from
`transcribe`) exist.

**Inputs:**
- Genius raw text — extract the block between `---lyrics-raw---` and
  `---end-lyrics-raw---` in the lookup sidecar.
- `words.json` — parsed object.
- `bpm` — from the full-mix `.beats.json` or the confirmed BPM.

**Prompt:**

```
Align published lyric lines to Whisper word-level timestamps for a song.

Return one JSON object matching this shape exactly — no prose, no code fences:

{
  "alignments": [
    {
      "section": string,      // as it appears in the Genius markers, e.g. "Verse 1"
      "line":    string,      // canonical Genius line, verbatim
      "startMs": number,      // first matched Whisper word's startMs
      "beat":    number,      // round((startMs/1000) * bpm / 60, nearest 0.25)
      "confidence": number    // 0..1; 1.0 exact, 0.7 minor phonetic, 0.4 many errors, <0.3 speculative
    }
  ],
  "unmatched": [
    { "section": string, "line": string, "reason": string }
  ]
}

Rules:
  A. Extract lyric lines from the Genius raw text below.
     - Use [Section] markers as section labels. Preserve exact names.
     - Drop annotation prose, page chrome, editorial notes. When in doubt, include.
     - Lyrics before any [Section] marker → synthetic "Verse 1".
  B. For each line, find the best matching consecutive Whisper word run.
     Fuzzy/phonetic matching expected. Lines you can't confidently place
     go in unmatched[] with a brief reason.

=== Genius raw ===
<paste>

=== Whisper words ===
<paste words.json>

=== BPM ===
<number>
```

**Output:** `songs/<artist-slug>/<song-slug>.lyrics.json`. If the file
already exists, leave it — it is the human-edited version.

---

## Pronunciation map

**When:** generating TTS cues for a song and the title, artist, or unusual
lyric words would be mispronounced by Piper (lessac voice). Skip if nothing
in the song is likely to trip TTS.

**Inputs:** song title, artist, Genius raw text (optional, helps catch odd
proper nouns in the lyrics that might enter a cue script).

**Prompt:**

```
Build a pronunciation map for Piper TTS (lessac voice) for a song.

Return one JSON object matching this shape exactly — no prose, no code fences:

{
  "items": [
    {
      "text":   string,                                                 // literal string Piper will say
      "spoken": string,                                                 // respelling in plain letters + hyphens, caps for stress ("PORT-iss-head")
      "kind":   "artist"|"title"|"lyric"|"acronym"|"number"|"other",
      "reason": string                                                  // optional, one short phrase
    }
  ]
}

Rules:
  - Include ONLY strings Piper would actually mispronounce. If "spoken" would
    equal "text" after lowercasing, skip it.
  - No IPA. Plain letters + hyphens only.
  - Years/numbers → words ("1979" → "nineteen seventy-nine").
  - Acronyms → spelled out ("AC/DC" → "A C D C").

Song title:  <title>
Artist:      <artist>

=== Genius raw (optional; used to spot unusual lyric words) ===
<paste or omit>
```

**Output:** `songs/<artist-slug>/<song-slug>.pronunciation.json`. The TTS
pipeline consults this before generating cue WAVs.

---

## Song structure detection

**When:** you need section boundaries in beats (not just names) — the input
to the DSongL `span(..., bars(N))` authoring step.

**Inputs:** Genius raw text (for section labels), Whisper `words.json` (for
lyric-bearing timing), full-mix `.beats.json` (for total duration + BPM).

**Prompt:**

```
Determine the section structure of a song as (name, startBeat, bars) tuples.

Return one JSON object matching this shape exactly — no prose, no code fences:

{
  "sections": [
    {
      "name":       string,   // exact Genius label, or a reasonable inferred label like "Intro" / "Outro"
      "startBeat":  number,   // absolute beat position from song start, rounded to nearest whole beat
      "bars":       number,   // section length in bars (integer preferred; .5 OK for pickup bars)
      "confidence": number    // 0..1
    }
  ],
  "notes": string              // one sentence describing assumptions or gaps
}

Rules:
  - Use Genius [Section] markers when present; map them to Whisper word timing
    to locate each section's first lyric.
  - Non-lyric sections (Intro, Instrumental, Outro) have no Whisper evidence;
    infer from gaps in the Whisper timeline and the total song duration.
  - Prefer section lengths that divide into clean bar counts at the given BPM.
    Round to the nearest integer bar unless a pickup makes .5 obviously correct.
  - If two candidate segmentations tie, prefer the one with fewer sections.

Time signature: 4/4 assumed unless otherwise specified.
BPM: <number>
Total beats in song: <number>

=== Genius raw ===
<paste>

=== Whisper words ===
<paste>
```

**Output:** `songs/<artist-slug>/<song-slug>.structure.json`. Used as
scaffolding when authoring the DSongL file.

---

## Adding a new delegation

Same pattern as above:

1. Name the task. Define inputs and one concrete JSON shape.
2. Prompt rules: return ONLY JSON, no prose, no code fences. Describe shape
   with a JS-comment-annotated example, not an English schema.
3. Pick a sidecar filename: `<song-slug>.<task>.json`.
4. Keep prompts focused — one task per delegation. Pronunciation + structure
   in one call dilutes the result.
