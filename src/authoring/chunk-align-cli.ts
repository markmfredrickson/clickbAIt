/**
 * Chunked forced alignment (orchestrator).
 *
 *   npx tsx src/authoring/chunk-align-cli.ts <stem.wav> --text <lyrics.txt> -o <out.align.json>
 *
 * Pipeline: `chunk` the vocal stem on silence -> Whisper each chunk (base.en,
 * fast) for a rough transcript -> global-match the transcripts to the published
 * lyrics (assign each lyric word a chunk, disambiguating repeats) -> wav2vec2
 * force-align each chunk's lyric span within its bounded audio -> offset by the
 * chunk's source position and stitch into one align.json (drop-in for the
 * single-shot `align` output). See chunk-align.ts for the matcher.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { assignChunks, groupByChunk, normWord, type HeardWord } from "./chunk-align.js";

/** Whisper marks non-speech as "(whistling)" / "[Music]" and the like. A chunk
 *  whose only "words" are such annotations (or empty) is instrumental/bleed, not
 *  vocals — drop it so it can't receive lyric words. */
const isAnnotation = (t: string): boolean => /^[([]/.test(t.trim()) || normWord(t) === "";

const BIN = resolve(import.meta.dirname, "../../.claude/skills/clickbait/bin/clickbait-audio");

interface ChunkIndex {
  sampleRate: number;
  chunks: { index: number; file: string; startMs: number; endMs: number }[];
}
interface AlignedChar { text: string; startMs: number; endMs: number; confidence: number }
interface AlignedWord { text: string; startMs: number; endMs: number; confidence: number; chars: AlignedChar[] }
interface AlignedLine { text: string; startMs: number; endMs: number; wordRange: [number, number] }

function run(args: string[]): void {
  const stemArg = args.find((a) => !a.startsWith("-"));
  const textIdx = args.indexOf("--text");
  const outIdx = args.indexOf("-o") >= 0 ? args.indexOf("-o") : args.indexOf("--output");
  const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "base.en";
  if (!stemArg || textIdx < 0 || outIdx < 0) {
    console.error("usage: chunk-align-cli <stem.wav> --text <lyrics.txt> -o <out.align.json> [--model base.en] [--debug <chunks.json>]");
    process.exit(1);
  }
  const stem = resolve(stemArg);
  const lyricsPath = resolve(args[textIdx + 1]);
  const outPath = resolve(args[outIdx + 1]);
  // Optional debug artifact for the chunk inspector: every chunk's time range,
  // whether it was kept or dropped, its raw Whisper transcript, and the lyric
  // span the matcher assigned to it. Byproduct of the normal run — no re-work.
  const debugIdx = args.indexOf("--debug");
  const debugPath = debugIdx >= 0 ? resolve(args[debugIdx + 1]) : null;
  const work = mkdtempSync(join(tmpdir(), "chunkalign-"));

  // 1. Chunk the stem. Chunk params pass through for per-song tuning — dense,
  // continuous-vocal songs (e.g. Timber) need a higher --threshold / smaller
  // --min-silence-ms to split at soft inter-line dips instead of one huge chunk.
  const passThrough: string[] = [];
  for (const flag of ["--min-silence-ms", "--min-chunk-ms", "--pad-ms", "--threshold"]) {
    const idx = args.indexOf(flag);
    if (idx >= 0) passThrough.push(flag, args[idx + 1]);
  }
  execFileSync(BIN, ["chunk", stem, "--out-dir", work, ...passThrough], { stdio: ["ignore", "ignore", "inherit"] });
  const index: ChunkIndex = JSON.parse(readFileSync(join(work, "index.json"), "utf8"));
  console.error(`chunked into ${index.chunks.length} chunk(s)`);

  // 2. Whisper each chunk -> heard words. Drop chunks that transcribed to only
  // annotations/empty (instrumental or bleed) so they never receive lyric words.
  const heard: HeardWord[] = [];
  const lyricChunks: typeof index.chunks = [];
  const whisperByChunk = new Map<number, string>(); // raw transcript per chunk (for debug)
  const dropped = new Set<number>(); // chunks transcribed to annotations/empty
  for (const c of index.chunks) {
    const wav = join(work, c.file);
    execFileSync(BIN, ["transcribe", wav, "--model", model], { stdio: ["ignore", "ignore", "inherit"] });
    const words: { text: string }[] = JSON.parse(readFileSync(wav.replace(/\.wav$/, ".words.json"), "utf8")).words;
    whisperByChunk.set(c.index, words.map((w) => w.text).join(" "));
    const real = words.filter((w) => !isAnnotation(w.text));
    if (real.length === 0) {
      dropped.add(c.index); // non-lyric chunk — dropped
      continue;
    }
    for (const w of real) heard.push({ text: w.text, chunk: c.index });
    lyricChunks.push(c);
  }
  console.error(`heard ${heard.length} rough words in ${lyricChunks.length}/${index.chunks.length} lyric chunk(s)`);

  // 3. Published lyrics -> flat words carrying their line index + text.
  const rawLines = readFileSync(lyricsPath, "utf8").split("\n").map((l) => l.trim());
  const pubWords: { text: string; line: number }[] = [];
  const lineText: string[] = [];
  rawLines.forEach((line) => {
    if (!line) return;
    const li = lineText.push(line) - 1;
    for (const tok of line.split(/\s+/)) pubWords.push({ text: tok, line: li });
  });

  // 4. Match: which chunk each published word belongs to (duration-aware, so a
  // misheard line spreads across chunks by capacity instead of overflowing one).
  const chunkOf = assignChunks(
    pubWords.map((w) => w.text),
    heard,
    lyricChunks.map((c) => ({ index: c.index, durationMs: c.endMs - c.startMs })),
  );
  const spans = groupByChunk(chunkOf);
  console.error(`assigned ${spans.length} chunk span(s) of lyrics`);

  // 5. wav2vec2-align each chunk's span within its own audio; offset to source.
  const timed: (AlignedWord | null)[] = new Array(pubWords.length).fill(null);
  const assignedByChunk = new Map<number, string>(); // lyric span assigned per chunk (for debug)
  const alignFailed = new Set<number>();
  let failed = 0;
  for (const span of spans) {
    const chunk = index.chunks.find((c) => c.index === span.chunk)!;
    const wav = join(work, chunk.file);
    const spanText = pubWords.slice(span.from, span.to + 1).map((w) => w.text).join(" ");
    assignedByChunk.set(chunk.index, spanText);
    const outFile = join(work, `${chunk.index}.align.json`);
    let res: { words: AlignedWord[] };
    try {
      // Chunks are already tightly bounded (voiced segment + small pad), so the
      // align silence-trim is a no-op here (pad < trim margin) and would only add
      // risk — keep it off. The real boundary-word errors are chunk ASSIGNMENT
      // (see the matcher), not within-chunk silence.
      execFileSync(BIN, ["align", wav, "--text", spanText, "-o", outFile, "--no-trim-silence"], {
        stdio: ["ignore", "ignore", "inherit"],
      });
      res = JSON.parse(readFileSync(outFile, "utf8"));
    } catch {
      // A chunk that can't align (e.g. still too much text for its audio) is
      // skipped, not fatal — its words stay unaligned and get dropped in the
      // stitch. Logged so over-assignment is visible rather than silent.
      failed++;
      alignFailed.add(chunk.index);
      console.error(`  ! chunk ${chunk.index} failed to align (${span.to - span.from + 1} words) — skipped`);
      continue;
    }
    // Forced alignment returns one word per span token, in order -> map positionally.
    res.words.forEach((w, k) => {
      const pubIdx = span.from + k;
      if (pubIdx > span.to) return;
      const shift = (x: { startMs: number; endMs: number }) => ({ ...x, startMs: x.startMs + chunk.startMs, endMs: x.endMs + chunk.startMs });
      timed[pubIdx] = { ...shift(w), chars: w.chars.map(shift) };
    });
  }
  if (failed) console.error(`WARNING: ${failed} chunk(s) failed to align — those lines are missing from the output`);

  // 6. Stitch: flat words in published order + lines rebuilt from line membership.
  const words: AlignedWord[] = [];
  const wordLineOf: number[] = [];
  pubWords.forEach((pw, i) => {
    const t = timed[i];
    if (!t) return; // no chunk matched this word (rare) — drop rather than emit a bogus time
    words.push(t);
    wordLineOf.push(pw.line);
  });
  const lines: AlignedLine[] = [];
  for (let w = 0; w < words.length; ) {
    const li = wordLineOf[w];
    let e = w;
    while (e < words.length && wordLineOf[e] === li) e++;
    lines.push({
      text: lineText[li],
      startMs: words[w].startMs,
      endMs: words[e - 1].endMs,
      wordRange: [w, e - 1],
    });
    w = e;
  }

  writeFileSync(outPath, JSON.stringify({ words, lines }, null, 2));
  console.error(`wrote ${outPath}: ${words.length}/${pubWords.length} words, ${lines.length} lines`);

  // Debug artifact: every chunk in source-time order with its Whisper transcript
  // and the lyric span assigned to it (null for dropped/silence chunks). The
  // chunk inspector renders this over the audio; silence gaps are the spaces
  // between consecutive chunks.
  if (debugPath) {
    const debug = {
      stem: stem.split("/").pop(),
      sampleRate: index.sampleRate,
      chunks: index.chunks.map((c) => ({
        index: c.index,
        startMs: c.startMs,
        endMs: c.endMs,
        kind: dropped.has(c.index) ? "dropped" : "lyric",
        whisper: whisperByChunk.get(c.index) ?? "",
        assigned: assignedByChunk.get(c.index) ?? null,
        alignFailed: alignFailed.has(c.index),
      })),
    };
    writeFileSync(debugPath, JSON.stringify(debug, null, 2));
    console.error(`wrote ${debugPath}: ${debug.chunks.length} chunk(s) of debug`);
  }
}

run(process.argv.slice(2));
