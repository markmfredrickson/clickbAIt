/**
 * The crop picker: a page in `renders/crop/` with stills spread over each
 * song's cut. A two-ended slider picks which stills are laid over each other,
 * so the phone's wander over that stretch shows; you fit a 16:9 box (and an
 * angle) to them. A song can have several boxes, keyed by time, that glide
 * from one to the next (see crop.ts). Copy the crops out for gig.json; the
 * page writes nothing back itself. A video that isn't 16:9, such as one shot
 * upright, is shown at its own shape with no box.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_GLIDE } from "./crop.js";
import type { Gig } from "./gig.js";
import { mediaSeconds } from "./media.js";

/** How many stills each song gets, spread evenly over its cut. */
const STILLS = 16;

export function writeCropPage(gig: Gig): string {
  const out = join(gig.dir, "renders/crop");
  mkdirSync(out, { recursive: true });
  const songs = gig.songs.map((s) => {
    const key = `${s.n}-${s.slug}`;
    const phone = join(gig.dir, s.phone);
    const start = s.cut.in ?? 0;
    const end = s.cut.out ?? mediaSeconds(phone);
    const stills = Array.from({ length: STILLS }, (_, i) => {
      const file = `${key}-${String(i + 1).padStart(2, "0")}.jpg`;
      const at = Number((start + ((i + 0.5) / STILLS) * (end - start)).toFixed(2));
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(at), "-i", phone, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "3", join(out, file)]);
      return { file, at };
    });
    const [width, height] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", phone], { encoding: "utf8" })
      .trim()
      .split(",")
      .map(Number);
    return { key, start, end, stills, width, height, keys: s.crop ?? [{ at: start, x: 0, y: 0, size: 1 }] };
  });
  const page = join(out, "index.html");
  writeFileSync(page, PAGE.replace("/*SONGS*/[]", JSON.stringify(songs)).replace("/*GLIDE*/2", String(DEFAULT_GLIDE)));
  return page;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crop Picker</title>
<style>
  :root { --bg: #f6f5f2; --fg: #1d1d1b; --muted: #6b6a66; --card: #fff; --line: #d9d7d0; --box: #e0412b; --sel: #1d1d1b; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ecebe6; --muted: #9a9892; --card: #222220; --line: #3a3936; --box: #ff6a50; --sel: #ecebe6; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 170px; background: var(--bg); color: var(--fg); font: 15px/1.4 system-ui, sans-serif; }
  main { max-width: 1000px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lead { color: var(--muted); margin: 0 0 24px; max-width: 70ch; }
  .song { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 20px; }
  .song h2 { font-size: 16px; margin: 0 0 8px; }
  .frame { position: relative; width: 100%; margin: 0 auto; overflow: hidden; user-select: none; touch-action: none; background: #000; }
  .pic { position: absolute; inset: 0; }
  .pic img { position: absolute; inset: 0; width: 100%; height: 100%; }
  .box { position: absolute; border: 2px solid var(--box); box-shadow: 0 0 0 9999px rgba(0,0,0,.45); cursor: move; }
  .h { position: absolute; width: 18px; height: 18px; background: var(--box); border-radius: 3px; }
  .h.tl { left: -9px; top: -9px; cursor: nwse-resize; } .h.br { right: -9px; bottom: -9px; cursor: nwse-resize; }
  .h.tr { right: -9px; top: -9px; cursor: nesw-resize; } .h.bl { left: -9px; bottom: -9px; cursor: nesw-resize; }
  .controls { display: grid; grid-template-columns: 90px 1fr auto; gap: 6px 10px; align-items: center; margin-top: 10px; font-size: 13px; }
  .controls label { color: var(--muted); }
  .num { font-variant-numeric: tabular-nums; min-width: 120px; text-align: right; }
  .range2 { position: relative; height: 24px; }
  .range2 input { position: absolute; inset: 0; width: 100%; margin: 0; background: none; pointer-events: none; -webkit-appearance: none; appearance: none; }
  .range2 input::-webkit-slider-thumb { pointer-events: auto; -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--fg); cursor: pointer; }
  .range2 .track { position: absolute; left: 0; right: 0; top: 10px; height: 4px; background: var(--line); border-radius: 2px; }
  .range2 .fill { position: absolute; top: 7px; height: 10px; background: var(--fg); border-radius: 5px; cursor: grab; z-index: 1; }
  .range2 .fill:active { cursor: grabbing; }
  .range2 .marks { position: absolute; top: 0; bottom: 0; left: 8px; right: 8px; }
  .range2 .mark { position: absolute; top: 2px; width: 3px; height: 20px; margin-left: -1px; background: var(--box); border-radius: 1px; cursor: pointer; z-index: 2; }
  .range2 .glide { position: absolute; top: 9px; height: 6px; background: var(--box); opacity: .35; }
  .range2 input { z-index: 3; }
  input[type=range].angle { width: 100%; }
  .keys { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; align-items: center; }
  .key { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 2px 4px 2px 10px; font-size: 13px; cursor: pointer; }
  .key[aria-selected="true"] { border-color: var(--sel); box-shadow: inset 0 0 0 1px var(--sel); }
  .key input { width: 46px; font: inherit; font-size: 12px; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 4px; padding: 1px 3px; }
  .key button, .add, .reset { font: inherit; font-size: 13px; padding: 2px 10px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--fg); cursor: pointer; }
  .key button { border: 0; padding: 0 6px; color: var(--muted); }
  .warn { color: var(--box); font-size: 13px; margin-top: 6px; min-height: 1em; }
  .out { position: fixed; left: 0; right: 0; bottom: 0; background: var(--card); border-top: 1px solid var(--line); padding: 10px 16px; }
  .out div { max-width: 1000px; margin: 0 auto; display: flex; gap: 8px; align-items: flex-start; }
  textarea { flex: 1; height: 120px; font: 12px/1.3 ui-monospace, monospace; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 6px; }
  .copy { font: inherit; padding: 8px 14px; border: 0; border-radius: 6px; background: var(--fg); color: var(--bg); cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>Crop picker</h1>
  <p class="lead">Pick a stretch of the song with the two-ended slider, or drag its filled part to slide the whole stretch: its stills are laid over each other, so you can see how far the phone wandered. Fit the box to them by dragging it or any corner, and turn the picture if the phone sat crooked. To change the box later in the song, pick a later stretch and add a key: the box glides to its new place, finishing as that stretch starts. Red marks on the slider are the keys, and the shading before each is its glide. When you're done, copy the crops at the bottom.</p>
  <div id="songs"></div>
</main>
<div class="out"><div><textarea id="json" readonly></textarea><button class="copy" id="copy" type="button">Copy crops</button></div></div>
<script>
const SONGS = /*SONGS*/[];
const GLIDE = /*GLIDE*/2;
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const r3 = (v) => Math.round(v * 1000) / 1000;
const state = {};

function output() {
  const out = {};
  for (const s of SONGS) {
    const st = state[s.key];
    if (!st) continue;
    const keys = st.keys.map((k, i) => {
      const o = { at: i === 0 ? s.start : k.at, x: k.x, y: k.y, size: k.size };
      if (k.angle) o.angle = k.angle;
      if (i > 0 && k.glide !== GLIDE) o.glide = k.glide;
      return o;
    });
    if (keys.length === 1) {
      const { at, ...box } = keys[0];
      if (box.size < 1 || box.angle) out[s.key] = box;
    } else out[s.key] = keys;
  }
  document.getElementById("json").value = JSON.stringify(out, null, 1);
  store.set("crop-state", state);
}

const saved = store.get("crop-state") || {};
for (const s of SONGS) {
  const el = document.createElement("section");
  el.className = "song";
  el.innerHTML = '<h2></h2><div class="frame"><div class="pic"></div></div>';
  el.querySelector("h2").textContent = s.key;
  const frame = el.querySelector(".frame"), pic = el.querySelector(".pic");
  frame.style.aspectRatio = s.width + " / " + s.height;
  const imgs = s.stills.map((st) => { const img = document.createElement("img"); img.src = st.file; img.alt = ""; pic.append(img); return img; });
  const wide = Math.abs(s.width / s.height - 16 / 9) < 0.01;
  document.getElementById("songs").append(el);
  const blend = (lo, hi) => imgs.forEach((img, i) => { img.style.opacity = i < lo || i > hi ? 0 : 1 / (i - lo + 1); });
  if (!wide) {
    frame.style.maxWidth = Math.round(560 * s.width / s.height) + "px";
    blend(0, imgs.length - 1);
    const note = document.createElement("div"); note.className = "warn"; note.textContent = s.width + "×" + s.height + ": not 16:9, so there is no crop box."; el.append(note);
    continue;
  }
  const st = (state[s.key] = saved[s.key] || {
    keys: s.keys.map((k, i) => ({ at: k.at, x: k.x, y: k.y, size: k.size, angle: k.angle || 0, glide: k.glide || GLIDE, lo: 0, hi: imgs.length - 1 })),
    sel: 0,
  });
  const ui = document.createElement("div");
  ui.innerHTML =
    '<div class="controls">' +
    '<label>Stills</label><div class="range2"><div class="track"></div><div class="marks"></div><div class="fill"></div><input type="range" class="lo" min="0" step="1"><input type="range" class="hi" min="0" step="1"></div><span class="num when"></span>' +
    '<label>Turn</label><input type="range" class="angle" min="-10" max="10" step="0.1"><span class="num deg"></span>' +
    '</div><div class="keys"></div><div class="warn"></div>';
  el.append(ui);
  const lo = ui.querySelector(".lo"), hi = ui.querySelector(".hi"), fill = ui.querySelector(".fill"), when = ui.querySelector(".when");
  const angle = ui.querySelector(".angle"), deg = ui.querySelector(".deg"), keysEl = ui.querySelector(".keys"), warn = ui.querySelector(".warn");
  lo.max = hi.max = imgs.length - 1;
  const marks = ui.querySelector(".marks"), track = ui.querySelector(".range2");
  // Where a time sits on the slider, which runs from the first still to the last.
  const first = s.stills[0].at, last = s.stills[s.stills.length - 1].at;
  const pos = (t) => Math.min(Math.max((t - first) / (last - first), 0), 1) * 100 + "%";
  // Dragging the filled part moves the whole stretch, keeping its length.
  fill.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const r = track.getBoundingClientRect(), k = key(), lo0 = k.lo, hi0 = k.hi, x0 = e.clientX, span = hi0 - lo0;
    const move = (ev) => {
      const shift = Math.round(((ev.clientX - x0) / r.width) * (imgs.length - 1));
      k.lo = Math.min(Math.max(lo0 + shift, 0), imgs.length - 1 - span); k.hi = k.lo + span; draw();
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
  const box = document.createElement("div"); box.className = "box";
  for (const c of ["tl", "tr", "bl", "br"]) { const h = document.createElement("div"); h.className = "h " + c; h.dataset.c = c; box.append(h); }
  frame.append(box);
  const key = () => st.keys[st.sel];
  const fmt = (t) => { const m = Math.floor(t / 60), sec = (t - m * 60).toFixed(1).padStart(4, "0"); return m + ":" + sec; };

  function draw() {
    const k = key();
    Object.assign(box.style, { left: k.x * 100 + "%", top: k.y * 100 + "%", width: k.size * 100 + "%", height: k.size * 100 + "%" });
    pic.style.transform = "rotate(" + k.angle + "deg)";
    lo.value = k.lo; hi.value = k.hi;
    // The thumbs' centres run 8px in from each end.
    fill.style.left = "calc(8px + (100% - 16px) * " + k.lo / lo.max + ")"; fill.style.right = "calc(8px + (100% - 16px) * " + (1 - k.hi / hi.max) + ")";
    blend(k.lo, k.hi);
    when.textContent = fmt(s.stills[k.lo].at) + " – " + fmt(s.stills[k.hi].at);
    angle.value = k.angle; deg.textContent = k.angle.toFixed(1) + "°";
    marks.innerHTML = "";
    st.keys.forEach((kk, i) => {
      if (i > 0) { const g = document.createElement("div"); g.className = "glide"; g.style.left = pos(kk.at - kk.glide); g.style.width = "calc(" + pos(kk.at) + " - " + pos(kk.at - kk.glide) + ")"; marks.append(g); }
      const m = document.createElement("div"); m.className = "mark"; m.style.left = pos(i === 0 ? s.start : kk.at);
      m.title = i === 0 ? "first box" : "key at " + fmt(kk.at); m.onpointerdown = (e) => { e.stopPropagation(); st.sel = i; draw(); };
      marks.append(m);
    });
    keysEl.innerHTML = "";
    st.keys.forEach((kk, i) => {
      const chip = document.createElement("span"); chip.className = "key"; chip.setAttribute("aria-selected", String(i === st.sel));
      chip.append(i === 0 ? "from the start" : "at " + fmt(kk.at));
      if (i > 0) {
        const g = document.createElement("input"); g.type = "number"; g.min = "0.2"; g.step = "0.5"; g.value = kk.glide; g.title = "glide, seconds";
        g.onclick = (e) => e.stopPropagation();
        g.onchange = () => { kk.glide = Math.max(0.2, Number(g.value) || GLIDE); draw(); };
        const del = document.createElement("button"); del.type = "button"; del.textContent = "×"; del.title = "remove this key";
        del.onclick = (e) => { e.stopPropagation(); st.keys.splice(i, 1); st.sel = Math.min(st.sel, st.keys.length - 1); draw(); };
        chip.append(" glide ", g, "s", del);
      }
      chip.onclick = () => { st.sel = i; draw(); };
      keysEl.append(chip);
    });
    const add = document.createElement("button"); add.type = "button"; add.className = "add"; add.textContent = "Add key at " + fmt(s.stills[k.lo].at);
    add.onclick = () => {
      const at = s.stills[k.lo].at;
      if (st.keys.some((kk) => Math.abs(kk.at - at) < 0.01) || at <= s.start) return;
      const nk = { ...k, at, glide: GLIDE };
      st.keys.push(nk); st.keys.sort((a, b) => a.at - b.at); st.sel = st.keys.indexOf(nk); draw();
    };
    const reset = document.createElement("button"); reset.type = "button"; reset.className = "reset"; reset.textContent = "Full frame";
    reset.onclick = () => { Object.assign(key(), { x: 0, y: 0, size: 1, angle: 0 }); draw(); };
    keysEl.append(add, reset);
    const bad = st.keys.findIndex((kk, i) => i > 0 && kk.at - kk.glide < (i === 1 ? s.start : st.keys[i - 1].at));
    warn.textContent = bad > 0 ? "The glide into the key at " + fmt(st.keys[bad].at) + " starts before the key before it is in place; shorten it." : "";
    output();
  }
  lo.oninput = () => { const k = key(); k.lo = Math.min(Number(lo.value), k.hi); draw(); };
  hi.oninput = () => { const k = key(); k.hi = Math.max(Number(hi.value), k.lo); draw(); };
  angle.oninput = () => { key().angle = Number(angle.value); draw(); };

  function drag(e, corner) {
    e.preventDefault(); e.stopPropagation();
    const r = frame.getBoundingClientRect(), k0 = { ...key() }, x0 = e.clientX, y0 = e.clientY;
    const move = (ev) => {
      const dx = (ev.clientX - x0) / r.width, dy = (ev.clientY - y0) / r.height, k = key();
      if (!corner) {
        k.x = r3(Math.min(Math.max(k0.x + dx, 0), 1 - k.size));
        k.y = r3(Math.min(Math.max(k0.y + dy, 0), 1 - k.size));
      } else {
        // The opposite corner stays put; the box stays 16:9 and inside the frame.
        const left = corner[1] === "l", top = corner[0] === "t";
        const ax = left ? k0.x + k0.size : k0.x, ay = top ? k0.y + k0.size : k0.y;
        const grow = Math.max(left ? -dx : dx, top ? -dy : dy);
        const room = Math.min(left ? ax : 1 - ax, top ? ay : 1 - ay);
        const size = r3(Math.min(Math.max(k0.size + grow, 0.2), room));
        k.size = size; k.x = r3(left ? ax - size : ax); k.y = r3(top ? ay - size : ay);
      }
      draw();
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  }
  box.addEventListener("pointerdown", (e) => drag(e, e.target.dataset.c));
  draw();
}
output();
document.getElementById("copy").onclick = async () => {
  const b = document.getElementById("copy");
  try { await navigator.clipboard.writeText(document.getElementById("json").value); b.textContent = "Copied"; }
  catch { document.getElementById("json").select(); b.textContent = "Press ⌘C"; }
  setTimeout(() => (b.textContent = "Copy crops"), 1500);
};
</script>
</body>
</html>
`;
