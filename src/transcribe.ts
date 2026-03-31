/**
 * Whisper transcription module: audio → words → phrases with confidence.
 *
 * Pure utility functions (secondsToBeats, quantize, groupIntoPhrases) plus
 * the async transcribeAudio wrapper around whisper-cli.
 */

import { execFile as execFileCb } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Word, Phrase } from "./dsongl/index.js";

const execFile = promisify(execFileCb);
const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_WHISPER_CLI = resolve(
  __dirname,
  "../node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli",
);
const DEFAULT_MODEL = resolve(
  __dirname,
  "../node_modules/nodejs-whisper/cpp/whisper.cpp/models/ggml-base.en.bin",
);

// ── Pure utilities ──────────────────────────────────────────────

export function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds / 60) * bpm;
}

export function quantize(beats: number, grid: number = 0.25): number {
  return Math.round(beats / grid) * grid;
}

/**
 * Group words into phrases, splitting on:
 * - gaps longer than 1 beat (BPM-aware)
 * - sentence-ending punctuation on the previous word
 */
export function groupIntoPhrases(words: Word[], bpm: number): Phrase[] {
  const phrases: Phrase[] = [];
  let current: Word[] = [];
  let lastEndMs = 0;

  for (const word of words) {
    const gapMs = word.startMs - lastEndMs;
    const gapBeats = secondsToBeats(gapMs / 1000, bpm);

    if (
      current.length > 0 &&
      (gapBeats > 1 || /[.!?]$/.test(current[current.length - 1].text))
    ) {
      phrases.push(current);
      current = [];
    }

    current.push(word);
    lastEndMs = word.endMs;
  }

  if (current.length > 0) {
    phrases.push(current);
  }

  return phrases;
}

// ── Confidence enrichment ───────────────────────────────────────

const MIN_CONFIDENCE = 0.5;

export interface TranscriptionPhrase {
  words: Word[];
  text: string;
  startMs: number;
  avgConfidence: number;
  lowConfidenceWords: string[];
}

export function buildTranscriptionPhrase(
  words: Word[],
  minConfidence: number = MIN_CONFIDENCE,
): TranscriptionPhrase {
  const avgConfidence =
    words.reduce((sum, w) => sum + (w.confidence ?? 0), 0) / words.length;
  const lowConfidenceWords = words
    .filter((w) => (w.confidence ?? 0) < minConfidence)
    .map((w) => `"${w.text}"(${Math.round((w.confidence ?? 0) * 100)}%)`);

  return {
    words,
    text: words.map((w) => w.text).join(" "),
    startMs: words[0]?.startMs ?? 0,
    avgConfidence,
    lowConfidenceWords,
  };
}

// ── Whisper invocation ──────────────────────────────────────────

export interface TranscribeOptions {
  whisperCli?: string;
  model?: string;
}

/**
 * Run whisper-cli on an audio file and return word-level transcription.
 * Resolves the audio path, invokes the CLI, parses JSON output.
 */
export async function transcribeAudio(
  audioFile: string,
  options?: TranscribeOptions,
): Promise<Word[]> {
  const cli = options?.whisperCli ?? DEFAULT_WHISPER_CLI;
  const model = options?.model ?? DEFAULT_MODEL;

  if (!existsSync(cli)) {
    throw new Error(
      `whisper-cli not found at ${cli}\n` +
        "Build it: cd node_modules/nodejs-whisper/cpp/whisper.cpp && cmake -B build && cmake --build build",
    );
  }

  const absAudio = resolve(audioFile);
  const outBase = `/tmp/clickbait-whisper-${Date.now()}`;

  await execFile(cli, [
    "-m", model,
    "-f", absAudio,
    "--output-json-full",
    "-ml", "1",
    "-of", outBase,
  ]);

  const jsonPath = outBase + ".json";
  try {
    const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
    return extractWords(data);
  } finally {
    if (existsSync(jsonPath)) unlinkSync(jsonPath);
  }
}

/** Parse whisper JSON output into Word array. */
function extractWords(data: Record<string, unknown>): Word[] {
  const words: Word[] = [];
  const transcription = (data.transcription ?? []) as Array<{
    text?: string;
    offsets?: { from?: number; to?: number };
    tokens?: Array<{ p?: number }>;
  }>;

  for (const segment of transcription) {
    const text = (segment.text ?? "").trim();
    if (!text || text.startsWith("[")) continue;

    const token = segment.tokens?.[0];
    const confidence = token?.p ?? 0;

    words.push({
      text,
      startMs: segment.offsets?.from ?? 0,
      endMs: segment.offsets?.to ?? 0,
      confidence,
    });
  }

  return words;
}
