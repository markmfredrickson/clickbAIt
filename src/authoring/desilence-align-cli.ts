/**
 * Desilence-concatenate forced alignment (orchestrator).
 *
 *   npx tsx src/authoring/desilence-align-cli.ts <stem.wav> --text <lyrics.txt> -o <out.align.json>
 *
 * The successor to the chunked matcher. Instead of transcribing each chunk with
 * Whisper and matching lyrics to chunks (the cascade-prone step), this:
 *
 *   1. `chunk` the vocal stem on silence → tight voiced segments + a source-time
 *      index. Uses a SMALL --pad-ms so segments hug the voiced content.
 *   2. Concatenate every segment into ONE dense wav, inserting a fixed silence
 *      GAP at each join (--join-gap-ms) — a clean, uniform boundary cue for CTC
 *      instead of two segments' pads butting together.
 *   3. `align` the FULL lyrics against that dense wav in ONE monotonic pass. No
 *      Whisper. Removing the silence removes the runway CTC drifts across; the
 *      single global alignment gets repeat ORDER for free (monotonic).
 *   4. Remap each word's timestamp from concat-time back to source-time through
 *      the segment table. Words only ever land inside segments (never the gaps),
 *      so it's a plain per-segment piecewise map.
 *
 * Drop-in: writes the same align.json schema as the binary `align` /
 * chunk-align-cli, so downstream (smooth/generate/lyrics-display) is unchanged.
 *
 * PROTOTYPE: the wav concat lives here in TS (reading `chunk`'s NNN.wav outputs).
 * If this approach wins, the concat + gap + map belong in the Rust binary (a
 * `desilence` command) where the audio I/O already is.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const BIN = resolve(import.meta.dirname, "../../.claude/skills/clickbait/bin/clickbait-audio");

interface ChunkEntry { index: number; file: string; start_ms: number; end_ms: number }
interface ChunkIndex { source: string; sample_rate: number; chunks: ChunkEntry[] }
interface AlignedChar { text: string; startMs: number; endMs: number; confidence: number }
interface AlignedWord { text: string; startMs: number; endMs: number; confidence: number; chars: AlignedChar[] }
interface AlignedLine { text: string; startMs: number; endMs: number; wordRange: [number, number] }

// --- minimal 16-bit PCM mono WAV I/O (matches hound's output) --------------
// Little-endian host assumed (arm64/x86). Reads any chunk WAV the binary wrote.
function readMonoInt16(path: string): { sampleRate: number; samples: Int16Array } {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`not a WAV: ${path}`);
  }
  let sampleRate = 0, bits = 0, channels = 0, dataOff = -1, dataLen = 0;
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataOff = body;
      dataLen = size;
    }
    p = body + size + (size & 1); // chunks are word-aligned
  }
  if (dataOff < 0) throw new Error(`no data chunk: ${path}`);
  if (bits !== 16 || channels !== 1) throw new Error(`expected 16-bit mono, got ${bits}-bit ${channels}ch: ${path}`);
  const n = Math.floor(dataLen / 2);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(dataOff + i * 2);
  return { sampleRate, samples: out };
}

function writeMonoInt16(path: string, samples: Int16Array, sampleRate: number): void {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).copy(buf, 44);
  writeFileSync(path, buf);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function run(args: string[]): void {
  const stemArg = args.find((a) => !a.startsWith("-"));
  const textIdx = args.indexOf("--text");
  const outIdx = args.indexOf("-o") >= 0 ? args.indexOf("-o") : args.indexOf("--output");
  if (!stemArg || textIdx < 0 || outIdx < 0) {
    console.error(
      "usage: desilence-align-cli <stem.wav> --text <lyrics.txt> -o <out.align.json> " +
        "[--pad-ms 40] [--join-gap-ms 100] [--threshold 0.08] [--skip from:to ...] [--debug <map.json>]",
    );
    process.exit(1);
  }
  const stem = resolve(stemArg);
  const lyricsPath = resolve(args[textIdx + 1]);
  const outPath = resolve(args[outIdx + 1]);
  const padMs = flag(args, "pad-ms") ?? "40"; // small: hug voiced content, protect onsets
  const joinGapMs = Number(flag(args, "join-gap-ms") ?? "100"); // inserted silence at each seam
  const threshold = flag(args, "threshold");
  const debugPath = flag(args, "debug") ? resolve(flag(args, "debug")!) : null;
  const work = mkdtempSync(join(tmpdir(), "desilence-"));

  // 1. Chunk on silence (small pad → tight segments). --min-silence-ms /
  // --min-chunk-ms / --threshold pass through for per-song tuning. --skip
  // from:to (source seconds, repeatable) passes through too: `chunk` forces
  // those ranges to silence BEFORE detection, so no segment forms there — a
  // clean pre-step for instrumental bleed the amplitude gate can't reject.
  const chunkArgs = ["chunk", stem, "--out-dir", work, "--pad-ms", padMs];
  for (const f of ["min-silence-ms", "min-chunk-ms"]) {
    const v = flag(args, f);
    if (v) chunkArgs.push(`--${f}`, v);
  }
  if (threshold) chunkArgs.push("--threshold", threshold);
  for (let i = 0; i < args.length; i++) if (args[i] === "--skip" && args[i + 1]) chunkArgs.push("--skip", args[i + 1]);
  execFileSync(BIN, chunkArgs, { stdio: ["ignore", "ignore", "inherit"] });
  const index: ChunkIndex = JSON.parse(readFileSync(join(work, "index.json"), "utf8"));
  const sr = index.sample_rate;
  if (index.chunks.length === 0) throw new Error("no voiced chunks — nothing to align");

  // 2. Concatenate every segment into one dense wav, inserting `joinGapMs` of
  // silence at each seam. Build the segment map (concat-time ↔ source-time) as
  // we go — each segment's audio is the source verbatim, so within a segment the
  // map is 1:1; the gaps are dead zones. (--skip regions are already gone —
  // `chunk` forced them to silence before detection, so they're not segments.)
  const gapSamples = Math.round((joinGapMs / 1000) * sr);
  const parts: Int16Array[] = [];
  const segMap: { sourceStartMs: number; sourceEndMs: number; concatStartMs: number; concatEndMs: number }[] = [];
  let cursor = 0; // running sample position in the concat
  index.chunks.forEach((c, i) => {
    const { samples } = readMonoInt16(join(work, c.file));
    if (i > 0) {
      parts.push(new Int16Array(gapSamples)); // silence seam
      cursor += gapSamples;
    }
    const concatStartMs = (cursor / sr) * 1000;
    parts.push(samples);
    cursor += samples.length;
    segMap.push({ sourceStartMs: c.start_ms, sourceEndMs: c.end_ms, concatStartMs, concatEndMs: (cursor / sr) * 1000 });
  });
  const total = parts.reduce((n, p) => n + p.length, 0);
  const concat = new Int16Array(total);
  let off = 0;
  for (const p of parts) { concat.set(p, off); off += p.length; }
  const concatWav = join(work, "concat.wav");
  writeMonoInt16(concatWav, concat, sr);
  const voicedS = segMap.reduce((s, g) => s + (g.sourceEndMs - g.sourceStartMs) / 1000, 0);
  console.error(
    `desilenced ${index.chunks.length} segment(s) → ${(total / sr).toFixed(1)}s dense wav ` +
      `(${voicedS.toFixed(1)}s voiced + ${((index.chunks.length - 1) * joinGapMs) / 1000}s seams)`,
  );

  // 3. One monotonic forced-alignment of the FULL lyrics against the dense wav.
  // --no-trim-silence: we already control the silence.
  const concatAlign = join(work, "concat.align.json");
  execFileSync(BIN, ["align", concatWav, "--text", lyricsPath, "-o", concatAlign, "--no-trim-silence"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  const aligned: { words: AlignedWord[]; lines: AlignedLine[] } = JSON.parse(readFileSync(concatAlign, "utf8"));

  // 4. Remap concat-time → source-time. A time inside segment i maps linearly to
  // its source span; a time in a seam clamps to the nearer segment edge.
  const remap = (t: number): number => {
    for (const s of segMap) {
      if (t < s.concatStartMs) return s.sourceStartMs; // before first / leading edge
      if (t <= s.concatEndMs) return s.sourceStartMs + (t - s.concatStartMs); // inside segment (1:1)
      // else t is past this segment — if it's before the next segment's start,
      // it's in the seam; clamp to this segment's source end.
      const next = segMap[segMap.indexOf(s) + 1];
      if (!next || t < next.concatStartMs) {
        if (!next) return s.sourceEndMs; // past the last segment
        // seam: snap to whichever edge is closer in concat-time
        return t - s.concatEndMs < next.concatStartMs - t ? s.sourceEndMs : next.sourceStartMs;
      }
    }
    return segMap[segMap.length - 1].sourceEndMs;
  };
  const shift = <T extends { startMs: number; endMs: number }>(x: T): T => ({
    ...x,
    startMs: remap(x.startMs),
    endMs: remap(x.endMs),
  });

  const words: AlignedWord[] = aligned.words.map((w) => ({ ...shift(w), chars: w.chars.map(shift) }));
  // Rebuild each line's span from its remapped words (text + wordRange kept).
  const lines: AlignedLine[] = aligned.lines.map((l) => ({
    ...l,
    startMs: words[l.wordRange[0]]?.startMs ?? l.startMs,
    endMs: words[l.wordRange[1]]?.endMs ?? l.endMs,
  }));

  writeFileSync(outPath, JSON.stringify({ words, lines }, null, 2));
  console.error(`wrote ${outPath}: ${words.length} words, ${lines.length} lines`);

  if (debugPath) {
    writeFileSync(debugPath, JSON.stringify({ source: index.source, sampleRate: sr, joinGapMs, padMs: Number(padMs), segments: segMap }, null, 2));
    console.error(`wrote ${debugPath}: ${segMap.length} segment(s) of map`);
  }
}

run(process.argv.slice(2));
