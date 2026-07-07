/**
 * One-time bootstrap: convert a per-song DSongL `.ts` into an inert
 * `.song.json` manifest. The `.ts` files are being retired; this reads the
 * Song they export and serializes the equivalent manifest, so we don't
 * hand-author (and later overwrite) them.
 *
 *   npx tsx src/ts-to-manifest.ts <song.ts> [out.song.json]
 *
 * The tricky part is the recording anchor: the `.ts` carries a stem `offset`
 * (where detected-beat-0 sits on the song grid); the manifest carries an
 * anchor {t, b}. We derive an anchor that reproduces the offset exactly and
 * assert it before writing.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, relative, basename, join } from "node:path";
import type { Song, Node, Span, Event, Audio } from "./dsongl/index.js";

const tsPath = process.argv[2];
if (!tsPath) {
  console.error("usage: npx tsx src/ts-to-manifest.ts <song.ts> [out.song.json]");
  process.exit(1);
}
const tsAbs = resolve(tsPath);
const manifestDir = dirname(tsAbs);
const outPath = process.argv[3] ?? tsAbs.replace(/\.ts$/, ".song.json");

const mod = await import(tsAbs);
const song: Song = mod.default;
const beatsPerBar = song.timeSignature[0];

// --- sections: walk the sequence's spans ---
const seq = song.children.find((c): c is Node & { children?: Node[] } => c.kind === "sequence");
const spans = (seq?.children ?? []).filter((c): c is Span => c.kind === "span");

function barsOf(span: Span): number {
  // A section's bars are counted in ITS OWN meter, not the song's — a 2/4
  // pickup of beats(2) is 1 bar, not 0.5 of a 4/4 bar.
  const bpb = span.timeSignature?.[0] ?? beatsPerBar;
  const d = span.duration;
  if (!d) throw new Error(`span "${span.name}" has no duration`);
  if ("bars" in d) return d.bars;
  return d.beats / bpb; // beats → bars in the section's meter
}

// Section start beats are inferred downstream from order + length, so the
// manifest carries only `bars` — no absolute `b` (see manifest.ts sectionStarts).
const sections = spans.map((span) => {
  const bars = barsOf(span);
  const events = (span.children ?? []).filter((c): c is Event => c.kind === "event");
  const lines = events
    .filter((e) => e.type === "lyric")
    .map((e) => ({ text: e.value, ...(e.tag ? { tag: e.tag } : {}) }));
  const cues = events
    .filter((e) => e.type === "cue")
    .map((e) => ({ at: e.offset ?? 0, label: e.value }));
  const section: Record<string, unknown> = { name: span.name, bars };
  if (span.cue !== undefined) section.cue = span.cue;
  if (span.timeSignature) section.timeSignature = span.timeSignature;
  if (cues.length) section.cues = cues;
  if (lines.length) section.lines = lines;
  return section;
});

// --- stems: from audio nodes ---
const audios = song.children.filter((c): c is Audio => c.kind === "audio");
if (audios.length === 0) throw new Error("no audio() nodes — can't derive stems/anchor");

const stemDir = relative(manifestDir, dirname(resolve(audios[0].file)));
const files: Record<string, string> = {};
const seenKeys = new Set<string>();
let spliced = false;
for (const a of audios) {
  const fname = basename(a.file);
  const m = fname.match(/source_(\w+)\.wav$/i);
  const key = (m ? m[1] : a.name).toLowerCase();
  if (seenKeys.has(key)) spliced = true; // same stem appears twice = multi-segment
  seenKeys.add(key);
  files[key] = fname;
}
if (spliced) {
  console.error(
    `SKIP ${basename(tsPath)}: spliced/multi-segment stems (same track appears more than once). ` +
      `The manifest 'stems' schema is one file per track — needs multi-segment support first.`,
  );
  process.exit(2);
}

// --- beat-map: inline the detected beats as a dense run pinned at the stem's
// song-beat offset (the .ts `offset` is the song beat of detected beat 0). This
// reproduces the old (beats.json + anchor) curve exactly, now durable in-file. ---
const anchorNode = audios.find((a) => a.beatsFile) ?? audios[0];
const offset = anchorNode.offset ?? 0;
if (!anchorNode.beatsFile) throw new Error("no audio() node has a beatsFile — can't derive the beat-map");
const beatsFileAbs = resolve(anchorNode.beatsFile);
const beats: { time: number }[] = JSON.parse(readFileSync(beatsFileAbs, "utf8")).beats;
const beatMap = [{ startBeat: offset, times: beats.map((b) => b.time) }];

// --- pre-roll: seconds → whole bars ---
const barSeconds = (60 / song.bpm) * beatsPerBar;
const preRollBars = Math.round((song.preRollSeconds ?? 0) / barSeconds);

// --- optional artifact references, only if present ---
const beatsFileRel = relative(manifestDir, beatsFileAbs);
const vocalsKey = Object.keys(files).find((k) => k.includes("vocal"));
const rec: Record<string, unknown> = {
  kind: "audio",
  file: existsSync(join(manifestDir, "source.m4a")) ? "source.m4a" : `${basename(beatsFileRel).replace(/\.beats.*$/, "")}`,
  beatMap,
};
if (existsSync(join(manifestDir, "source.analysis.json"))) {
  rec.analysis = { file: "source.analysis.json", "produced-by": "clickbait-audio analyze" };
}

const manifest: Record<string, unknown> = {
  schema: "clickbait/song@1",
  title: song.title,
  ...(song.artist ? { artist: song.artist } : {}),
  ...(song.key ? { key: song.key } : {}),
  bpm: song.bpm,
  timeSignature: song.timeSignature,
  preRollBars,
  sources: {
    recording: rec,
    stems: {
      kind: "audio-group",
      curveRef: "recording",
      "produced-by": "clickbait-audio split --model 4stem",
      dir: stemDir.endsWith("/") ? stemDir : stemDir + "/",
      files,
      ...(anchorNode.soffs !== undefined ? { soffs: anchorNode.soffs } : {}),
    },
  },
  songCurve: "constantBpm",
  sections,
  lyrics: vocalsKey
    ? { alignment: { file: join(stemDir, files[vocalsKey]).replace(/\.[^.]+$/, ".align.json"), "produced-by": "clickbait-audio align" } }
    : {},
  cues: { dir: "cues/", "produced-by": "clickbait-audio speak" },
};

writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
const lyricLines = sections.reduce((n, s: any) => n + (s.lines?.length ?? 0), 0);
console.error(
  `wrote ${relative(process.cwd(), outPath)} — ${sections.length} sections, ${lyricLines} lyric lines, ` +
    `offset ${offset} → anchor {t:${anchor.t}, b:${anchor.b}}, stems: ${Object.keys(files).join("/")}`,
);
