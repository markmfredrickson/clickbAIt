/**
 * Footage for a song's scene.
 *
 *   npm run media -- add <source> --song <manifest> --name <clip> [--in 5:00 --out 5:10]
 *                        [--from <page url> | --from own] [--license <id>] [--by <name>]
 *   npm run media -- sheet <source> [--every 5] [--out <dir>]
 *   npm run media -- analyze <clip>... --song <manifest>
 *   npm run media -- upgrade <clip>... --to <source> --song <manifest> [--near t]
 *
 * <source> is an Internet Archive item (`archive:<id>` or its archive.org URL)
 * or a file you downloaded or shot. `add` cuts the clip into the song's
 * `footage/` and records its source and license in `footage/footage.json`. `sheet`
 * makes a contact sheet for picking in and out points. `analyze` finds each
 * clip's shots (cuts) and strikes (sudden flares, like a hammer landing) and
 * records them, for scenes to cut on. `upgrade` re-cuts clips from a better copy of
 * their film (a sharper scan), finding each clip in it by matching frames.
 */

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { tmpdir } from "node:os";
import { addMedia, analyzeMedia, archiveLicense, contactSheet, describeSource, formatTime, parseTime, upgradeMedia } from "./media.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    song: { type: "string" },
    name: { type: "string" },
    in: { type: "string" },
    out: { type: "string" },
    from: { type: "string" },
    license: { type: "string" },
    by: { type: "string" },
    every: { type: "string", default: "5" },
    to: { type: "string" },
    near: { type: "string" },
  },
});
const [command, source] = positionals;
const usage = () => {
  console.error("usage: npm run media -- add <source> --song <manifest> --name <clip> [--in t --out t] [--from url|own] [--license id] [--by name]");
  console.error("       npm run media -- sheet <source> [--every 5] [--out dir]");
  console.error("       npm run media -- analyze <clip>... --song <manifest>");
  console.error("       npm run media -- upgrade <clip>... --to <source> --song <manifest> [--near t]");
  process.exit(1);
};
if (!command || !source) usage();

if (command === "add") {
  if (!values.song || !values.name) usage();
  const song = statSync(resolve(values.song!)).isDirectory() ? resolve(values.song!) : dirname(resolve(values.song!));
  const src = describeSource(source, { from: values.from, license: values.license, by: values.by });
  if (src.kind === "file" && !existsSync(src.file)) throw new Error(`no file at ${src.file}`);
  const span = values.in || values.out ? { start: parseTime(values.in ?? "0"), end: parseTime(values.out ?? "99:59:59") } : undefined;
  const record = await addMedia(song, values.name!, src, span);
  console.error(`${record.file}: ${record.duration.toFixed(1)} s, ${record.width}x${record.height} at ${record.fps} fps, ${record.license}`);
} else if (command === "analyze") {
  if (!values.song) usage();
  const song = statSync(resolve(values.song!)).isDirectory() ? resolve(values.song!) : dirname(resolve(values.song!));
  for (const name of positionals.slice(1)) {
    const { shots, strikes } = await analyzeMedia(song, name);
    console.error(`${name}: ${shots.length} shots, ${strikes.length} strikes${strikes.length ? " at " + strikes.map((t) => t.toFixed(2)).join(" ") : ""}`);
  }
} else if (command === "upgrade") {
  if (!values.song || !values.to) usage();
  const song = statSync(resolve(values.song!)).isDirectory() ? resolve(values.song!) : dirname(resolve(values.song!));
  const src = describeSource(values.to!, { from: values.from, license: values.license, by: values.by });
  // --near t: search only within 30 s of t in the new copy, when a clip is hard to place.
  const near = values.near ? { time: parseTime(values.near), within: 30 } : undefined;
  await upgradeMedia(song, positionals.slice(1), src, (s) => console.error(s), { near });
} else if (command === "sheet") {
  let input = source;
  let title = source;
  const archive = describeSource(source, { from: "own" });
  if (archive.kind === "archive") {
    // Read straight from archive.org: ffmpeg fetches only what it decodes.
    const meta = await (await fetch(`https://archive.org/metadata/${encodeURIComponent(archive.id)}`)).json();
    const video = (meta.files ?? []).find((f: any) => f.format === "h.264") ?? (meta.files ?? []).find((f: any) => /\.mp4$/i.test(f.name));
    if (!video) throw new Error(`archive.org: item ${archive.id} has no mp4`);
    input = `https://archive.org/download/${encodeURIComponent(archive.id)}/${encodeURIComponent(video.name)}`;
    let license: string;
    try {
      license = archiveLicense(meta.metadata);
    } catch (e) {
      license = `NOT USABLE: ${(e as Error).message}`;
    }
    title = `${meta.metadata.title ?? archive.id} (${archive.id}) · ${license}`;
  }
  const out = values.out ? resolve(values.out) : join(tmpdir(), "clickbait-sheets", source.replace(/[^a-z0-9]+/gi, "-"));
  const sheet = await contactSheet(input, out, { every: Number(values.every), title });
  console.error(`${sheet.tiles.length} tiles, every ${values.every} s, to ${formatTime(sheet.tiles.at(-1)!.time)}: ${join(out, "index.html")}`);
  if (process.platform === "darwin") execFile("open", ["-a", "Google Chrome", join(out, "index.html")]);
} else {
  usage();
}
