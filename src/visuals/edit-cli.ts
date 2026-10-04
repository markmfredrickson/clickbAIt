/**
 * Build an edited-footage scene: a song's video cut from the clips in its
 * `footage/`, as listed in `visuals/edit.json`.
 *
 *   npx tsx src/visuals/edit-cli.ts build <song dir>      split, then run the visuals package
 *   npx tsx src/visuals/edit-cli.ts split <song dir>      write visuals/shots/*.json, credits.json, package.json
 *   npx tsx src/visuals/edit-cli.ts shot shots/<name>.json         (a wireit task, run in visuals/)
 *   npx tsx src/visuals/edit-cli.ts credits credits.json           (a wireit task)
 *   npx tsx src/visuals/edit-cli.ts assemble edit.json             (a wireit task)
 *
 * `split` derives the per-shot files and the nested wireit package from the
 * edit; wireit then re-renders only the shots whose file or footage changed.
 * `assemble` writes `<slug>.visuals.mp4` (the gig file: picture plus the
 * edit's sound effects, which REAPER routes to the tracks channel) and
 * `<slug>.visuals-review.mp4` (the same with the band, for watching).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { SongManifestSchema } from "../manifest.js";
import { toSlug } from "../core/dsongl/slug.js";
import { readMedia } from "./media.js";
import { checkRules, credits, layout, prerollProblem, shotFiles, shotTiming, visualsPackage, type Edit, type ShotKind, type SoundCue } from "./edit.js";

const ff = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });
const probe = (file: string) => {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=r_frame_rate,codec_type:format=duration", "-of", "json", file]).toString());
  const v = j.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const [n, d] = String(v?.r_frame_rate ?? "30/1").split("/").map(Number);
  return { duration: Number(j.format.duration), fps: n / (d || 1) };
};
const writeIfChanged = (path: string, text: string) => {
  if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text);
};

/** The song a visuals folder belongs to: its manifest and slug. */
function songOf(songDir: string) {
  const name = readdirSync(songDir).find(f => f.endsWith(".song.json"));
  if (!name) throw new Error(`no .song.json in ${songDir}`);
  const manifest = SongManifestSchema.parse(JSON.parse(readFileSync(join(songDir, name), "utf8")));
  return { title: manifest.title, artist: manifest.artist, preRollBars: manifest.preRollBars, slug: toSlug([manifest.title, manifest.artist].filter(Boolean).join("-")) };
}

/** `visuals/edit.json`, with its clips filled in from the song's `footage/footage.json`. */
function readEdit(visualsDir: string): Edit {
  const e = JSON.parse(readFileSync(join(visualsDir, "edit.json"), "utf8")) as Edit;
  const media = readMedia(dirname(visualsDir));
  e.clips = {};
  for (const sec of e.sections) for (const s of sec.shots) {
    const r = media.clips[s.clip];
    if (!r) throw new Error(`edit.json uses clip "${s.clip}", which isn't in footage/footage.json (add it with \`npm run media -- add\`)`);
    e.clips[s.clip] = { file: `../${r.file}`, by: r.by, license: r.license, url: r.source.url as string | undefined };
  }
  return e;
}

/** Where a clip came from, for the credits' last line. */
function sourceName(url?: string): string | undefined {
  const host = url?.match(/^https?:\/\/(?:www\.)?([^/]+)/)?.[1];
  return host && ({ "pexels.com": "Pexels", "nps.gov": "the National Park Service", "freesound.org": "Freesound", "archive.org": "the Internet Archive", "loc.gov": "the Library of Congress" } as Record<string, string>)[host];
}

function split(songDir: string) {
  const visualsDir = join(songDir, "visuals");
  const e = readEdit(visualsDir);
  const song = songOf(songDir);

  const files = shotFiles(e);
  mkdirSync(join(visualsDir, "shots"), { recursive: true });
  for (const [path, text] of Object.entries(files)) writeIfChanged(join(visualsDir, path), text);
  // Shots no longer in the edit: their files and renders go.
  const keep = new Set(Object.keys(files).map(p => p.slice("shots/".length, -".json".length)));
  for (const f of readdirSync(join(visualsDir, "shots"))) if (!keep.has(f.replace(/\.json$/, ""))) rmSync(join(visualsDir, "shots", f));
  if (existsSync(join(visualsDir, ".shots"))) {
    for (const f of readdirSync(join(visualsDir, ".shots"))) if (f !== "credits.mp4" && !keep.has(f.replace(/\.mp4$/, ""))) rmSync(join(visualsDir, ".shots", f));
  }

  const used = layout(e).map(s => e.clips[s.clip].url);
  const via = [...new Set([...used, ...(e.sounds ?? []).map(c => c.url)].map(sourceName).filter((s): s is string => !!s))];
  writeIfChanged(join(visualsDir, "credits.json"), JSON.stringify({ title: song.title, artist: song.artist, sections: credits(e), via, ...e.output }, null, 1) + "\n");

  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const pkg = visualsPackage(e, { rel: relative(visualsDir, repo), slug: song.slug, audio: `../${song.slug}.opus` });
  writeIfChanged(join(visualsDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

  const shots = layout(e);
  console.error(`${shots.length} shots, ${(shots.at(-1)!.start + shots.at(-1)!.dur).toFixed(1)} s`);
  for (const w of checkRules(shots)) console.error(`warning: ${w}`);
}

interface ShotFile {
  clip: string;
  file: string;
  kind: ShotKind;
  from?: number;
  to?: number;
  anchor?: "start" | "center";
  speed?: number;
  night?: boolean;
  reverse?: boolean;
  push: "in" | "out" | "none";
  look: string[];
  saturation?: number;
  dur: number;
  width: number;
  height: number;
  fps: number;
}

const signal = (file: string, at: number, key: "YAVG" | "SATAVG") =>
  Number(
    execFileSync("ffmpeg", ["-v", "error", "-ss", String(at), "-i", file, "-vf", `scale=160:90,signalstats,metadata=print:key=lavfi.signalstats.${key}:file=-`, "-frames:v", "1", "-f", "null", "-"])
      .toString()
      .match(new RegExp(`${key}=([\\d.]+)`))?.[1] ?? 0,
  );

/**
 * Render one shot to `.shots/<name>.mp4`. A small trial render measures its
 * brightness and saturation after the look; a dark day shot gets a gamma lift
 * toward a mid grey, a dark night shot a smaller one, and a washed-out shot a
 * saturation lift toward its look's typical level. Then the full render.
 */
function shot(shotPath: string) {
  const s = JSON.parse(readFileSync(shotPath, "utf8")) as ShotFile;
  const out = join(".shots", shotPath.replace(/^.*\//, "").replace(/\.json$/, ".mp4"));
  mkdirSync(".shots", { recursive: true });
  const src = probe(s.file);
  const { start, speed } = shotTiming(s, src.duration);
  const fps = s.fps;
  const timing =
    speed >= 2
      ? [`tmix=frames=${Math.round(speed)}`, `framestep=${Math.round(speed)}`, `setpts=N/${src.fps}/TB`, `framerate=fps=${fps}`]
      : [`setpts=(PTS-STARTPTS)/${speed.toFixed(4)}`, Math.abs(src.fps - fps) > 0.5 || speed < 0.99 ? `framerate=fps=${fps}` : `fps=${fps}`];
  const closeUp = s.kind === "close";

  const render = (w: number, h: number, gamma: number, boost: number, file: string, preset: string) => {
    const n = Math.round(s.dur * fps);
    const z = s.push === "in" ? `1+0.07*on/${n}` : `1.07-0.07*on/${n}`;
    // Ken Burns renders at 1.5x and scales down, so the slow push doesn't step pixel by pixel.
    const frame =
      s.push === "none"
        ? [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`]
        : [`scale=${w * 1.5}:${h * 1.5}:force_original_aspect_ratio=increase`, `crop=${w * 1.5}:${h * 1.5}`, `zoompan=z='${z}':d=1:x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':s=${w}x${h}:fps=${fps}`];
    const g = gamma.toFixed(2);
    const look = s.look.some(f => f.includes("{gamma}")) ? s.look.map(f => f.replaceAll("{gamma}", g)) : [...(gamma !== 1 ? [`eq=gamma=${g}`] : []), ...s.look];
    const vf = [
      ...(s.reverse ? ["reverse"] : []),
      ...timing,
      ...frame,
      ...(boost > 1.01 ? [`eq=saturation=${boost.toFixed(2)}`] : []),
      ...look,
      ...(closeUp ? ["vignette=PI/4.2"] : []),
      `trim=duration=${s.dur.toFixed(3)}`,
      "setsar=1",
      "format=yuv420p",
    ].join(",");
    ff("-ss", start.toFixed(3), ...(s.reverse ? ["-t", (s.dur * speed + 0.3).toFixed(3)] : []), "-i", s.file, "-an", "-vf", vf, "-c:v", "libx264", "-preset", preset, "-crf", "18", file);
  };

  const trial = join(tmpdir(), `edit-trial-${process.pid}.mp4`);
  render(384, 216, 1, 1, trial, "ultrafast");
  const at = [0.25, 0.5, 0.75].map(f => s.dur * f);
  const y = at.map(t => signal(trial, t, "YAVG")).reduce((a, b) => a + b) / 3 / 255;
  const sat = at.map(t => signal(trial, t, "SATAVG")).reduce((a, b) => a + b) / 3;
  rmSync(trial);

  const TARGET = 0.45;
  let gamma = 1;
  if (s.night && y < 0.2) gamma = Math.min(2.0, Math.pow(0.24 / Math.max(y, 0.03), 0.8));
  else if (!s.night && y < TARGET - 0.05) gamma = Math.min(2.2, Math.pow(TARGET / Math.max(y, 0.05), 1.3));
  let boost = 1;
  if (!s.night && s.saturation && sat < s.saturation * 0.7) boost = Math.min(1.4, (s.saturation * 0.85) / Math.max(sat, 1));

  render(s.width, s.height, gamma, boost, out, "veryfast");
  console.error(`${out}: from ${start.toFixed(2)} s at ${speed.toFixed(2)}x, brightness ${y.toFixed(2)}, saturation ${sat.toFixed(1)}, gamma ${gamma.toFixed(2)}, boost ${boost.toFixed(2)}`);
}

/** Rolling credits: the list set in a browser as one tall picture, rolled up the frame. */
async function creditsRoll(path: string) {
  const c = JSON.parse(readFileSync(path, "utf8")) as { title: string; artist?: string; sections: { heading: string; names: string[] }[]; via: string[]; width: number; height: number; fps: number };
  const esc = (t: string) => t.replace(/[&<>]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);
  const u = c.height / 1080; // sizes are set for 1080 lines
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: #000; }
    body { width: ${c.width}px; color: #efe6d2; font-family: Baskerville, "Libre Baskerville", Georgia, serif; text-align: center; padding: ${80 * u}px 0 ${120 * u}px; }
    h1 { font-size: ${64 * u}px; font-weight: normal; letter-spacing: 0.12em; margin: 0; text-transform: uppercase; }
    .artist { font-size: ${34 * u}px; font-style: italic; margin: ${14 * u}px 0 ${110 * u}px; }
    h2 { font-size: ${24 * u}px; font-weight: normal; letter-spacing: 0.35em; text-transform: uppercase; color: #b9ab90; margin: ${90 * u}px 0 ${28 * u}px; }
    .name { font-size: ${36 * u}px; line-height: 1.55; }
    .via { font-size: ${26 * u}px; font-style: italic; color: #b9ab90; margin-top: ${110 * u}px; }
  </style></head><body>
    <h1>${esc(c.title)}</h1>${c.artist ? `<div class="artist">${esc(c.artist)}</div>` : ""}
    ${c.sections.map(s => `<h2>${esc(s.heading)}</h2>${s.names.map(n => `<div class="name">${esc(n)}</div>`).join("")}`).join("")}
    ${c.via.length ? `<div class="via">via ${esc(c.via.length > 1 ? `${c.via.slice(0, -1).join(", ")} and ${c.via.at(-1)}` : c.via[0])}</div>` : ""}
  </body></html>`;
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ channel: "chrome" });
  const png = join(tmpdir(), `edit-credits-${process.pid}.png`);
  try {
    const page = await browser.newPage({ viewport: { width: c.width, height: c.height } });
    await page.setContent(html);
    await page.screenshot({ path: png, fullPage: true });
  } finally {
    await browser.close();
  }
  const { height: tall } = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=height", "-of", "json=c=1", png]).toString()).streams[0];
  // A whole number of pixels a frame, about a screen every 8 s, so the roll doesn't shimmer.
  const step = Math.max(1, Math.round(c.height / 8 / c.fps));
  const dur = (c.height + tall) / (step * c.fps);
  mkdirSync(".shots", { recursive: true });
  ff(
    "-f", "lavfi", "-i", `color=black:s=${c.width}x${c.height}:r=${c.fps}:d=${dur.toFixed(3)}`,
    "-loop", "1", "-framerate", String(c.fps), "-i", png,
    "-filter_complex", `[0:v][1:v]overlay=x=0:y='${c.height}-n*${step}':shortest=1,fade=t=in:st=0:d=1,format=yuv420p[v]`,
    "-map", "[v]", "-t", dur.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", ".shots/credits.mp4",
  );
  rmSync(png);
  console.error(`.shots/credits.mp4: ${dur.toFixed(1)} s`);
}

/** One sound effect's chain, from input `i` to a stereo stream at its place in the edit. */
function soundChain(c: SoundCue, i: number): string {
  const from = c.from ?? 0;
  const parts = [`[${i}:a]aresample=48000`, "aformat=channel_layouts=stereo"];
  if (c.from !== undefined || c.to !== undefined) parts.push(`atrim=${from}${c.to !== undefined ? `:${c.to}` : ""}`, "asetpts=PTS-STARTPTS");
  if (c.loop) parts.push(`aloop=loop=-1:size=${Math.round(((c.to ?? 0) - from) * 48000)}`);
  if (c.dur !== undefined) parts.push(`atrim=0:${c.dur}`, "asetpts=PTS-STARTPTS");
  if (c.lowpass) parts.push(`lowpass=f=${c.lowpass}`);
  const len = c.dur ?? (c.to ?? 0) - from;
  if (c.fadeIn) parts.push(`afade=t=in:st=0:d=${c.fadeIn}`);
  if (c.fadeOut) parts.push(`afade=t=out:st=${(len - c.fadeOut).toFixed(3)}:d=${c.fadeOut}`);
  parts.push(`adelay=${Math.round(c.at * 1000)}:all=1`, `volume=${c.gainDb ?? 0}dB`);
  return parts.join(",");
}

function assemble(editPath: string) {
  const visualsDir = dirname(resolve(editPath));
  const e = readEdit(visualsDir);
  const song = songOf(dirname(visualsDir));
  const problem = prerollProblem(e, song.preRollBars);
  if (problem) throw new Error(problem);
  const shots = layout(e);
  const fps = e.output.fps;
  const xd = e.dissolve;
  const durs = shots.map(s => s.dur + xd);

  const inputs = [...shots.map(s => `.shots/${s.name}.mp4`), ".shots/credits.mp4"];
  let f = inputs.map((_, i) => `[${i}:v]settb=1/${fps},fps=${fps},format=yuv420p[n${i}];`).join("");
  let prev = "[n0]";
  let t = durs[0];
  for (let i = 1; i < shots.length; i++) {
    f += `${prev}[n${i}]xfade=transition=fade:duration=${xd}:offset=${(t - xd).toFixed(3)}[x${i}];`;
    t += durs[i] - xd;
    prev = `[x${i}]`;
  }
  // The song's cut fades in from and out to black; the credits roll after it, under the same film.
  f += `${prev}fade=t=in:st=0:d=1.5,fade=t=out:st=${(t - 4).toFixed(3)}:d=4[song];`;
  // The film chain ends in 4:4:4 (blend, noise); the gig copy goes back to 4:2:0,
  // which Macs decode in hardware, so REAPER can play it at the gig.
  f += `[song][n${shots.length}]concat=n=2:v=1:a=0,${e.film.join(",")},format=yuv420p[v];`;
  const total = t + probe(".shots/credits.mp4").duration;

  const sounds = e.sounds ?? [];
  const a0 = inputs.length;
  if (sounds.length) {
    f += sounds.map((c, k) => `${soundChain(c, a0 + k)}[s${k}];`).join("");
    f += `${sounds.map((_, k) => `[s${k}]`).join("")}amix=inputs=${sounds.length}:normalize=0:duration=longest,alimiter=limit=0.89:attack=5:release=80,apad=whole_dur=${total.toFixed(3)}[a]`;
  } else {
    f += `anullsrc=r=48000:cl=stereo,atrim=0:${total.toFixed(3)}[a]`;
  }
  const gig = `${song.slug}.visuals.mp4`;
  const review = `${song.slug}.visuals-review.mp4`;
  ff(
    ...inputs.flatMap(i => ["-i", i]),
    ...sounds.flatMap(c => ["-i", c.file]),
    "-filter_complex", f, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", gig,
  );
  // The review copy: the same picture, with the band under the sound effects.
  // The show track's mix starts at project time 0, which is the edit's time 0.
  const music = `../${song.slug}.opus`;
  ff(
    "-i", gig, "-i", music,
    "-filter_complex", `[1:a]aresample=48000,aformat=channel_layouts=stereo[m];[0:a][m]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89:attack=5:release=80[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", review,
  );
  console.error(`${gig} and ${review}: ${total.toFixed(1)} s (${t.toFixed(1)} s of song, then credits)`);
}

const [command, arg] = process.argv.slice(2);
if (command === "split" && arg) split(resolve(arg));
else if (command === "build" && arg) {
  split(resolve(arg));
  // Four shots at a time: each ffmpeg is already multi-threaded, and a Ken Burns
  // shot holds 1.5x frames in memory. No wireit cache: it keeps a second copy of
  // every output, gigabytes of video; fingerprints alone skip unchanged shots.
  const env = { ...process.env, WIREIT_PARALLEL: process.env.WIREIT_PARALLEL ?? "4", WIREIT_CACHE: "none" };
  const r = spawnSync("npm", ["run", "assemble"], { cwd: join(resolve(arg), "visuals"), stdio: "inherit", env });
  process.exit(r.status ?? 1);
} else if (command === "shot" && arg) shot(arg);
else if (command === "credits" && arg) await creditsRoll(arg);
else if (command === "assemble" && arg) assemble(arg);
else {
  console.error("usage: edit-cli.ts build <song dir> | split <song dir> | shot shots/<name>.json | credits credits.json | assemble edit.json");
  process.exit(1);
}
