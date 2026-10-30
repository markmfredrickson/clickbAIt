/**
 * The crop picker: a page in `renders/crop/` for fitting each song's 16:9
 * boxes (see crop.ts). Each song has a timeline over its cut, coloured by
 * which box is in use and hatched where one glides into the next. Scrubbing it
 * shows the video at the playhead with the box as the render will cut it, and
 * selects that box for editing; "Split here" starts a new box at the playhead.
 * The onion skin lays frames from the playhead forward over each other, so the
 * phone's wander shows. Copy the crops out for gig.json; the page writes
 * nothing back itself. A video that isn't 16:9, such as one shot
 * upright, is shown at its own shape with no box.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boxAtSource, DEFAULT_GLIDE } from "./crop.js";
import type { Gig } from "./gig.js";
import { mediaSeconds } from "./media.js";

export function writeCropPage(gig: Gig): string {
  const out = join(gig.dir, "renders/crop");
  mkdirSync(out, { recursive: true });
  const songs = gig.songs.map((s) => {
    const key = `${s.n}-${s.slug}`;
    const phone = join(gig.dir, s.phone);
    const start = s.cut.in ?? 0;
    const end = s.cut.out ?? mediaSeconds(phone);
    const [width, height] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", phone], { encoding: "utf8" })
      .trim()
      .split(",")
      .map(Number);
    // The page sits two folders below the gig.
    return { key, start, end, width, height, video: `../../${s.phone}`, keys: s.crop ?? [{ at: start, x: 0, y: 0, size: 1 }] };
  });
  const page = join(out, "index.html");
  writeFileSync(page, PAGE.replace("/*SONGS*/[]", JSON.stringify(songs)).replace("/*BOXAT*/", boxAtSource()));
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
  body { margin: 0; padding: 24px 16px 170px; background: var(--bg); color: var(--fg); font: 15px/1.4 system-ui, sans-serif; }
  main { max-width: 1000px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lead { color: var(--muted); margin: 0 0 24px; max-width: 72ch; }
  .song { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 20px; }
  .song h2 { font-size: 16px; margin: 0 0 8px; }
  .frame { position: relative; width: 100%; margin: 0 auto; overflow: hidden; user-select: none; touch-action: none; background: #000; }
  .pic { position: absolute; inset: 0; }
  .pic video, .pic canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .box { position: absolute; border: 2px solid var(--box); box-shadow: 0 0 0 9999px rgba(0,0,0,.45); cursor: move; }
  .box.locked { border-style: dashed; cursor: default; }
  .box.locked .h { display: none; }
  .h { position: absolute; width: 18px; height: 18px; background: var(--box); border-radius: 3px; }
  .h.tl { left: -9px; top: -9px; cursor: nwse-resize; } .h.br { right: -9px; bottom: -9px; cursor: nwse-resize; }
  .h.tr { right: -9px; top: -9px; cursor: nesw-resize; } .h.bl { left: -9px; bottom: -9px; cursor: nesw-resize; }
  .timeline { position: relative; height: 34px; margin-top: 10px; border-radius: 4px; overflow: hidden; cursor: pointer; touch-action: none; background: var(--line); }
  .region { position: absolute; top: 0; bottom: 0; }
  .region.sel { box-shadow: inset 0 0 0 2px var(--fg); }
  .region span { position: absolute; left: 6px; top: 8px; font-size: 12px; white-space: nowrap; pointer-events: none; }
  .gl { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(45deg, var(--card) 0 4px, transparent 4px 8px); opacity: .8; }
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
  .out { position: fixed; left: 0; right: 0; bottom: 0; background: var(--card); border-top: 1px solid var(--line); padding: 10px 16px; }
  .out div { max-width: 1000px; margin: 0 auto; display: flex; gap: 8px; align-items: flex-start; }
  textarea { flex: 1; height: 120px; font: 12px/1.3 ui-monospace, monospace; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 6px; }
  .copy { font: inherit; padding: 8px 14px; border: 0; border-radius: 6px; background: var(--fg); color: var(--bg); cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>Crop picker</h1>
  <p class="lead">The coloured bar under each picture is the song's timeline: one colour per box, hatched where one box glides into the next. Scrub it to see the video with the box as the render will cut it; the box in use at the playhead is the one you edit. Drag the box or any corner, and turn the picture if the phone sat crooked. When the phone has moved and the box no longer fits, click Split here (or press S) to start a new box at the playhead; it glides in over the seconds before. The onion skin lays frames from the playhead forward over each other, so you can see how far the phone wanders before the next split. Times are seconds into the phone's video. When you're done, copy the crops at the bottom.</p>
  <div id="songs"></div>
</main>
<div class="out"><div><textarea id="json" readonly></textarea><button class="copy" id="copy" type="button">Copy crops</button></div></div>
<script>
/*BOXAT*/
const SONGS = /*SONGS*/[];
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const r3 = (v) => Math.round(v * 1000) / 1000;
const fmt = (t) => { const m = Math.floor(t / 60); return m + ":" + (t - m * 60).toFixed(1).padStart(4, "0"); };
const state = {};

function output() {
  const out = {};
  for (const s of SONGS) {
    const st = state[s.key];
    if (!st) continue;
    const keys = st.keys.map((k, i) => {
      const o = { at: i === 0 ? s.start : k.at, x: k.x, y: k.y, size: k.size };
      if (k.angle) o.angle = k.angle;
      if (i > 0 && k.glide !== DEFAULT_GLIDE) o.glide = k.glide;
      return o;
    });
    if (keys.length === 1) {
      const { at, ...one } = keys[0];
      if (one.size < 1 || one.angle) out[s.key] = one;
    } else out[s.key] = keys;
  }
  document.getElementById("json").value = JSON.stringify(out, null, 1);
  store.set("crop-state-v3", state);
}

const saved = store.get("crop-state-v3") || {};
/** The song whose split S makes: the last one touched. */
let active = null;
for (const s of SONGS) {
  const el = document.createElement("section");
  el.className = "song";
  el.innerHTML = '<h2></h2><div class="frame"><div class="pic"></div></div>';
  el.querySelector("h2").textContent = s.key;
  const frame = el.querySelector(".frame"), pic = el.querySelector(".pic");
  frame.style.aspectRatio = s.width + " / " + s.height;
  const video = document.createElement("video"); video.muted = true; video.preload = "auto"; video.src = s.video; pic.append(video);
  document.getElementById("songs").append(el);
  const wide = Math.abs(s.width / s.height - 16 / 9) < 0.01;
  if (!wide) {
    frame.style.maxWidth = Math.round(560 * s.width / s.height) + "px";
    video.currentTime = (s.start + s.end) / 2;
    const note = document.createElement("div"); note.className = "warn"; note.textContent = s.width + "×" + s.height + ": not 16:9, so there is no crop box."; el.append(note);
    continue;
  }
  const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 540; canvas.style.display = "none"; pic.append(canvas);
  const st = (state[s.key] = saved[s.key] || {
    keys: s.keys.map((k) => ({ at: k.at, x: k.x, y: k.y, size: k.size, angle: k.angle || 0, glide: k.glide || DEFAULT_GLIDE })),
    sel: 0, t: s.start, onion: { on: false, length: 10, count: 8 },
  });
  const ui = document.createElement("div");
  ui.innerHTML =
    '<div class="timeline"></div><div class="now"></div>' +
    '<div class="controls">' +
    '<label>Onion skin</label><div class="onion"><label><input type="checkbox" class="on"> on</label><label><input type="number" class="len" min="1" step="1"> seconds ahead</label><label><input type="number" class="count" min="2" max="30" step="1"> frames</label></div><span></span>' +
    '<label>Turn</label><input type="range" class="angle" min="-10" max="10" step="0.1"><span class="num deg"></span>' +
    '</div><div class="keys"></div><div class="warn"></div>';
  el.append(ui);
  const q = (c) => ui.querySelector(c);
  const timeline = q(".timeline"), now = q(".now"), on = q(".on"), len = q(".len"), count = q(".count");
  const angle = q(".angle"), deg = q(".deg"), keysEl = q(".keys"), warn = q(".warn");
  const boxEl = document.createElement("div"); boxEl.className = "box";
  for (const c of ["tl", "tr", "bl", "br"]) { const h = document.createElement("div"); h.className = "h " + c; h.dataset.c = c; boxEl.append(h); }
  frame.append(boxEl);
  el.addEventListener("pointerdown", () => (active = split));

  const at = (i) => (i === 0 ? s.start : st.keys[i].at);
  /** Where each box holds still, and where the glide into it runs. */
  const spans = () => st.keys.map((k, i) => ({
    from: at(i),
    to: i + 1 < st.keys.length ? st.keys[i + 1].at - st.keys[i + 1].glide : s.end,
    glide: i > 0 ? [k.at - k.glide, k.at] : null,
  }));
  /** The key in use at time t, and whether the box is gliding into it then. */
  const keyAt = (t) => {
    for (let i = st.keys.length - 1; i >= 0; i--) {
      if (i > 0 && t >= st.keys[i].at - st.keys[i].glide && t < st.keys[i].at) return { i, gliding: true };
      if (t >= at(i)) return { i, gliding: false };
    }
    return { i: 0, gliding: false };
  };
  const pct = (t) => ((t - s.start) / (s.end - s.start)) * 100 + "%";

  // The onion skin: frames from the playhead forward, drawn over each other at
  // 1, 1/2, 1/3 ... opacity so each counts equally. A second video does the
  // seeking so the first stays on the playhead.
  const sampler = document.createElement("video"); sampler.muted = true; sampler.preload = "auto"; sampler.src = s.video;
  const ctx = canvas.getContext("2d");
  let onionRun = 0, onionTimer = 0;
  const seekTo = (v, t) => new Promise((res) => { v.addEventListener("seeked", res, { once: true }); v.currentTime = t; });
  async function drawOnion() {
    const run = ++onionRun, o = st.onion;
    const end = Math.min(st.t + o.length, s.end), n = Math.max(2, Math.min(30, o.count));
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

  function draw() {
    const { gliding } = keyAt(st.t);
    const k = st.keys[st.sel];
    const shown = gliding ? boxAt(st.keys.map((kk, i) => ({ ...kk, at: at(i) })), st.t) : k;
    Object.assign(boxEl.style, { left: shown.x * 100 + "%", top: shown.y * 100 + "%", width: shown.size * 100 + "%", height: shown.size * 100 + "%" });
    boxEl.classList.toggle("locked", gliding);
    pic.style.transform = "rotate(" + shown.angle + "deg)";
    on.checked = st.onion.on; len.value = st.onion.length; count.value = st.onion.count;
    angle.value = shown.angle; angle.disabled = gliding; deg.textContent = shown.angle.toFixed(1) + "°";
    timeline.innerHTML = "";
    spans().forEach((sp, i) => {
      const r = document.createElement("div"); r.className = "region" + (i === st.sel ? " sel" : "");
      r.style.left = pct(sp.from); r.style.width = "calc(" + pct(sp.to) + " - " + pct(sp.from) + ")";
      r.style.background = "var(--r" + (i % 3) + ")";
      const label = document.createElement("span"); label.textContent = "Box " + (i + 1); r.append(label);
      timeline.append(r);
      if (sp.glide) { const g = document.createElement("div"); g.className = "gl"; g.style.left = pct(sp.glide[0]); g.style.width = "calc(" + pct(sp.glide[1]) + " - " + pct(sp.glide[0]) + ")"; timeline.append(g); }
    });
    if (st.onion.on) { const o = document.createElement("div"); o.className = "gl"; o.style.background = "var(--box)"; o.style.opacity = ".25"; o.style.left = pct(st.t); o.style.width = "calc(" + pct(Math.min(st.t + st.onion.length, s.end)) + " - " + pct(st.t) + ")"; timeline.append(o); }
    const p = document.createElement("div"); p.className = "playhead"; p.style.left = pct(st.t); timeline.append(p);
    now.textContent = fmt(st.t) + " (" + fmt(st.t - s.start) + " into the render) · " +
      (gliding ? "gliding into box " + (st.sel + 1) + "; move off the glide to edit" : "editing box " + (st.sel + 1));
    keysEl.innerHTML = "";
    const sp = document.createElement("button"); sp.type = "button"; sp.className = "split"; sp.textContent = "Split here (S)"; sp.onclick = split;
    keysEl.append(sp);
    st.keys.forEach((kk, i) => {
      const chip = document.createElement("span"); chip.className = "key"; chip.setAttribute("aria-selected", String(i === st.sel));
      chip.append("Box " + (i + 1) + (i === 0 ? " from the start" : " from "));
      if (i > 0) {
        const t = document.createElement("input"); t.type = "number"; t.step = "0.1"; t.value = kk.at; t.title = "seconds into the phone video";
        const g = document.createElement("input"); g.type = "number"; g.min = "0.2"; g.step = "0.5"; g.value = kk.glide; g.title = "glide, seconds";
        for (const inp of [t, g]) inp.onclick = (e) => e.stopPropagation();
        t.onchange = () => { kk.at = Math.min(Math.max(Number(t.value) || kk.at, s.start + 0.1), s.end); st.keys.sort((a, b) => a.at - b.at); seek(kk.at); };
        g.onchange = () => { kk.glide = Math.max(0.2, Number(g.value) || DEFAULT_GLIDE); draw(); };
        const del = document.createElement("button"); del.type = "button"; del.textContent = "×"; del.title = "remove this split";
        del.onclick = (e) => { e.stopPropagation(); st.keys.splice(i, 1); seek(st.t); };
        chip.append(t, "s, glide ", g, "s", del);
      }
      chip.onclick = () => seek(at(i));
      keysEl.append(chip);
    });
    const reset = document.createElement("button"); reset.type = "button"; reset.className = "reset"; reset.textContent = "Full frame";
    reset.onclick = () => { if (!keyAt(st.t).gliding) { Object.assign(st.keys[st.sel], { x: 0, y: 0, size: 1, angle: 0 }); draw(); } };
    keysEl.append(reset);
    const bad = st.keys.findIndex((kk, i) => i > 0 && kk.at - kk.glide < at(i - 1));
    warn.textContent = bad > 0 ? "The glide into box " + (bad + 1) + " starts before box " + bad + " is in place; shorten the glide or move the split later." : "";
    output();
  }
  function seek(t) {
    st.t = Math.min(Math.max(t, s.start), s.end);
    st.sel = keyAt(st.t).i;
    video.currentTime = st.t;
    draw();
    onionLater();
  }
  function split() {
    active = split;
    const t = Number(st.t.toFixed(1));
    if (t <= s.start + 0.1 || st.keys.some((kk, i) => Math.abs(at(i) - t) < 0.1)) return;
    const shown = boxAt(st.keys.map((kk, i) => ({ ...kk, at: at(i) })), t);
    const nk = { at: t, x: shown.x, y: shown.y, size: shown.size, angle: shown.angle, glide: DEFAULT_GLIDE };
    st.keys.push(nk); st.keys.sort((a, b) => a.at - b.at);
    // Step just past the new split, so its box is the one being edited.
    seek(t);
  }
  timeline.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    active = split;
    const r = timeline.getBoundingClientRect();
    const go = (ev) => seek(s.start + ((ev.clientX - r.left) / r.width) * (s.end - s.start));
    go(e);
    const up = () => { removeEventListener("pointermove", go); removeEventListener("pointerup", up); };
    addEventListener("pointermove", go); addEventListener("pointerup", up);
  });
  on.onchange = () => { st.onion.on = on.checked; draw(); onionLater(); };
  len.onchange = () => { st.onion.length = Math.max(1, Number(len.value) || 10); draw(); onionLater(); };
  count.onchange = () => { st.onion.count = Math.min(30, Math.max(2, Math.round(Number(count.value)) || 8)); draw(); onionLater(); };
  angle.oninput = () => { if (!keyAt(st.t).gliding) { st.keys[st.sel].angle = Number(angle.value); draw(); } };

  boxEl.addEventListener("pointerdown", (e) => {
    if (boxEl.classList.contains("locked")) return;
    e.preventDefault(); e.stopPropagation();
    active = split;
    const corner = e.target.dataset.c, r = frame.getBoundingClientRect(), k = st.keys[st.sel], k0 = { ...k }, x0 = e.clientX, y0 = e.clientY;
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
      draw();
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
  seek(st.t);
}
addEventListener("keydown", (e) => {
  if ((e.key === "s" || e.key === "S") && active && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) active();
});
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
