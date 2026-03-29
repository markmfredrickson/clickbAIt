# Test Fixtures

Ground truth song files for evaluating skill output. These are NOT source material for the skill — they exist to verify what the skill produces independently.

## when-the-saints-ground-truth.ts

"When the Saints Go Marching In" — traditional, public domain (pre-1927).
Known BPM, key, structure, lyrics, and chords. Used to evaluate whether
the clickbait skill can produce a correct dsongl from just a song name.

### Test prompt

> /clickbait When the Saints Go Marching In
>
> I don't have a track for this. It's a traditional song — find the lyrics
> and structure online. Key of G, around 116 BPM. Four verses, simple
> chord progression. Build me a dsongl file and generate the RPP.

### What to evaluate

- Correct key (G major)
- Reasonable BPM (110-125 range)
- 4/4 time
- 4 verses with correct lyrics (public domain traditional text)
- Chord progression approximately: G - G7 - C - G - B7/Em - G - D7 - G
- Cues placed before each verse
- Lyrics tagged with vocalist role
