/**
 * Perceptual-center (P-center) of a spoken cue, from FORCED-ALIGNMENT character
 * timings. The felt beat of a spoken word is not its acoustic onset but its
 * P-center, which the speech-timing literature locates at ≈ the vowel/sonorant
 * onset — "P-centre adjustment" is what makes automated announcements sit in
 * time. We place a cue so its P-center lands on the beat.
 *
 * Rule (matches the ear on "two" → t on the beat, "three" → beat between th and
 * r): take the target syllable's vowel group, then walk back over its onset
 * cluster of STOPS + SONORANTS, but SKIP a leading voiceless fricative (f/s/th/
 * sh/h) — the fricative hiss leads *into* the beat. `mode: "first"` uses the
 * FIRST vowel group (count numbers, single-word cues that hit ON the beat);
 * `mode: "last"` uses the LAST (a section-name pickup resolving onto the "1").
 *
 * Input is the flat character list from `clickbait-audio align` (word.chars).
 * Orthographic, so a couple of spelling traps are handled (silent trailing 'e').
 * A known limitation: a multi-consonant boundary can over-reach by one consonant
 * (e.g. "intro" → N instead of the "tr" onset) — a maximal-onset-cluster refinement
 * is future work; it's forgiving for a pickup.
 */

export interface AlignChar {
  text: string;
  startMs: number;
}

const VOWELS = "AEIOU";
const isVowel = (c: string) => VOWELS.includes(c);
/** Leading voiceless fricative letters (H also catches th/sh/ph digraphs). */
const FRICATIVE = "FSH";

/** The P-center offset (seconds into the WAV) to land on the beat. */
export function pCenterSeconds(chars: AlignChar[], mode: "first" | "last"): number {
  if (chars.length === 0) return 0;
  const C = chars.map((c) => ({ ms: c.startMs, u: c.text.toUpperCase() }));

  // Ignore a silent trailing 'e' (consonant + e), e.g. "one", "five".
  let end = C.length;
  if (end > 2 && C[end - 1].u === "E" && !isVowel(C[end - 2].u)) end--;

  // Target vowel group: first or last maximal run of vowels within [0, end).
  let ve = -1;
  if (mode === "first") {
    for (let i = 0; i < end; i++) if (isVowel(C[i].u)) { ve = i; break; }
  } else {
    for (let i = end - 1; i >= 0; i--) if (isVowel(C[i].u)) { ve = i; break; }
  }
  if (ve < 0) return C[0].ms / 1000; // no vowel — use the start
  let vs = ve;
  while (vs - 1 >= 0 && isVowel(C[vs - 1].u)) vs--;

  // Walk back from the vowel over the onset consonants; halt at a preceding vowel
  // (previous syllable), a leading voiceless fricative, or the start.
  //  - "first" (counts/manual): the whole onset cluster's ATTACK hits the beat
  //    (two → T of "tw", three → R after the "th"), so walk the full cluster.
  //  - "last" (a section-name pickup): the last syllable RESOLVES onto the beat at
  //    the single consonant just before its vowel (intro → the "r" of "-tro"),
  //    so step back only one consonant.
  let onset = vs;
  for (let i = vs - 1; i >= 0; i--) {
    const ch = C[i].u;
    if (isVowel(ch) || FRICATIVE.includes(ch)) break;
    onset = i;
    if (mode === "last") break;
  }
  return C[onset].ms / 1000;
}
