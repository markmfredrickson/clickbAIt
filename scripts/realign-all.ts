/**
 * realign-all — re-run desilence-concatenate alignment across the catalog.
 *
 *   npm run realign-all              # every alignable song
 *   npm run realign-all -- <filter>  # only paths matching <filter>
 *
 * Two discovery passes:
 *   1. MANIFEST-driven — every `*.song.json`. The vocal audio is the declared
 *      stem, or (KV multitrack, no demucs split) the lead-vocal track next to the
 *      manifest's `lyrics.alignment.file`. Lyrics come from `<slug>.lyrics.txt`
 *      or, failing that, the arranged manifest lines. Output = alignment.file.
 *   2. STEM-driven — dirs with a vocal stem but NO manifest (the pre-manifest
 *      catalog): align the stem against the dir's `*.lyrics.txt`, co-located out.
 *
 * Regenerates each align.json with desilence-align (+ a `.desilence.json` map).
 * Skips anything with no vocal audio or no lyrics. Prints a coverage summary.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { tmpdir } from "node:os";

const filter = process.argv[2];
const root = process.cwd();
const find = (args: string[]) =>
  execFileSync("find", args, { encoding: "utf8" }).trim().split("\n").filter(Boolean).filter((p) => !p.includes("/.wireit/"));

type Job = { song: string; audio: string; lyrics: string; out: string; note: string };
type Row = { song: string; status: "ok" | "skip" | "FAIL"; detail: string };
const jobs: Job[] = [];
const rows: Row[] = [];
const dirsWithManifest = new Set<string>();

/** Lyrics text for a manifest: its <slug>.lyrics.txt, else the arranged lines
 *  flattened to a temp file. Returns the path, or null if there are no lyrics. */
function lyricsFor(dir: string, slug: string, manifest: any): string | null {
  const onDisk = join(dir, `${slug}.lyrics.txt`);
  if (existsSync(onDisk)) return onDisk;
  const text = (manifest.sections ?? []).flatMap((s: any) => (s.lines ?? []).map((l: any) => l.text)).join("\n");
  if (text.trim().split("\n").filter(Boolean).length < 3) return null;
  const tmp = join(tmpdir(), `${slug}.realign.lyrics.txt`);
  writeFileSync(tmp, text);
  return tmp;
}

// ── 1. manifest-driven ─────────────────────────────────────────────────────
for (const mPath of find(["songs", "-name", "*.song.json"]).filter((m) => !filter || m.includes(filter)).sort()) {
  const dir = dirname(mPath);
  const slug = basename(mPath, ".song.json");
  const song = mPath.replace(/^songs\//, "").replace(/\.song\.json$/, "");
  dirsWithManifest.add(dir);
  let m: any;
  try { m = JSON.parse(readFileSync(mPath, "utf8")); } catch { rows.push({ song, status: "skip", detail: "unreadable manifest" }); continue; }
  const alignRel = m.lyrics?.alignment?.file;
  if (!alignRel) { rows.push({ song, status: "skip", detail: "no lyrics.alignment.file" }); continue; }
  const out = join(dir, alignRel);
  // vocal audio: declared stem, else the lead-vocal track beside the align file (KV)
  const vocals = m.sources?.stems?.files?.vocals;
  const stemPath = vocals ? join(dir, m.sources.stems.dir ?? "stems/", vocals) : null;
  let audio: string | undefined;
  let note = "";
  if (stemPath && existsSync(stemPath)) {
    audio = stemPath;
  } else {
    const base = join(dir, alignRel.replace(/\.align\.json$/, ""));
    audio = [".mp3", ".wav", ".m4a"].map((e) => base + e).find(existsSync);
    note = audio ? "KV" : "";
  }
  if (!audio) { rows.push({ song, status: "skip", detail: "no vocal audio" }); continue; }
  const lyrics = lyricsFor(dir, slug, m);
  if (!lyrics) { rows.push({ song, status: "skip", detail: "no lyrics" }); continue; }
  jobs.push({ song, audio, lyrics, out, note });
}

// ── 2. stem-driven fallback (pre-manifest dirs) ────────────────────────────
for (const stem of find(["songs", "-path", "*/stems/*_vocals.wav"]).filter((s) => !filter || s.includes(filter)).sort()) {
  const dir = dirname(dirname(stem));
  if (dirsWithManifest.has(dir)) continue; // already handled by its manifest
  const song = dir.replace(/^songs\//, "");
  const lyricsName = readdirSync(dir).find((f) => f.endsWith(".lyrics.txt"));
  if (!lyricsName) { rows.push({ song, status: "skip", detail: "no lyrics.txt (pre-manifest)" }); continue; }
  jobs.push({ song, audio: stem, lyrics: join(dir, lyricsName), out: stem.replace(/\.wav$/, ".align.json"), note: "pre-manifest" });
}

// ── run ────────────────────────────────────────────────────────────────────
for (const j of jobs) {
  process.stderr.write(`\n─── ${j.song}${j.note ? ` (${j.note})` : ""} ───\n`);
  try {
    execFileSync(
      "npx",
      ["tsx", "src/authoring/desilence-align-cli.ts", j.audio, "--text", j.lyrics, "-o", j.out, "--debug", j.out.replace(/\.align\.json$/, ".desilence.json")],
      { stdio: ["ignore", "ignore", "inherit"], cwd: root },
    );
    const a = JSON.parse(readFileSync(j.out, "utf8"));
    const first = a.words[0]?.startMs ?? 0;
    const last = a.words[a.words.length - 1]?.endMs ?? 0;
    rows.push({ song: j.song, status: "ok", detail: `${a.lines.length} lines, ${a.words.length} words, ${(first / 1000).toFixed(0)}–${(last / 1000).toFixed(0)}s${j.note ? ` [${j.note}]` : ""}` });
  } catch (e) {
    rows.push({ song: j.song, status: "FAIL", detail: String((e as Error).message).split("\n")[0].slice(0, 70) });
  }
}

console.error("\n\n════════ REALIGN SUMMARY ════════");
for (const r of rows.sort((a, b) => a.song.localeCompare(b.song))) {
  const mark = r.status === "ok" ? "✓" : r.status === "FAIL" ? "✗" : "–";
  console.error(`  ${mark} ${r.song.padEnd(44)} ${r.status === "ok" ? "" : r.status + " "}${r.detail}`);
}
const ok = rows.filter((r) => r.status === "ok").length;
const skip = rows.filter((r) => r.status === "skip").length;
const fail = rows.filter((r) => r.status === "FAIL").length;
console.error(`\n${ok} realigned · ${skip} skipped · ${fail} failed  (of ${rows.length})`);
