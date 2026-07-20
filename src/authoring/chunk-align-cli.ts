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
import { assignChunks, groupByChunk, type HeardWord } from "./chunk-align.js";

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
    console.error("usage: chunk-align-cli <stem.wav> --text <lyrics.txt> -o <out.align.json> [--model base.en]");
    process.exit(1);
  }
  const stem = resolve(stemArg);
  const lyricsPath = resolve(args[textIdx + 1]);
  const outPath = resolve(args[outIdx + 1]);
  const work = mkdtempSync(join(tmpdir(), "chunkalign-"));

  // 1. Chunk the stem.
  execFileSync(BIN, ["chunk", stem, "--out-dir", work], { stdio: ["ignore", "ignore", "inherit"] });
  const index: ChunkIndex = JSON.parse(readFileSync(join(work, "index.json"), "utf8"));
  console.error(`chunked into ${index.chunks.length} chunk(s)`);

  // 2. Whisper each chunk -> heard words tagged with their chunk index.
  const heard: HeardWord[] = [];
  for (const c of index.chunks) {
    const wav = join(work, c.file);
    execFileSync(BIN, ["transcribe", wav, "--model", model], { stdio: ["ignore", "ignore", "inherit"] });
    const words: { text: string }[] = JSON.parse(readFileSync(wav.replace(/\.wav$/, ".words.json"), "utf8")).words;
    for (const w of words) heard.push({ text: w.text, chunk: c.index });
  }
  console.error(`heard ${heard.length} rough words`);

  // 3. Published lyrics -> flat words carrying their line index + text.
  const rawLines = readFileSync(lyricsPath, "utf8").split("\n").map((l) => l.trim());
  const pubWords: { text: string; line: number }[] = [];
  const lineText: string[] = [];
  rawLines.forEach((line) => {
    if (!line) return;
    const li = lineText.push(line) - 1;
    for (const tok of line.split(/\s+/)) pubWords.push({ text: tok, line: li });
  });

  // 4. Match: which chunk each published word belongs to.
  const chunkOf = assignChunks(pubWords.map((w) => w.text), heard);
  const spans = groupByChunk(chunkOf);
  console.error(`assigned ${spans.length} chunk span(s) of lyrics`);

  // 5. wav2vec2-align each chunk's span within its own audio; offset to source.
  const timed: (AlignedWord | null)[] = new Array(pubWords.length).fill(null);
  for (const span of spans) {
    const chunk = index.chunks.find((c) => c.index === span.chunk)!;
    const wav = join(work, chunk.file);
    const spanText = pubWords.slice(span.from, span.to + 1).map((w) => w.text).join(" ");
    const outFile = join(work, `${chunk.index}.align.json`);
    execFileSync(BIN, ["align", wav, "--text", spanText, "-o", outFile, "--no-trim-silence"], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    const res: { words: AlignedWord[] } = JSON.parse(readFileSync(outFile, "utf8"));
    // Forced alignment returns one word per span token, in order -> map positionally.
    res.words.forEach((w, k) => {
      const pubIdx = span.from + k;
      if (pubIdx > span.to) return;
      const shift = (x: { startMs: number; endMs: number }) => ({ ...x, startMs: x.startMs + chunk.startMs, endMs: x.endMs + chunk.startMs });
      timed[pubIdx] = { ...shift(w), chars: w.chars.map(shift) };
    });
  }

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
}

run(process.argv.slice(2));
