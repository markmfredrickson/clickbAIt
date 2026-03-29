/**
 * lyrics-from-audio: Take a vocal stem + BPM → lyric() events at beat offsets.
 *
 * Usage:
 *   npx tsx src/lyrics-from-audio.ts <audio-file> <bpm> [tag]
 *
 * Example:
 *   npx tsx src/lyrics-from-audio.ts stems/vocals.wav 148 "Lead Vocal"
 *
 * Outputs dsongl lyric() calls to stdout, with confidence annotations
 * for Claude to cross-reference against known lyrics sources.
 */

import {
  transcribeAudio,
  groupIntoPhrases,
  buildTranscriptionPhrase,
  secondsToBeats,
  quantize,
} from "./transcribe.js";

const audioFile = process.argv[2];
const bpm = parseFloat(process.argv[3]);
const tag = process.argv[4] ?? "Lead Vocal";
const MIN_CONFIDENCE = 0.5;

if (!audioFile || !bpm) {
  console.error("Usage: npx tsx src/lyrics-from-audio.ts <audio-file> <bpm> [tag]");
  process.exit(1);
}

async function main() {
  console.error(`Transcribing ${audioFile} at ${bpm} BPM, tag="${tag}"...`);

  const words = await transcribeAudio(audioFile);

  console.error(
    `Got ${words.length} words (${words.filter((w) => (w.confidence ?? 0) < MIN_CONFIDENCE).length} low-confidence)`,
  );

  const phrases = groupIntoPhrases(words, bpm);

  console.log(`// Lyrics from: ${audioFile}`);
  console.log(`// BPM: ${bpm}, Tag: ${tag}`);
  console.log(
    `// ${phrases.length} phrases (${phrases.filter((p) => buildTranscriptionPhrase(p).avgConfidence < MIN_CONFIDENCE).length} low-confidence)\n`,
  );

  for (const phraseWords of phrases) {
    const phrase = buildTranscriptionPhrase(phraseWords);
    const beat = quantize(secondsToBeats(phrase.startMs / 1000, bpm));
    const escaped = phrase.text.replace(/"/g, '\\"');
    const conf = Math.round(phrase.avgConfidence * 100);

    if (phrase.avgConfidence < MIN_CONFIDENCE) {
      console.log(`// LOW CONFIDENCE (${conf}%) — likely hallucinated or non-speech:`);
      console.log(`// lyric("${escaped}", ${beat}, "${tag}"),`);
    } else {
      let annotation = "";
      if (phrase.lowConfidenceWords.length > 0) {
        annotation = `  // uncertain: ${phrase.lowConfidenceWords.join(", ")}`;
      }
      console.log(`lyric("${escaped}", ${beat}, "${tag}"),${annotation}`);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
