/**
 * realign-all — re-run desilence-concatenate alignment across the catalog.
 *
 *   npm run realign-all              # every dir with a vocal stem + lyrics.txt
 *   npm run realign-all -- <filter>  # only paths matching <filter>
 *
 * Discovers by STEM (the vocal stem (stems/…_vocals.wav)), so it covers both manifested songs
 * and the pre-manifest catalog. For each: finds the dir's `*.lyrics.txt`, picks
 * the output path (the manifest's `lyrics.alignment.file` if a manifest exists,
 * else co-located `<stem>.align.json`), and regenerates it with desilence-align
 * (+ a `.desilence.json` map). Skips dirs with no `*.lyrics.txt`. KV multitrack
 * (`lead-vocal.wav`, no `*_vocals.wav`) is not matched, so it's left alone.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";

const filter = process.argv[2];
const root = process.cwd();
const stemPaths = execFileSync("find", ["songs", "-path", "*/stems/*_vocals.wav"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((s) => !s.includes("/.wireit/"))
  .filter((s) => !filter || s.includes(filter))
  .sort();

type Row = { song: string; status: "ok" | "skip" | "FAIL"; detail: string };
const rows: Row[] = [];

for (const stem of stemPaths) {
  const dir = dirname(dirname(stem)); // .../<song>/stems/x.wav -> .../<song>
  const song = dir.replace(/^songs\//, "");
  // lyrics.txt in the dir
  const lyricsName = readdirSync(dir).find((f) => f.endsWith(".lyrics.txt"));
  if (!lyricsName) { rows.push({ song, status: "skip", detail: "no *.lyrics.txt" }); continue; }
  const lyrics = join(dir, lyricsName);
  // output: manifest's alignment.file if a manifest exists, else co-located
  const manName = readdirSync(dir).find((f) => f.endsWith(".song.json"));
  let alignOut = stem.replace(/\.wav$/, ".align.json");
  if (manName) {
    try {
      const m = JSON.parse(readFileSync(join(dir, manName), "utf8"));
      if (m.lyrics?.alignment?.file) alignOut = join(dir, m.lyrics.alignment.file);
    } catch { /* fall back to co-located */ }
  }
  const map = alignOut.replace(/\.align\.json$/, ".desilence.json");
  process.stderr.write(`\n─── ${song}${manName ? "" : " (pre-manifest)"} ───\n`);
  try {
    execFileSync(
      "npx",
      ["tsx", "src/authoring/desilence-align-cli.ts", stem, "--text", lyrics, "-o", alignOut, "--debug", map],
      { stdio: ["ignore", "ignore", "inherit"], cwd: root },
    );
    const a = JSON.parse(readFileSync(alignOut, "utf8"));
    const first = a.words[0]?.startMs ?? 0;
    const last = a.words[a.words.length - 1]?.endMs ?? 0;
    rows.push({ song, status: "ok", detail: `${a.lines.length} lines, ${a.words.length} words, ${(first / 1000).toFixed(0)}–${(last / 1000).toFixed(0)}s${manName ? "" : " [pre-manifest]"}` });
  } catch (e) {
    rows.push({ song, status: "FAIL", detail: String((e as Error).message).split("\n")[0].slice(0, 70) });
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
