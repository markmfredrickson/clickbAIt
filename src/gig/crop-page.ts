/**
 * The crop picker: a page in `renders/crop/` for shaping each song's crop
 * curve (see follow.ts), framed on the band where it follows. Scrubbing the timeline shows the video with the box
 * the render will cut there; dragging, resizing or turning the box pins the
 * curve with a knot at that moment, and the curve is refitted around it. With
 * "follow the band" on, the curve starts from the people found (see
 * people.swift) and the camera's roll (see motion.ts), which the page measures
 * for any song that lacks them. Plots
 * under the timeline show zoom and turn, raw and smoothed. Copy the crops out
 * for gig.json; the page writes nothing back itself. A video that isn't 16:9,
 * such as one shot upright, is shown at its own shape with no box.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { DEFAULT_SMOOTH } from "./follow.js";
import type { Gig } from "./gig.js";
import { mediaSeconds } from "./media.js";
import { measureMotion, type MotionSample } from "./motion.js";
import { findPeople } from "./people.js";
import type { PeopleSample } from "./follow.js";

/**
 * follow.ts bundled for the browser, defining a global `Follow` with the
 * functions the page draws the curve with: the render's own code, not a copy.
 */
export function followBundle(): string {
  const { outputFiles } = buildSync({
    stdin: { contents: `export { bandNeed, cropPath, fitOnPicture } from "./follow.ts";`, resolveDir: import.meta.dirname, loader: "ts" },
    bundle: true, format: "iife", globalName: "Follow", platform: "browser", target: "es2020", write: false,
  });
  return outputFiles[0].text + "\nconst { bandNeed, cropPath, fitOnPicture } = Follow;";
}

export async function writeCropPage(gig: Gig): Promise<string> {
  const out = join(gig.dir, "renders/crop");
  mkdirSync(out, { recursive: true });
  const songs: unknown[] = [];
  for (const s of gig.songs) {
    const key = `${s.n}-${s.slug}`;
    const phone = join(gig.dir, s.phone);
    const start = s.cut.in ?? 0;
    const end = s.cut.out ?? mediaSeconds(phone);
    const [width, height] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", phone], { encoding: "utf8" })
      .trim()
      .split(",")
      .map(Number);
    const wide = Math.abs(width / height - 16 / 9) < 0.01;
    // The same file and format as the song's motion task writes.
    const motionFile = join(gig.dir, `work/${key}.motion.json`);
    let motion: MotionSample[] | null = null;
    if (wide) {
      if (existsSync(motionFile)) motion = JSON.parse(readFileSync(motionFile, "utf8")).samples;
      else {
        console.log(`measuring ${key}`);
        motion = await measureMotion(phone, start, end, 2);
        mkdirSync(join(gig.dir, "work"), { recursive: true });
        writeFileSync(motionFile, JSON.stringify({ rate: 2, samples: motion }) + "\n");
      }
    }
    // The same file and format as the song's people task writes.
    const peopleFile = join(gig.dir, `work/${key}.people.json`);
    let people: PeopleSample[] | null = null;
    if (wide) {
      if (existsSync(peopleFile)) people = JSON.parse(readFileSync(peopleFile, "utf8")).samples;
      else {
        console.log(`finding people in ${key}`);
        people = findPeople(phone, start, end, 2);
        writeFileSync(peopleFile, JSON.stringify({ rate: 2, samples: people }) + "\n");
      }
    }
    // Keyed boxes from before curves become knots on a curve that doesn't follow.
    const crop = !s.crop
      ? { follow: true, smooth: DEFAULT_SMOOTH, knots: [] }
      : Array.isArray(s.crop)
        ? { follow: false, smooth: DEFAULT_SMOOTH, knots: s.crop.map((k, i) => ({ at: i === 0 ? start : k.at, x: k.x, y: k.y, size: k.size, angle: k.angle ?? 0 })) }
        : s.crop;
    songs.push({
      key, start, end, width, height, wide, video: `../../${s.phone}`, crop, hasCrop: !!s.crop, defaultSmooth: DEFAULT_SMOOTH,
      // Compact: [t, angle, scale, dx, dy].
      motion: motion && motion.map((m) => [m.t, +m.angle.toFixed(4), +m.scale.toFixed(5), +m.dx.toFixed(5), +m.dy.toFixed(5)]),
      people: people && people.map((p) => [p.t, p.boxes]),
    });
  }
  const page = join(out, "index.html");
  writeFileSync(page, PAGE.replace("/*SONGS*/[]", () => JSON.stringify(songs)).replace("/*FOLLOW*/", () => followBundle()));
  return page;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crop Picker</title>
<style>
  :root { --bg: #f6f5f2; --fg: #1d1d1b; --muted: #6b6a66; --card: #fff; --line: #d9d7d0; --box: #e0412b; --r0: #c9d8e8; --r1: #e8dcc4; --r2: #cfe3cf; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ecebe6; --muted: #9a9892; --card: #222220; --line: #3a3936; --box: #ff6a50; --r0: #34465a; --r1: #5a4c33; --r2: #35503a; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 10px 16px; height: 100vh; overflow: hidden; background: var(--bg); color: var(--fg); font: 15px/1.4 system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; }
  .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
  .bar h1 { margin: 0; }
  .bar select { font: inherit; padding: 3px 6px; background: var(--card); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; }
  .bar .grow { flex: 1; }
  .help { position: relative; }
  .help summary { cursor: pointer; color: var(--muted); list-style: none; border: 1px solid var(--line); border-radius: 999px; padding: 1px 9px; }
  .help p { position: absolute; z-index: 10; right: 0; top: 28px; width: min(70ch, 90vw); background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin: 0; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lead { color: var(--muted); }
  .song { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: none; }
  .song.shown { display: block; }
  .song h2 { font-size: 16px; margin: 0 0 8px; }
  .frame { position: relative; width: min(100%, calc((100vh - 330px) * 16 / 9)); margin: 0 auto; overflow: hidden; user-select: none; touch-action: none; background: #000; }
  .pic { position: absolute; inset: 0; }
  .pic video, .pic canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .box { position: absolute; border: 2px solid var(--box); box-shadow: 0 0 0 9999px rgba(0,0,0,.45); cursor: move; }
  .box.locked { border-style: dashed; cursor: default; }
  .box.locked .h { display: none; }
  .h { position: absolute; width: 18px; height: 18px; background: var(--box); border-radius: 3px; }
  .h.tl { left: -9px; top: -9px; cursor: nwse-resize; } .h.br { right: -9px; bottom: -9px; cursor: nwse-resize; }
  .h.tr { right: -9px; top: -9px; cursor: nesw-resize; } .h.bl { left: -9px; bottom: -9px; cursor: nesw-resize; }
  .timeline { position: relative; height: 16px; margin-top: 8px; border-radius: 4px; overflow: hidden; cursor: pointer; touch-action: none; background: var(--line); }
  .gl { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(45deg, var(--card) 0 4px, transparent 4px 8px); opacity: .8; }
  .people { position: absolute; inset: 0; pointer-events: none; }
  .person { position: absolute; border: 1px solid rgba(120, 255, 140, .8); }
  .key input.strength { width: 70px; padding: 0; }
  .knot { position: absolute; top: 0; bottom: 0; width: 3px; margin-left: -1px; background: var(--box); }
  .plot { display: block; width: 100%; height: 80px; margin-top: 4px; cursor: grab; touch-action: none; }

  .box.pinned { border-width: 3px; }
  .playhead { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--box); pointer-events: none; }
  .now { font-size: 13px; color: var(--muted); margin-top: 4px; font-variant-numeric: tabular-nums; min-height: 1.4em; }
  .controls { display: grid; grid-template-columns: 90px 1fr auto; gap: 6px 10px; align-items: center; margin-top: 8px; font-size: 13px; }
  .controls label { color: var(--muted); }
  .num { font-variant-numeric: tabular-nums; min-width: 120px; text-align: right; }
  .onion { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; }
  .onion input[type=number] { width: 56px; font: inherit; font-size: 12px; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 4px; padding: 1px 3px; }
  .split { font: inherit; font-size: 13px; padding: 3px 12px; border: 0; border-radius: 999px; background: var(--box); color: #fff; cursor: pointer; }
  input[type=range].angle { width: 100%; }
  .keys { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; align-items: center; }
  .key { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 2px 4px 2px 10px; font-size: 13px; cursor: pointer; }
  .key[aria-selected="true"] { border-color: var(--fg); box-shadow: inset 0 0 0 1px var(--fg); }
  .key input { width: 56px; font: inherit; font-size: 12px; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 4px; padding: 1px 3px; }
  .key button, .add, .reset { font: inherit; font-size: 13px; padding: 2px 10px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--fg); cursor: pointer; }
  .key button { border: 0; padding: 0 6px; color: var(--muted); }
  .warn { color: var(--box); font-size: 13px; margin-top: 6px; min-height: 1em; }
  textarea { display: none; position: fixed; inset: 20% 10%; z-index: 20; height: 50vh; font: 12px/1.3 ui-monospace, monospace; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 6px; }
  .copy { font: inherit; font-size: 13px; padding: 4px 12px; border: 0; border-radius: 6px; background: var(--fg); color: var(--bg); cursor: pointer; }
</style>
</head>
<body>
<main>
  <div class="bar"><h1>Crop picker</h1><select id="pick" aria-label="Song"></select><span class="grow"></span><details class="help"><summary>?</summary><p class="lead">The box follows a smooth curve over the song. With "follow the band" on, the curve frames everyone found (thin green outlines), never tighter than the band needs, and turns with the camera so the picture stays level. Scrub the timeline to see the video with the box the render will cut there. Where it's wrong, drag the box or a corner, or turn it: that pins the curve with a knot at that moment (red tick). Each knot also shows in the lane under the timeline as a bell curve: drag it up to pull harder or down to only nudge, and sideways to make it reach over more of the song. On a trackpad, pinch on the picture to zoom the box and scroll with two fingers to move it. Press S to pin the curve where it is. "Smooth over" sets how slowly the curve changes. The plots show zoom and turn: faint for what the band and camera ask for, bold for the curve. Times are seconds into the phone's video. When you're done, copy the crops at the bottom.</p></details><button class="copy" id="copy" type="button">Copy crops</button></div>
  <div id="songs"></div>
</main>
<textarea id="json" readonly></textarea>
<script>
/*FOLLOW*/
const SONGS = /*SONGS*/[];
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const r3 = (v) => Math.round(v * 1000) / 1000;
// A knot dropped on the page holds a few seconds and pulls halfway; one in gig.json without these is a hard pin.
const NEW_KNOT = { width: 4, strength: 0.5 };
const fmt = (t) => { const m = Math.floor(t / 60); return m + ":" + (t - m * 60).toFixed(1).padStart(4, "0"); };
const state = {};

function output() {
  const out = {};
  for (const s of SONGS) {
    const st = state[s.key];
    // Every 16:9 song goes out, so ones left alone get the automatic framing.
    if (!st) continue;
    out[s.key] = { follow: st.follow, ...(st.smooth !== s.defaultSmooth ? { smooth: st.smooth } : {}), knots: [...st.knots].sort((a, b) => a.at - b.at).map((k) => ({ at: k.at, x: r3(k.x), y: r3(k.y), size: r3(k.size), angle: Math.round(k.angle * 10) / 10, width: k.width ?? 0, strength: k.strength ?? 1 })) };
  }
  document.getElementById("json").value = JSON.stringify(out, null, 1);
  store.set("crop-curves-v3", state);
}

const saved = store.get("crop-curves-v3") || {};
/** The song whose knot S drops: the last one touched. */
let active = null;
for (const s of SONGS) {
  const el = document.createElement("section");
  el.className = "song";
  el.dataset.key = s.key;
  { const o = document.createElement("option"); o.value = o.textContent = s.key; document.getElementById("pick").append(o); }
  el.innerHTML = '<div class="frame"><div class="pic"></div></div>';
  const frame = el.querySelector(".frame"), pic = el.querySelector(".pic");
  frame.style.aspectRatio = s.width + " / " + s.height;
  const video = document.createElement("video"); video.muted = true; video.preload = "metadata"; video.src = s.video; pic.append(video);
  document.getElementById("songs").append(el);
  if (!s.wide) {
    frame.style.maxWidth = Math.round(560 * s.width / s.height) + "px";
    video.currentTime = (s.start + s.end) / 2;
    const note = document.createElement("div"); note.className = "warn"; note.textContent = s.width + "×" + s.height + ": not 16:9, so there is no crop box."; el.append(note);
    continue;
  }
  const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 540; canvas.style.display = "none"; pic.append(canvas);
  const st = (state[s.key] = saved[s.key] || {
    follow: s.crop.follow, smooth: s.crop.smooth, knots: s.crop.knots.map((k) => ({ ...k, angle: k.angle || 0, width: k.width || 0, strength: k.strength ?? 1 })),
    t: s.start, onion: { on: false, length: 10, count: 8 }, touched: s.hasCrop,
  });
  const times = s.motion ? s.motion.map((m) => m[0]) : Array.from({ length: Math.floor((s.end - s.start) * 2) + 1 }, (_, i) => s.start + i / 2);
  const motion = s.motion ? s.motion.map(([, angle, scale, dx, dy]) => ({ angle, scale, dx, dy })) : null;
  const people = s.people ? s.people.map(([t, boxes]) => ({ t, boxes })) : null;
  const need = people ? bandNeed(people) : null;
  let path = [], raw = [];
  const refit = () => {
    path = cropPath(times, motion, people, st, 1920, 1080);
    // For the plots: the size the band needs, and the turn that would level the camera.
    if (st.follow && need && motion) {
      const k0 = [...st.knots].sort((a, b) => a.at - b.at)[0];
      const i0 = k0 ? Math.min(times.length - 1, Math.max(0, Math.round((k0.at - times[0]) * 2))) : 0, level = k0 ? k0.angle : 0;
      raw = times.map((t, i) => ({ t, size: need[i].size, angle: level - (motion[i].angle - motion[i0].angle) }));
    } else raw = [];
  };
  refit();

  const ui = document.createElement("div");
  ui.innerHTML =
    '<div class="timeline"></div><canvas class="plot" width="1000" height="80"></canvas><div class="now"></div>' +
    '<div class="controls">' +
    '<label>Curve</label><div class="onion"><label><input type="checkbox" class="follow"> follow the band</label><label>smooth over <input type="number" class="smooth" min="1" step="1"> s</label></div><span></span>' +
    '<label>Onion skin</label><div class="onion"><label><input type="checkbox" class="on"> on</label><label><input type="number" class="len" min="1" step="1"> seconds ahead</label><label><input type="number" class="count" min="2" max="30" step="1"> frames</label></div><span></span>' +
    '<label>Turn</label><input type="range" class="angle" min="-10" max="10" step="0.1"><span class="num deg"></span>' +
    '</div><div class="keys"></div><div class="warn"></div>';
  el.append(ui);
  const q = (c) => ui.querySelector(c);
  const timeline = q(".timeline"), plot = q(".plot"), lane = plot, now = q(".now"), followEl = q(".follow"), smoothEl = q(".smooth");
  const on = q(".on"), len = q(".len"), count = q(".count"), angle = q(".angle"), deg = q(".deg"), keysEl = q(".keys"), warn = q(".warn");
  if (!motion || !people) { followEl.disabled = true; followEl.parentElement.title = "this song hasn't been measured"; }
  const boxEl = document.createElement("div"); boxEl.className = "box";
  for (const c of ["tl", "tr", "bl", "br"]) { const h = document.createElement("div"); h.className = "h " + c; h.dataset.c = c; boxEl.append(h); }
  frame.append(boxEl);
  el.addEventListener("pointerdown", () => (active = dropKnot));
  const pct = (t) => ((t - s.start) / (s.end - s.start)) * 100 + "%";
  const idx = (t) => Math.min(times.length - 1, Math.max(0, Math.round((t - times[0]) * 2)));
  /** The curve at time t, as the render moves between samples. */
  const at = (t) => {
    const f = (t - times[0]) * 2, i = Math.min(times.length - 2, Math.max(0, Math.floor(f))), u = Math.min(1, Math.max(0, f - i));
    const a = path[i], b = path[i + 1] || a;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, size: a.size + (b.size - a.size) * u, angle: a.angle + (b.angle - a.angle) * u };
  };
  const knotNear = (t) => st.knots.findIndex((k) => Math.abs(k.at - t) < 0.26);
  // The people found at the playhead, outlined on the picture.
  const outlines = document.createElement("div"); outlines.className = "people"; pic.append(outlines);
  const drawPeople = () => {
    outlines.innerHTML = "";
    if (!people) return;
    for (const b of people[idx(st.t)].boxes) {
      if (b[4] < 0.4) continue;
      const o = document.createElement("div"); o.className = "person";
      Object.assign(o.style, { left: b[0] * 100 + "%", top: b[1] * 100 + "%", width: b[2] * 100 + "%", height: b[3] * 100 + "%" });
      outlines.append(o);
    }
  };

  // The onion skin: frames from the playhead forward, laid over each other so each counts equally.
  const sampler = document.createElement("video"); sampler.muted = true; sampler.preload = "auto"; sampler.src = s.video;
  const ctx = canvas.getContext("2d");
  let onionRun = 0, onionTimer = 0;
  const seekTo = (v, t) => new Promise((res) => { v.addEventListener("seeked", res, { once: true }); v.currentTime = t; });
  async function drawOnion() {
    const run = ++onionRun, o = st.onion, end = Math.min(st.t + o.length, s.end), n = Math.max(2, Math.min(30, o.count));
    for (let i = 0; i < n; i++) {
      await seekTo(sampler, st.t + ((end - st.t) * i) / (n - 1));
      if (run !== onionRun) return;
      ctx.globalAlpha = 1 / (i + 1);
      ctx.drawImage(sampler, 0, 0, canvas.width, canvas.height);
    }
  }
  function onionLater() {
    canvas.style.display = st.onion.on ? "" : "none";
    clearTimeout(onionTimer); onionRun++;
    if (st.onion.on) onionTimer = setTimeout(drawOnion, 250);
  }

  // The knot lane: each knot's pull as a normal curve, its height the pull and its spread the width.
  const LANE_PAD = 6;
  const laneX = (t) => ((t - s.start) / (s.end - s.start)) * lane.width;
  const laneY = (v) => lane.height - LANE_PAD - v * (lane.height - 2 * LANE_PAD);
  const pull = (k, t) => { const sd = (k.width || 0) / 2; return (k.strength ?? 1) * (sd > 0 ? Math.exp(-((t - k.at) ** 2) / (2 * sd * sd)) : Math.abs(t - k.at) < 0.26 ? 1 : 0); };
  function drawLane() {
    const g = lane.getContext("2d"), css = getComputedStyle(document.body);
    for (const k of st.knots) {
      const sd = (k.width || 0) / 2, sel = Math.abs(k.at - st.t) < 0.26;
      g.strokeStyle = css.getPropertyValue("--box"); g.fillStyle = css.getPropertyValue("--box"); g.lineWidth = sel ? 2.5 : 1.5;
      g.beginPath();
      if (sd === 0) { g.moveTo(laneX(k.at), laneY(0)); g.lineTo(laneX(k.at), laneY(k.strength ?? 1)); }
      else {
        const from = Math.max(s.start, k.at - 3.5 * sd), to = Math.min(s.end, k.at + 3.5 * sd);
        for (let i = 0; i <= 80; i++) { const t = from + ((to - from) * i) / 80; const x = laneX(t), y = laneY(pull(k, t)); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      }
      g.stroke();
      if (sd > 0) { g.globalAlpha = 0.18; g.lineTo(laneX(Math.min(s.end, k.at + 3.5 * sd)), laneY(0)); g.lineTo(laneX(Math.max(s.start, k.at - 3.5 * sd)), laneY(0)); g.fill(); g.globalAlpha = 1; }
      g.beginPath(); g.arc(laneX(k.at), laneY(k.strength ?? 1), sel ? 5 : 4, 0, 2 * Math.PI); g.fill();
    }
  }
  lane.addEventListener("pointerdown", (e) => {
    const r = lane.getBoundingClientRect(), sx = lane.width / r.width, sy = lane.height / r.height;
    const px = (e.clientX - r.left) * sx, py = (e.clientY - r.top) * sy;
    const t = s.start + (px / lane.width) * (s.end - s.start);
    // The knot whose curve is nearest the pointer, if any is close.
    let best = -1, bestD = 14;
    st.knots.forEach((k, i) => {
      const peak = Math.hypot(px - laneX(k.at), py - laneY(k.strength ?? 1));
      const under = laneY(pull(k, t)) <= py + 6 && pull(k, t) > 0.02 ? Math.abs(py - laneY(pull(k, t))) : Infinity;
      const d = Math.min(peak, under);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0) return;
    e.preventDefault(); active = dropKnot;
    const k = st.knots[best], s0 = k.strength ?? 1, w0 = k.width || 0, x0 = px, y0 = py;
    // Sideways from the knot's side of the curve widens it; toward the middle narrows it.
    const side = px >= laneX(k.at) ? 1 : -1, secPerPx = (s.end - s.start) / lane.width;
    seek(k.at);
    const move = (ev) => {
      const mx = (ev.clientX - r.left) * sx, my = (ev.clientY - r.top) * sy;
      k.strength = Math.round(Math.min(1, Math.max(0, s0 - (my - y0) / (lane.height - 2 * LANE_PAD))) * 100) / 100;
      k.width = Math.round(Math.min(60, Math.max(0, w0 + 2 * side * (mx - x0) * secPerPx)) * 10) / 10;
      st.touched = true; refit(); draw();
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });

  function drawPlot() {
    const g = plot.getContext("2d"), w = plot.width, h = plot.height, css = getComputedStyle(document.body);
    g.clearRect(0, 0, w, h);
    const X = (t) => ((t - s.start) / (s.end - s.start)) * w;
    const lane = (get, lo, hi, top, color) => {
      const Y = (v) => top + 30 - ((v - lo) / (hi - lo || 1)) * 28;
      if (raw.length) { g.strokeStyle = color; g.globalAlpha = 0.35; g.lineWidth = 1; g.beginPath(); raw.forEach((b, i) => { const x = X(b.t), y = Y(get(b)); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
      g.globalAlpha = 1; g.lineWidth = 2; g.beginPath(); path.forEach((b, i) => { const x = X(b.t), y = Y(get(b)); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    };
    const sizes = path.map((b) => b.size).concat(raw.map((b) => b.size)), angles = path.map((b) => b.angle).concat(raw.map((b) => b.angle));
    lane((b) => b.size, Math.min(...sizes), Math.max(...sizes), 4, css.getPropertyValue("--fg"));
    lane((b) => b.angle, Math.min(...angles), Math.max(...angles), 42, css.getPropertyValue("--box"));
    g.fillStyle = css.getPropertyValue("--muted"); g.font = "11px system-ui"; g.fillText("zoom", 4, 12); g.fillText("turn", 4, 52); g.textAlign = "right"; g.fillText("knots: drag up to pull harder, sideways to reach further", w - 4, 12); g.textAlign = "left";
    g.strokeStyle = css.getPropertyValue("--box"); g.lineWidth = 2; g.beginPath(); g.moveTo(X(st.t), 0); g.lineTo(X(st.t), h); g.stroke();
  }

  function draw() {
    const shown = at(st.t), near = knotNear(st.t);
    Object.assign(boxEl.style, { left: shown.x * 100 + "%", top: shown.y * 100 + "%", width: shown.size * 100 + "%", height: shown.size * 100 + "%" });
    boxEl.classList.toggle("pinned", near >= 0);
    pic.style.transform = "rotate(" + shown.angle + "deg)";
    followEl.checked = st.follow && !!motion && !!people; smoothEl.value = st.smooth;
    on.checked = st.onion.on; len.value = st.onion.length; count.value = st.onion.count;
    angle.value = shown.angle; deg.textContent = shown.angle.toFixed(1) + "°";
    timeline.innerHTML = "";
    if (st.onion.on) { const o = document.createElement("div"); o.className = "gl"; o.style.background = "var(--box)"; o.style.opacity = ".25"; o.style.left = pct(st.t); o.style.width = "calc(" + pct(Math.min(st.t + st.onion.length, s.end)) + " - " + pct(st.t) + ")"; timeline.append(o); }
    st.knots.forEach((k) => {
      const m = document.createElement("div"); m.className = "knot"; m.style.left = pct(k.at); m.style.opacity = String(0.4 + 0.6 * (k.strength ?? 1)); m.title = "knot at " + fmt(k.at); timeline.append(m);
    });
    const p = document.createElement("div"); p.className = "playhead"; p.style.left = pct(st.t); timeline.append(p);
    now.textContent = fmt(st.t) + " (" + fmt(st.t - s.start) + " into the render) · " + (near >= 0 ? "on a knot: dragging moves it" : "dragging adds a knot here");
    keysEl.innerHTML = "";
    const sp = document.createElement("button"); sp.type = "button"; sp.className = "split"; sp.textContent = "Knot here (S)"; sp.onclick = dropKnot; keysEl.append(sp);
    [...st.knots].sort((a, b) => a.at - b.at).forEach((k) => {
      const chip = document.createElement("span"); chip.className = "key"; chip.setAttribute("aria-selected", String(Math.abs(k.at - st.t) < 0.26));
      chip.append(fmt(k.at));
      if (st.knots.length > 1 || st.follow) {
        const del = document.createElement("button"); del.type = "button"; del.textContent = "×"; del.title = "remove this knot";
        del.onclick = (e) => { e.stopPropagation(); st.knots.splice(st.knots.indexOf(k), 1); st.touched = true; refit(); draw(); };
        chip.append(del);
      }
      chip.onclick = () => seek(k.at);
      keysEl.append(chip);
    });
    warn.textContent = !motion || !people ? "This song hasn't been measured, so the curve only runs between your knots." : "";
    drawPlot();
    drawLane();
    output();
  }
  function seek(t) {
    st.t = Math.min(Math.max(t, s.start), s.end);
    video.currentTime = st.t;
    draw(); drawPeople(); onionLater();
  }
  /** The knot at the playhead, made from the curve there if there isn't one. */
  function knotHere() {
    let i = knotNear(st.t);
    if (i < 0) { const t = times[idx(st.t)]; st.knots.push({ at: Number(t.toFixed(2)), ...at(t), width: NEW_KNOT.width, strength: NEW_KNOT.strength }); i = st.knots.length - 1; st.t = t; }
    st.touched = true;
    return st.knots[i];
  }
  function dropKnot() { active = dropKnot; knotHere(); refit(); draw(); }

  timeline.addEventListener("pointerdown", (e) => {
    e.preventDefault(); active = dropKnot;
    const r = timeline.getBoundingClientRect();
    const go = (ev) => seek(s.start + ((ev.clientX - r.left) / r.width) * (s.end - s.start));
    go(e);
    const up = () => { removeEventListener("pointermove", go); removeEventListener("pointerup", up); };
    addEventListener("pointermove", go); addEventListener("pointerup", up);
  });
  followEl.onchange = () => { st.follow = followEl.checked; st.touched = true; refit(); draw(); };
  smoothEl.onchange = () => { st.smooth = Math.max(1, Number(smoothEl.value) || s.defaultSmooth); st.touched = true; refit(); draw(); };
  on.onchange = () => { st.onion.on = on.checked; draw(); onionLater(); };
  len.onchange = () => { st.onion.length = Math.max(1, Number(len.value) || 10); draw(); onionLater(); };
  count.onchange = () => { st.onion.count = Math.min(30, Math.max(2, Math.round(Number(count.value)) || 8)); draw(); onionLater(); };
  angle.oninput = () => { const k = knotHere(); k.angle = Number(angle.value); refit(); draw(); };

  // Trackpad gestures on the picture: pinching (which the browser sends as a
  // wheel with ctrl held) zooms the box about its centre, and two-finger
  // scrolling moves it.
  frame.addEventListener("wheel", (e) => {
    e.preventDefault(); active = dropKnot;
    const k = knotHere();
    const cx = k.x + k.size / 2, cy = k.y + k.size / 2;
    if (e.ctrlKey) k.size = r3(Math.min(1, Math.max(0.2, k.size * Math.exp(e.deltaY * 0.01))));
    const r = frame.getBoundingClientRect();
    const nx = e.ctrlKey ? cx : cx + e.deltaX / r.width, ny = e.ctrlKey ? cy : cy + e.deltaY / r.height;
    k.x = r3(Math.min(Math.max(nx - k.size / 2, 0), 1 - k.size));
    k.y = r3(Math.min(Math.max(ny - k.size / 2, 0), 1 - k.size));
    refit(); draw();
  }, { passive: false });

  boxEl.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation(); active = dropKnot;
    const k = knotHere(); refit(); draw();
    const corner = e.target.dataset.c, r = frame.getBoundingClientRect(), k0 = { ...k }, x0 = e.clientX, y0 = e.clientY;
    const move = (ev) => {
      const dx = (ev.clientX - x0) / r.width, dy = (ev.clientY - y0) / r.height;
      if (!corner) {
        k.x = r3(Math.min(Math.max(k0.x + dx, 0), 1 - k.size));
        k.y = r3(Math.min(Math.max(k0.y + dy, 0), 1 - k.size));
      } else {
        // The opposite corner stays put; the box stays 16:9 and inside the frame.
        const left = corner[1] === "l", top = corner[0] === "t";
        const ax = left ? k0.x + k0.size : k0.x, ay = top ? k0.y + k0.size : k0.y;
        const grow = Math.max(left ? -dx : dx, top ? -dy : dy);
        const size = r3(Math.min(Math.max(k0.size + grow, 0.2), Math.min(left ? ax : 1 - ax, top ? ay : 1 - ay)));
        k.size = size; k.x = r3(left ? ax - size : ax); k.y = r3(top ? ay - size : ay);
      }
      refit(); draw();
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
  seek(st.t);
}
const pick = document.getElementById("pick");
const show = (key) => {
  document.querySelectorAll(".song").forEach((el) => el.classList.toggle("shown", el.dataset.key === key));
  pick.value = key;
  store.set("crop-song", key);
};
pick.onchange = () => show(pick.value);
show(SONGS.some((s) => s.key === store.get("crop-song")) ? store.get("crop-song") : SONGS.find((s) => s.wide)?.key || SONGS[0].key);
output();
addEventListener("keydown", (e) => {
  if ((e.key === "s" || e.key === "S") && active && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) active();
});
document.getElementById("copy").onclick = async () => {
  const b = document.getElementById("copy");
  try { await navigator.clipboard.writeText(document.getElementById("json").value); b.textContent = "Copied"; }
  catch { const j = document.getElementById("json"); j.style.display = "block"; j.select(); b.textContent = "Press ⌘C"; j.onblur = () => (j.style.display = "none"); }
  setTimeout(() => (b.textContent = "Copy crops"), 1500);
};
</script>
</body>
</html>
`;
