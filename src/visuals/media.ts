/**
 * Footage for scenes: `media add` cuts a clip from a source and records where
 * it came from and under what license in the song's `media/media.json`.
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
} as const;
export type License = keyof typeof LICENSES;

const isLicense = (s: string): s is License => s in LICENSES;

export type Source =
  | { kind: "archive"; id: string }
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
export async function cutClip(input: string, out: string, span?: { start: number; end: number }): Promise<ClipInfo> {
  await run("ffmpeg", [
    "-v", "error", "-y",
    ...(span ? ["-ss", String(span.start), "-to", String(span.end)] : []),
    "-i", input,
    "-an", "-vf", "scale=-2:'min(ih,1080)'",
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-g", "5",
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
  added: string;
}
export type MediaFile = { clips: Record<string, MediaRecord & ClipInfo> };

export function readMedia(songDir: string): MediaFile {
  const path = join(songDir, "media", "media.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { clips: {} };
}

/** Download an Internet Archive item's video once, into `media/.sources/`. */
async function fetchArchive(songDir: string, id: string) {
  const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`archive.org: no item ${id} (${res.status})`);
  const meta = await res.json();
  if (!meta.metadata) throw new Error(`archive.org: no item ${id}`);
  const license = archiveLicense(meta.metadata);
  const files: { name: string; format?: string }[] = meta.files ?? [];
  const video = files.find((f) => f.format === "h.264") ?? files.find((f) => /mpeg4|h\.264/i.test(f.format ?? "")) ?? files.find((f) => /\.(mp4|mov|mpeg|ogv)$/i.test(f.name));
  if (!video) throw new Error(`archive.org: item ${id} has no video file`);

  const dir = join(songDir, "media", ".sources");
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

/** Cut a clip from `source` into `media/<name>.mp4` and record it in `media/media.json`. */
export async function addMedia(songDir: string, name: string, source: Source, span?: { start: number; end: number }): Promise<MediaRecord & ClipInfo> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`clip names are lowercase words with dashes: "${name}"`);
  const got =
    source.kind === "archive"
      ? await fetchArchive(songDir, source.id)
      : { local: source.file, license: source.license, title: undefined, source: { ...source, file: basename(source.file) } };

  mkdirSync(join(songDir, "media"), { recursive: true });
  const file = `media/${name}.mp4`;
  const info = await cutClip(got.local, join(songDir, file), span);
  const record: MediaRecord & ClipInfo = {
    file,
    source: got.source,
    in: span?.start ?? 0,
    out: span?.end ?? info.duration,
    license: got.license,
    ...(source.kind === "file" && source.by ? { by: source.by } : {}),
    ...(got.title ? { title: got.title } : {}),
    added: new Date().toISOString().slice(0, 10),
    ...info,
  };
  const media = readMedia(songDir);
  media.clips[name] = record;
  writeFileSync(join(songDir, "media", "media.json"), JSON.stringify(media, null, 2) + "\n");
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
