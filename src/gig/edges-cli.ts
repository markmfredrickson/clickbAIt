/**
 * What was said around a song, and where the band plays (see edges.ts).
 *
 *   npx tsx src/gig/edges-cli.ts <phone video> <vocals.flac> <align.json> <out.json> [--board <board> --sync <sync.json>]
 *
 * The talk is Whisper on the vocal before its first sung word and after its
 * last, timed by the lyrics aligner. The band is the vocal's source (the board
 * over the video's span, or the phone's own sound) with the vocal taken out.
 *
 * Output, all in video seconds: { firstWord, lastWord, musicStart, musicEnd,
 * end, head: Phrase[], tail: Phrase[] }.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { edgePhrases, edgeWindows, levels, musicRuns, musicSpan, spokenText, STEP_S, type Aligned, type Phrase, type Window } from "./edges.js";
import { BIN, mediaSeconds } from "./media.js";
import { boardSpan, toVideoTime, type Sync } from "./timeline.js";

const args = process.argv.slice(2);
const [phone, vocals, alignFile, out] = args;
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const board = option("--board");
const syncFile = option("--sync");
if (!out || !board !== !syncFile) {
  console.error("usage: npx tsx src/gig/edges-cli.ts <phone video> <vocals.flac> <align.json> <out.json> [--board <board> --sync <sync.json>]");
  process.exit(1);
}
const sync: Sync | null = syncFile ? JSON.parse(readFileSync(syncFile, "utf8")) : null;
const aligned: Aligned = JSON.parse(readFileSync(alignFile, "utf8"));
const seconds = mediaSeconds(vocals);
const { head, tail } = edgeWindows(aligned, seconds);
const ALIGN_CLI = resolve(import.meta.dirname, "../authoring/desilence-align-cli.ts");
/** Shorter than this, there's no room for anyone to say anything. */
const MIN_S = 0.5;
const BAND_RATE = 8000;

const tmp = mkdtempSync(join(tmpdir(), "clickbait-edges-"));

/** Whisper for the words, the aligner for when they were said. */
function talk(name: string, w: Window): Phrase[] {
  if (w.end - w.start < MIN_S) return [];
  const wav = join(tmp, `${name}.wav`);
  execFileSync("ffmpeg", ["-v", "error", "-ss", String(w.start), "-to", String(w.end), "-i", vocals, "-ac", "1", "-ar", "16000", wav]);
  const heard = JSON.parse(execFileSync(BIN, ["transcribe", wav, "--model", "large-v3"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  const text = spokenText(heard.words);
  if (text === null) return [];
  writeFileSync(join(tmp, `${name}.txt`), text + "\n");
  const timed = join(tmp, `${name}.align.json`);
  const run = spawnSync("npx", ["tsx", ALIGN_CLI, wav, "--text", join(tmp, `${name}.txt`), "-o", timed], { encoding: "utf8" });
  // Words Whisper heard where the vocal has no voice at all are made up.
  if (run.status !== 0 && run.stderr.includes("no voiced chunks")) return [];
  // Talk is quieter than singing, and desilence can trim away too much of it to
  // fit the words; then the plain aligner times them over the whole window.
  if (run.status !== 0 && run.stderr.includes("target too long")) {
    execFileSync(BIN, ["align", wav, "--text", join(tmp, `${name}.txt`), "-o", timed], { stdio: ["ignore", "ignore", "ignore"] });
  } else if (run.status !== 0) throw new Error(`aligning the ${name} talk failed:\n${run.stderr}`);
  return edgePhrases(JSON.parse(readFileSync(timed, "utf8")).words, w, sync);
}

/** The vocal's source with the vocal subtracted, as mono samples. */
function band(): Float32Array {
  const source = board && sync ? (({ start, seconds }) => ["-ss", String(start), "-t", String(seconds), "-i", board])(boardSpan(sync, mediaSeconds(phone))) : ["-i", phone];
  const raw = execFileSync(
    "ffmpeg",
    [
      "-v", "error", ...source, "-i", vocals,
      "-filter_complex",
      "[0:a:0]aformat=sample_fmts=fltp:channel_layouts=stereo[s];[1:a:0]aformat=sample_fmts=fltp:channel_layouts=stereo,aeval=-val(0)|-val(1)[v];" +
        `[s][v]amix=inputs=2:duration=shortest:normalize=0,pan=mono|c0=0.5*c0+0.5*c1,aresample=${BAND_RATE}`,
      "-f", "f32le", "-",
    ],
    { maxBuffer: 1 << 30 },
  );
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
}

try {
  const runs = musicRuns(levels(band(), BAND_RATE), STEP_S, { start: head.end, end: tail.start });
  const music = musicSpan(runs, head.end, tail.start);
  const at = (s: number) => Math.round(toVideoTime(s, sync) * 1000) / 1000;
  const edges = {
    firstWord: at(head.end),
    lastWord: at(tail.start),
    musicStart: at(music.start),
    musicEnd: at(music.end),
    end: at(seconds),
    head: talk("head", head),
    tail: talk("tail", tail),
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(edges, null, 1) + "\n");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
