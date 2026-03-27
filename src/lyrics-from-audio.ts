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

import { execSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WHISPER_CLI = resolve(__dirname, "../node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli");
const MODEL = resolve(__dirname, "../node_modules/nodejs-whisper/cpp/whisper.cpp/models/ggml-base.en.bin");

const audioFile = process.argv[2];
const bpm = parseFloat(process.argv[3]);
const tag = process.argv[4] ?? "Lead Vocal";
const MIN_CONFIDENCE = 0.5;

if (!audioFile || !bpm) {
  console.error("Usage: npx tsx src/lyrics-from-audio.ts <audio-file> <bpm> [tag]");
  process.exit(1);
}

if (!existsSync(WHISPER_CLI)) {
  console.error(`whisper-cli not found at ${WHISPER_CLI}`);
  console.error("Build it: cd node_modules/nodejs-whisper/cpp/whisper.cpp && cmake -B build && cmake --build build");
  process.exit(1);
}

function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds / 60) * bpm;
}

function quantize(beats: number, grid: number = 0.25): number {
  return Math.round(beats / grid) * grid;
}

interface Word {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

interface Phrase {
  text: string;
  startMs: number;
  avgConfidence: number;
  lowConfidenceWords: string[];
}

async function main() {
  const absAudio = resolve(audioFile);
  const outBase = `/tmp/clickbait-whisper-${Date.now()}`;

  console.error(`Transcribing ${absAudio} at ${bpm} BPM, tag="${tag}"...`);

  execSync(
    `"${WHISPER_CLI}" -m "${MODEL}" -f "${absAudio}" --output-json-full -ml 1 -of "${outBase}"`,
    { stdio: ["pipe", "pipe", "pipe"] }
  );

  const jsonPath = outBase + ".json";
  const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
  unlinkSync(jsonPath);

  // Extract words with confidence scores
  const words: Word[] = [];

  for (const segment of data.transcription ?? []) {
    const text = (segment.text ?? "").trim();
    if (!text || text.startsWith("[")) continue;

    // Get confidence from the first token in the segment
    const token = segment.tokens?.[0];
    const confidence = token?.p ?? 0;

    words.push({
      text,
      startMs: segment.offsets?.from ?? 0,
      endMs: segment.offsets?.to ?? 0,
      confidence,
    });
  }

  console.error(`Got ${words.length} words (${words.filter(w => w.confidence < MIN_CONFIDENCE).length} low-confidence)`);

  // Group words into phrases
  const phrases: Phrase[] = [];
  let currentWords: Word[] = [];
  let phraseStartMs = 0;
  let lastEndMs = 0;

  for (const word of words) {
    const gapMs = word.startMs - lastEndMs;
    const gapBeats = secondsToBeats(gapMs / 1000, bpm);

    if (currentWords.length > 0 && (gapBeats > 1 || /[.!?]$/.test(currentWords[currentWords.length - 1].text))) {
      phrases.push(buildPhrase(currentWords, phraseStartMs));
      currentWords = [];
    }

    if (currentWords.length === 0) {
      phraseStartMs = word.startMs;
    }

    currentWords.push(word);
    lastEndMs = word.endMs;
  }

  if (currentWords.length > 0) {
    phrases.push(buildPhrase(currentWords, phraseStartMs));
  }

  // Output
  console.log(`// Lyrics from: ${audioFile}`);
  console.log(`// BPM: ${bpm}, Tag: ${tag}`);
  console.log(`// ${phrases.length} phrases (${phrases.filter(p => p.avgConfidence < MIN_CONFIDENCE).length} low-confidence)\n`);

  for (const phrase of phrases) {
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

function buildPhrase(words: Word[], startMs: number): Phrase {
  const avgConfidence = words.reduce((sum, w) => sum + w.confidence, 0) / words.length;
  const lowConfidenceWords = words
    .filter(w => w.confidence < MIN_CONFIDENCE)
    .map(w => `"${w.text}"(${Math.round(w.confidence * 100)}%)`);

  return {
    text: words.map(w => w.text).join(" "),
    startMs,
    avgConfidence,
    lowConfidenceWords,
  };
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
