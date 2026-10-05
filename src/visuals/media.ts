/**
 * Footage for scenes: `media add` cuts a clip from a source and records where
 * it came from and under what license in the song's `footage/footage.json`.
 *
 * Only licenses that allow showing the clip at a paid gig are accepted, and
 * an unclear license is a refusal, never a guess. A clip goes into a scene
 * only through this record.
 */

import { execFile } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Licenses a clip may have, and whether each needs a credit. */
export const LICENSES = {
  "public-domain": { credit: false },
  cc0: { credit: false },
  "cc-by": { credit: true },
  "cc-by-sa": { credit: true },
  pexels: { credit: false },
  own: { credit: false },
  // The Library of Congress's statement for items it knows of no restrictions on.
  "no-known-restrictions": { credit: false },
} as const;
export type License = keyof typeof LICENSES;

const isLicense = (s: string): s is License => s in LICENSES;

export type Source =
  | { kind: "archive"; id: string }
  | { kind: "loc"; id: string }
  | { kind: "file"; file: string; url: string; license: License; by?: string };

export interface SourceFlags {
  /** The page the file came from, or "own" for footage you shot. */
  from?: string;
  license?: string;
  by?: string;
}

/** Seconds from "12.5", "5:10" or "1:02:03". */
export function parseTime(s: string): number {
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s)) throw new Error(`not a time: "${s}" (use seconds, m:ss or h:mm:ss)`);
  return s.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
}

/** The license an Internet Archive item is marked with, if it's one we accept. */
export function archiveLicense(metadata: { licenseurl?: string; [k: string]: unknown }): License {
  const url = metadata.licenseurl;
  if (!url) throw new Error("the item has no license marked; old films are often public domain, but that has to be stated, not assumed");
  if (/\/publicdomain\/zero\//.test(url)) return "cc0";
  if (/\/licenses\/publicdomain\/|\/publicdomain\/mark\//.test(url)) return "public-domain";
  const cc = url.match(/\/licenses\/([a-z-]+)\//);
  if (cc && isLicense(`cc-${cc[1]}`)) return `cc-${cc[1]}` as License;
  throw new Error(`the item's license (${cc ? cc[1] : url}) doesn't allow showing it at a paid gig`);
}

/** What `media add <source>` was given, checked before anything is downloaded. */
export function describeSource(source: string, flags: SourceFlags): Source {
  const archive = source.match(/^archive:(.+)$/) ?? source.match(/^https?:\/\/(?:www\.)?archive\.org\/details\/([^/?#]+)/);
  if (archive) return { kind: "archive", id: archive[1] };
  const loc = source.match(/^loc:(.+)$/) ?? source.match(/^https?:\/\/(?:www\.)?loc\.gov\/item\/([^/?#]+)/);
  if (loc) return { kind: "loc", id: loc[1] };

  const from = flags.from;
  if (!from) throw new Error(`say where ${source} came from: --from <page url>, or --from own for footage you shot`);
  if (from === "own") return { kind: "file", file: source, url: "own", license: "own", ...(flags.by ? { by: flags.by } : {}) };
  if (/^https?:\/\/(www\.)?pexels\.com\//.test(from)) {
    return { kind: "file", file: source, url: from, license: "pexels", ...(flags.by ? { by: flags.by } : {}) };
  }
  if (!flags.license) throw new Error(`what license is ${from} under? pass --license (${Object.keys(LICENSES).join(", ")})`);
  if (!isLicense(flags.license)) throw new Error(`${flags.license} isn't a license we accept; accepted: ${Object.keys(LICENSES).join(", ")}`);
  if (LICENSES[flags.license].credit && !flags.by) throw new Error(`${flags.license} requires a credit: pass --by <name>`);
  return { kind: "file", file: source, url: from, license: flags.license, ...(flags.by ? { by: flags.by } : {}) };
}

export interface ClipInfo {
  fps: number;
  width: number;
  height: number;
  duration: number;
}

async function probe(file: string): Promise<ClipInfo> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", file,
  ]);
  const j = JSON.parse(stdout);
  const [n, d] = String(j.streams[0].r_frame_rate).split("/").map(Number);
  return { fps: n / (d || 1), width: j.streams[0].width, height: j.streams[0].height, duration: Number(j.format.duration) };
}

/**
 * Cut `[start, end)` seconds of `input` into a working copy: video only, at
 * most 1080 lines, with a keyframe at least every 5 frames so a scene can seek
 * to any frame quickly.
 */
export interface Crop {
  w: number;
  h: number;
  x: number;
  y: number;
}

export async function cutClip(input: string, out: string, span?: { start: number; end: number }, opts: { crop?: Crop } = {}): Promise<ClipInfo> {
  const crop = opts.crop ? `crop=${opts.crop.w}:${opts.crop.h}:${opts.crop.x}:${opts.crop.y},` : "";
  await run("ffmpeg", [
    "-v", "error", "-y",
    ...(span ? ["-ss", String(span.start), "-to", String(span.end)] : []),
    "-i", input,
    "-an", "-vf", `${crop}scale=-2:'min(ih,1080)'`,
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-g", "5",
    // No camera timecode: an editor such as Resolve places a clip by it, and a cut's starts at 0.
    "-map_metadata", "-1", "-write_tmcd", "0",
    "-movflags", "+faststart", out,
  ]);
  return probe(out);
}

export interface MediaRecord {
  file: string;
  source: Record<string, unknown>;
  in: number;
  out: number;
  license: License;
  by?: string;
  title?: string;
  /** The part of the source's frame kept, when it was cropped. */
  crop?: Crop;
  added: string;
}
export type MediaFile = { clips: Record<string, MediaRecord & ClipInfo & { shots?: Shot[]; strikes?: number[] }> };

/**
 * A song's footage folder. Not `media/`: REAPER keeps the band's recordings
 * in `Media/`, and macOS folder names ignore case.
 */
export const FOOTAGE_DIR = "footage";
export const FOOTAGE_RECORD = join(FOOTAGE_DIR, "footage.json");
const recordPath = (songDir: string) => join(songDir, FOOTAGE_RECORD);

export function readMedia(songDir: string): MediaFile {
  const path = recordPath(songDir);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { clips: {} };
}

/** Download an Internet Archive item's video once, into `footage/.sources/`. */
async function fetchArchive(songDir: string, id: string) {
  const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`archive.org: no item ${id} (${res.status})`);
  const meta = await res.json();
  if (!meta.metadata) throw new Error(`archive.org: no item ${id}`);
  const license = archiveLicense(meta.metadata);
  const files: { name: string; format?: string }[] = meta.files ?? [];
  const video = files.find((f) => f.format === "h.264") ?? files.find((f) => /mpeg4|h\.264/i.test(f.format ?? "")) ?? files.find((f) => /\.(mp4|mov|mpeg|ogv)$/i.test(f.name));
  if (!video) throw new Error(`archive.org: item ${id} has no video file`);

  const dir = join(songDir, FOOTAGE_DIR, ".sources");
  mkdirSync(dir, { recursive: true });
  const local = join(dir, `${id}${extname(video.name)}`);
  if (!existsSync(local)) {
    const dl = await fetch(`https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(video.name)}`);
    if (!dl.ok || !dl.body) throw new Error(`archive.org: couldn't download ${video.name} (${dl.status})`);
    await pipeline(Readable.fromWeb(dl.body as any), createWriteStream(local));
  }
  return {
    local,
    license,
    title: meta.metadata.title as string | undefined,
    source: { kind: "archive", id, file: video.name, url: `https://archive.org/details/${id}`, licenseurl: meta.metadata.licenseurl },
  };
}

/** Cut a clip from `source` into `footage/<name>.mp4` and record it in `footage/footage.json`. */
export async function addMedia(songDir: string, name: string, source: Source, span?: { start: number; end: number }, opts: { crop?: Crop } = {}): Promise<MediaRecord & ClipInfo> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`clip names are lowercase words with dashes: "${name}"`);
  const got =
    source.kind === "archive"
      ? await fetchArchive(songDir, source.id)
      : source.kind === "loc"
        ? await fetchLoc(songDir, source.id)
        : { local: source.file, license: source.license, title: undefined, source: { ...source, file: basename(source.file) } };

  mkdirSync(join(songDir, FOOTAGE_DIR), { recursive: true });
  const file = `${FOOTAGE_DIR}/${name}.mp4`;
  const crop = opts.crop ?? (source.kind === "loc" ? await detectCrop(got.local) : undefined);
  const info = await cutClip(got.local, join(songDir, file), span, crop ? { crop } : {});
  const record: MediaRecord & ClipInfo = {
    file,
    source: got.source,
    in: span?.start ?? 0,
    out: span?.end ?? info.duration,
    license: got.license,
    ...(source.kind === "file" && source.by ? { by: source.by } : {}),
    ...(got.title ? { title: got.title } : {}),
    ...(opts.crop ? { crop: opts.crop } : {}),
    added: new Date().toISOString().slice(0, 10),
    ...info,
  };
  const media = readMedia(songDir);
  media.clips[name] = record;
  writeFileSync(recordPath(songDir), JSON.stringify(media, null, 2) + "\n");
  return record;
}

/** "m:ss", or "h:mm:ss" past an hour. */
export function formatTime(s: number): string {
  const t = Math.floor(s);
  const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60];
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export interface ContactSheet {
  tiles: { time: number; file: string }[];
}

/**
 * A tile every `every` seconds of `input` (a file or a URL), written to
 * `outDir` as JPEGs, an `index.html` that labels each with its time, and one
 * tiled `sheet.png`. For choosing in and out points by eye.
 */
export async function contactSheet(input: string, outDir: string, opts: { every: number; width?: number; title?: string }): Promise<ContactSheet> {
  const width = opts.width ?? 240;
  mkdirSync(outDir, { recursive: true });
  // fps keeps the last frame of each slot; rounding up makes tile k the frame at k * every.
  await run("ffmpeg", [
    "-v", "error", "-y", "-i", input,
    "-vf", `fps=1/${opts.every}:round=up,scale=${width}:-2`, "-start_number", "0", "-q:v", "3",
    join(outDir, "tile_%04d.jpg"),
  ], { maxBuffer: 64 * 1024 * 1024 });
  const tiles: ContactSheet["tiles"] = [];
  for (let k = 0; existsSync(join(outDir, `tile_${String(k).padStart(4, "0")}.jpg`)); k++) {
    tiles.push({ time: k * opts.every, file: `tile_${String(k).padStart(4, "0")}.jpg` });
  }
  if (tiles.length === 0) throw new Error(`no frames read from ${input}`);

  const cols = 10;
  await run("ffmpeg", [
    "-v", "error", "-y", "-start_number", "0", "-i", join(outDir, "tile_%04d.jpg"),
    "-vf", `tile=${cols}x${Math.ceil(tiles.length / cols)}:padding=4:color=gray`, "-frames:v", "1",
    join(outDir, "sheet.png"),
  ]);

  const title = opts.title ?? basename(input);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  writeFileSync(
    join(outDir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --bg: #111; --ink: #eee; --dim: #999; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--ink); font: 14px system-ui, sans-serif; }
  h1 { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
  p { color: var(--dim); margin: 0 0 16px; word-break: break-all; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(${width}px, 1fr)); gap: 8px; }
  figure { margin: 0; }
  img { width: 100%; display: block; }
  figcaption { color: var(--dim); font-variant-numeric: tabular-nums; padding-top: 2px; }
</style></head><body>
<h1>${esc(title)}</h1><p>${esc(input)} · a tile every ${opts.every} s</p>
<div class="grid">
${tiles.map((t) => `<figure><img src="${t.file}" loading="lazy"><figcaption>${formatTime(t.time)}</figcaption></figure>`).join("\n")}
</div></body></html>
`,
  );
  return { tiles };
}

export interface Shot {
  start: number;
  end: number;
}

/**
 * The shots in a clip: ffmpeg's scene-change score per frame, a cut wherever
 * it passes `threshold`. Cuts closer than a quarter second merge (old film
 * flickers), so a dissolve or a flash doesn't read as a run of cuts.
 */
export async function findShots(clip: string, threshold = 10): Promise<Shot[]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", clip, "-an", "-vf", `scdet=threshold=${threshold}`, "-f", "null", "-"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const cuts: number[] = [];
  for (const m of stderr.matchAll(/lavfi\.scd\.time: ([\d.]+)/g)) {
    const t = Number(m[1]);
    if (t < 0.1) continue;
    if (cuts.length && t - cuts[cuts.length - 1] < 0.25) continue;
    cuts.push(t);
  }
  const { duration } = await probe(clip);
  const starts = [0, ...cuts];
  return starts.map((start, i) => ({ start, end: starts[i + 1] ?? duration }));
}

/** Mean brightness (0–255) of every frame. */
async function frameBrightness(clip: string): Promise<{ fps: number; levels: number[] }> {
  const { fps } = await probe(clip);
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", clip, "-vf", "scale=32:24,format=gray", "-f", "rawvideo", "-"], {
    encoding: "buffer",
    maxBuffer: 512 * 1024 * 1024,
  });
  const px = 32 * 24;
  const levels: number[] = [];
  for (let i = 0; i + px <= stdout.length; i += px) {
    let sum = 0;
    for (let j = i; j < i + px; j++) sum += stdout[j];
    levels.push(sum / px);
  }
  return { fps, levels };
}

/**
 * Moments of impact: frames where the picture suddenly flares brighter than
 * the frames just before it, as sparks burst when a drop hammer lands. Each
 * strike is the frame of the jump; flares closer than 0.2 s are one strike.
 */
export async function findStrikes(clip: string, minRise = 25): Promise<number[]> {
  const { fps, levels } = await frameBrightness(clip);
  const rise = levels.map((v, n) => {
    const before = levels.slice(Math.max(0, n - 5), n).sort((a, b) => a - b);
    return before.length ? v - before[before.length >> 1] : 0;
  });
  const strikes: number[] = [];
  for (let n = 1; n < rise.length; n++) {
    const peak = rise[n] >= minRise && rise[n] >= rise[n - 1] && rise[n] >= (rise[n + 1] ?? 0);
    if (!peak) continue;
    const t = n / fps;
    if (strikes.length && t - strikes[strikes.length - 1] < 0.2) continue;
    strikes.push(t);
  }
  return strikes;
}

/** Find a clip's shots and strikes and keep them in its `footage/footage.json` record. */
export async function analyzeMedia(songDir: string, name: string): Promise<{ shots: Shot[]; strikes: number[] }> {
  const media = readMedia(songDir);
  const record = media.clips[name];
  if (!record) throw new Error(`no clip "${name}" in ${recordPath(songDir)}`);
  const file = join(songDir, record.file);
  const shots = await findShots(file);
  const strikes = await findStrikes(file);
  media.clips[name] = { ...record, shots, strikes };
  writeFileSync(recordPath(songDir), JSON.stringify(media, null, 2) + "\n");
  return { shots, strikes };
}

// ── The Library of Congress ──────────────────────────────────────────────────

/**
 * The license an LoC item's rights statement grants, if it's one we accept:
 * the Library's statements that it knows of no copyright or other
 * restrictions (its film collections) or believes the item is public domain
 * (Chronicling America's newspapers).
 */
export function locLicense(rights: string[] | string | undefined): License {
  const text = (Array.isArray(rights) ? rights.join(" ") : rights ?? "").replace(/<[^>]+>/g, " ");
  if (/not aware of any U\.S\. copyright or other restrictions/i.test(text)) return "no-known-restrictions";
  if (/believes that the newspapers .* are in the public domain or have no known copyright restrictions/i.test(text)) return "no-known-restrictions";
  throw new Error(`the item's rights statement doesn't say it's free to use: "${text.slice(0, 160).trim()}"`);
}

/** Download an LoC item's video once, into `footage/.sources/`. */
async function fetchLoc(songDir: string, id: string) {
  const res = await fetch(`https://www.loc.gov/item/${encodeURIComponent(id)}/?fo=json`);
  if (!res.ok) throw new Error(`loc.gov: no item ${id} (${res.status})`);
  const j = await res.json();
  const item = j.item ?? {};
  const license = locLicense(item.rights);
  const files: { mimetype?: string; url?: string }[] = (j.resources ?? []).flatMap((r: any) => (r.files ?? []).flat());
  const video = files.find((f) => f.mimetype === "video/mp4" && f.url);
  if (!video) throw new Error(`loc.gov: item ${id} has no mp4`);

  const dir = join(songDir, FOOTAGE_DIR, ".sources");
  mkdirSync(dir, { recursive: true });
  const local = join(dir, `loc-${id}.mp4`);
  if (!existsSync(local)) {
    const dl = await fetch(video.url!);
    if (!dl.ok || !dl.body) throw new Error(`loc.gov: couldn't download ${video.url} (${dl.status})`);
    await pipeline(Readable.fromWeb(dl.body as any), createWriteStream(local));
  }
  return {
    local,
    license,
    title: item.title as string | undefined,
    source: { kind: "loc", id, file: video.url, url: `https://www.loc.gov/item/${id}/`, rights: "no known restrictions (Library of Congress)" },
  };
}

// ── Matching footage between copies ──────────────────────────────────────────

/**
 * The picture inside any black bars (pillarbox or letterbox): the box most
 * keyframes agree on, so a dark scene or one bright frame doesn't move it.
 */
export async function detectCrop(file: string): Promise<Crop> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-skip_frame", "nokey", "-i", file, "-an", "-vf", "cropdetect=limit=24:round=2:reset=1:skip=0", "-f", "null", "-"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const all = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  if (!all.length) {
    const { width, height } = await probe(file);
    return { w: width, h: height, x: 0, y: 0 };
  }
  const counts = new Map<string, number>();
  for (const m of all) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  const box = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const [w, h, x, y] = box.slice(5).split(":").map(Number);
  return { w, h, x, y };
}

/** Small grayscale frames for comparing copies. */
interface Thumbs {
  /** Each frame normalized to mean 0, spread 1, so exposure differences between scans don't count. */
  frames: Float32Array[];
  /** Frames with almost no detail (black, a blank card): they match anything, so they don't count. */
  flat: boolean[];
}

const FLAT_SPREAD = 6;

async function thumbs(file: string, fps: number, crop?: Crop, window?: { start: number; length: number }): Promise<Thumbs> {
  const W = 32;
  const H = 24;
  const vf = `${crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` : ""}fps=${fps},scale=${W}:${H},format=gray`;
  const { stdout } = await run("ffmpeg", [
    "-v", "error",
    ...(window ? ["-ss", String(Math.max(0, window.start)), "-t", String(window.length)] : []),
    "-i", file, "-an", "-vf", vf, "-f", "rawvideo", "-",
  ], { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 });
  const px = W * H;
  const frames: Float32Array[] = [];
  const flat: boolean[] = [];
  for (let i = 0; i + px <= stdout.length; i += px) {
    const f = new Float32Array(px);
    let mean = 0;
    for (let j = 0; j < px; j++) mean += f[j] = stdout[i + j];
    mean /= px;
    let sd = 0;
    for (let j = 0; j < px; j++) sd += (f[j] -= mean) ** 2;
    sd = Math.sqrt(sd / px);
    for (let j = 0; j < px; j++) f[j] /= sd || 1;
    frames.push(f);
    flat.push(sd < FLAT_SPREAD);
  }
  return { frames, flat };
}

/**
 * Offset (in frames of `hay`) where `needle` matches best, by mean absolute
 * difference over the needle's detailed frames, searching offsets in `range`.
 */
function bestOffset(needle: Thumbs, hay: Thumbs, range: [number, number] = [0, Infinity]): number {
  const counted = needle.frames.map((_, k) => k).filter((k) => !needle.flat[k]);
  if (counted.length === 0) throw new Error("the clip has no detail to match on (all black or blank)");
  let best = Math.max(0, range[0]);
  let bestScore = Infinity;
  const last = Math.min(range[1], hay.frames.length - needle.frames.length);
  for (let o = Math.max(0, range[0]); o <= last; o++) {
    let score = 0;
    for (const k of counted) {
      const a = needle.frames[k];
      const b = hay.frames[o + k];
      for (let j = 0; j < a.length; j++) score += Math.abs(a[j] - b[j]);
      if (score >= bestScore) break;
    }
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

const COARSE_FPS = 8;
const FINE_FPS = 48;

const slice = (t: Thumbs, from: number, to: number): Thumbs => ({ frames: t.frames.slice(from, to), flat: t.flat.slice(from, to) });

/**
 * Where `clip` starts in `source`, another copy of the same film (a different
 * scan, size or frame rate). A coarse pass over the source, then a fine one
 * around the best match, both skipping the clip's black or blank frames.
 * `near` limits the search to `within` seconds of a time; pass
 * `sourceThumbs` to reuse the coarse pass across clips.
 */
export async function findSpan(
  clip: string,
  source: string,
  opts: { sourceCrop?: Crop; sourceThumbs?: Thumbs; near?: { time: number; within: number } } = {},
): Promise<number> {
  const clipCrop = await detectCrop(clip);
  const sourceCrop = opts.sourceCrop ?? (await detectCrop(source));
  const hay = opts.sourceThumbs ?? (await thumbs(source, COARSE_FPS, sourceCrop));
  const all = await thumbs(clip, COARSE_FPS, clipCrop);
  // Match on 6 s of the clip, starting at its first detailed frame.
  const lead = Math.max(0, all.flat.indexOf(false));
  const needle = slice(all, lead, lead + COARSE_FPS * 6);
  const range: [number, number] | undefined = opts.near
    ? [Math.floor((opts.near.time - opts.near.within) * COARSE_FPS), Math.ceil((opts.near.time + opts.near.within) * COARSE_FPS)]
    : undefined;
  const coarse = (bestOffset(needle, hay, range) - lead) / COARSE_FPS;

  // Fine pass on 2 s from the same detailed point, around the coarse match.
  const leadTime = lead / COARSE_FPS;
  const fineNeedle = slice(await thumbs(clip, FINE_FPS, clipCrop, { start: leadTime, length: 2 }), 0, FINE_FPS * 2);
  const from = Math.max(0, coarse + leadTime - 0.5);
  const fineHay = await thumbs(source, FINE_FPS, sourceCrop, { start: from, length: 1 + 2.5 });
  return from + bestOffset(fineNeedle, fineHay) / FINE_FPS - leadTime;
}

/**
 * Re-cut clips from a better copy of their film: find each clip's span in the
 * new source, cut it there (without the new copy's black bars), and record the
 * new source, keeping the old one as `replaces`.
 *
 * Clips cut from the same old source should all move by about the same
 * amount. One that moves by more than 30 s from the others' median is
 * searched again near where they put it, and the log says so.
 */
export async function upgradeMedia(
  songDir: string,
  names: string[],
  source: Source,
  log: (s: string) => void = () => {},
  opts: { near?: { time: number; within: number } } = {},
): Promise<void> {
  const got =
    source.kind === "archive"
      ? await fetchArchive(songDir, source.id)
      : source.kind === "loc"
        ? await fetchLoc(songDir, source.id)
        : { local: source.file, license: source.license, title: undefined, source: { ...source, file: basename(source.file) } };
  const crop = await detectCrop(got.local);
  log(`source ${basename(got.local)}: picture ${crop.w}x${crop.h} at ${crop.x},${crop.y}`);
  const sourceThumbs = await thumbs(got.local, COARSE_FPS, crop);

  const media = readMedia(songDir);
  const found = new Map<string, number>();
  for (const name of names) {
    const old = media.clips[name];
    if (!old) throw new Error(`no clip "${name}" in ${FOOTAGE_RECORD}`);
    found.set(name, await findSpan(join(songDir, old.file), got.local, { sourceCrop: crop, sourceThumbs, near: opts.near }));
  }

  const origin = (name: string) => JSON.stringify(media.clips[name].source.url ?? media.clips[name].source.id ?? "");
  for (const name of names) {
    const siblings = names.filter((n) => n !== name && origin(n) === origin(name));
    if (siblings.length < 2) continue;
    const shifts = siblings.map((n) => found.get(n)! - media.clips[n].in).sort((a, b) => a - b);
    const median = shifts[shifts.length >> 1];
    const shift = found.get(name)! - media.clips[name].in;
    if (Math.abs(shift - median) > 30) {
      const expected = media.clips[name].in + median;
      const again = await findSpan(join(songDir, media.clips[name].file), got.local, { sourceCrop: crop, sourceThumbs, near: { time: expected, within: 30 } });
      log(`${name}: matched at ${formatTime(found.get(name)!)}, but the clips beside it put it near ${formatTime(expected)}; searched there and found ${formatTime(again)}`);
      found.set(name, again);
    }
  }

  for (const name of names) {
    const old = media.clips[name];
    const start = found.get(name)!;
    const length = old.out - old.in;
    const info = await cutClip(got.local, join(songDir, old.file), { start, end: start + length }, { crop });
    const shots = await findShots(join(songDir, old.file));
    const strikes = await findStrikes(join(songDir, old.file));
    media.clips[name] = {
      ...old,
      source: got.source,
      in: start,
      out: start + length,
      license: got.license,
      ...(got.title ? { title: got.title } : {}),
      replaces: { source: old.source, in: old.in, out: old.out },
      added: new Date().toISOString().slice(0, 10),
      ...info,
      shots,
      strikes,
    } as MediaFile["clips"][string];
    writeFileSync(recordPath(songDir), JSON.stringify(media, null, 2) + "\n");
    log(`${name}: ${formatTime(old.in)} in the old copy is ${formatTime(start)} (${start.toFixed(2)} s) in the new, ${info.width}x${info.height} at ${info.fps} fps`);
  }
}
