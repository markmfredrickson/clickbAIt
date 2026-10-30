/**
 * The crop picker: a page in `renders/crop/` with three stills from each song
 * (near the start, middle and end of its cut), shown on top of each other so
 * the phone's wander shows. Drag a 16:9 box over each and copy the crops out
 * for gig.json. The page writes nothing back itself. A video that isn't 16:9,
 * such as one shot upright, is shown at its own shape with no box.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Gig } from "./gig.js";
import { mediaSeconds } from "./media.js";

/** Where in a cut the stills are taken, as fractions of it. */
const STILLS = [0.1, 0.5, 0.9];

export function writeCropPage(gig: Gig): string {
  const out = join(gig.dir, "renders/crop");
  mkdirSync(out, { recursive: true });
  const songs = gig.songs.map((s) => {
    const key = `${s.n}-${s.slug}`;
    const phone = join(gig.dir, s.phone);
    const start = s.cut.in ?? 0;
    const end = s.cut.out ?? mediaSeconds(phone);
    const stills = STILLS.map((f, i) => {
      const file = `${key}-${i + 1}.jpg`;
      const at = start + f * (end - start);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(at), "-i", phone, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "3", join(out, file)]);
      return file;
    });
    const [width, height] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", phone], { encoding: "utf8" })
      .trim()
      .split(",")
      .map(Number);
    return { key, stills, width, height, crop: s.crop ?? { x: 0, y: 0, size: 1 } };
  });
  const page = join(out, "index.html");
  writeFileSync(page, PAGE.replace("/*SONGS*/[]", JSON.stringify(songs)));
  return page;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crop Picker</title>
<style>
  :root { --bg: #f6f5f2; --fg: #1d1d1b; --muted: #6b6a66; --card: #fff; --line: #d9d7d0; --box: #e0412b; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ecebe6; --muted: #9a9892; --card: #222220; --line: #3a3936; --box: #ff6a50; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 160px; background: var(--bg); color: var(--fg); font: 15px/1.4 system-ui, sans-serif; }
  main { max-width: 1000px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lead { color: var(--muted); margin: 0 0 24px; }
  .song { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 20px; }
  .head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .head h2 { font-size: 16px; margin: 0; }
  .views button, .head .reset { font: inherit; font-size: 13px; padding: 3px 10px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--fg); cursor: pointer; }
  .views button[aria-pressed="true"] { background: var(--fg); color: var(--bg); }
  .frame { position: relative; width: 100%; margin: 0 auto; overflow: hidden; user-select: none; touch-action: none; background: #000; }
  .frame img { position: absolute; inset: 0; width: 100%; height: 100%; }
  .shade { position: absolute; inset: 0; pointer-events: none; }
  .box { position: absolute; border: 2px solid var(--box); box-shadow: 0 0 0 9999px rgba(0,0,0,.45); cursor: move; }
  .handle { position: absolute; right: -9px; bottom: -9px; width: 18px; height: 18px; background: var(--box); border-radius: 3px; cursor: nwse-resize; }
  .readout { color: var(--muted); font-size: 13px; margin-top: 6px; font-variant-numeric: tabular-nums; }
  .out { position: fixed; left: 0; right: 0; bottom: 0; background: var(--card); border-top: 1px solid var(--line); padding: 10px 16px; }
  .out div { max-width: 1000px; margin: 0 auto; display: flex; gap: 8px; align-items: flex-start; }
  textarea { flex: 1; height: 110px; font: 12px/1.3 ui-monospace, monospace; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 6px; }
  .copy { font: inherit; padding: 8px 14px; border: 0; border-radius: 6px; background: var(--fg); color: var(--bg); cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>Crop picker</h1>
  <p class="lead">Each picture is three stills from the song laid over each other. Drag the box to move it and the corner to resize it. When you're done, copy the crops at the bottom.</p>
  <div id="songs"></div>
</main>
<div class="out"><div><textarea id="json" readonly></textarea><button class="copy" id="copy" type="button">Copy crops</button></div></div>
<script>
const SONGS = /*SONGS*/[];
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const crops = {};
const round = (v) => Math.round(v * 1000) / 1000;

function output() {
  const kept = {};
  for (const s of SONGS) { const c = crops[s.key]; if (c && c.size < 1) kept[s.key] = c; }
  document.getElementById("json").value = JSON.stringify(kept, null, 1);
  store.set("crops", crops);
}

const saved = store.get("crops") || {};
for (const s of SONGS) {
  const el = document.createElement("section");
  el.className = "song";
  el.innerHTML = '<div class="head"><h2></h2><div class="views"></div><button class="reset" type="button">Full frame</button></div><div class="frame"></div><div class="readout"></div>';
  el.querySelector("h2").textContent = s.key;
  const frame = el.querySelector(".frame");
  frame.style.aspectRatio = s.width + " / " + s.height;
  const wide = Math.abs(s.width / s.height - 16 / 9) < 0.01;
  if (!wide) frame.style.maxWidth = Math.round(560 * s.width / s.height) + "px";
  const imgs = s.stills.map((src, i) => { const img = document.createElement("img"); img.src = src; img.alt = ""; frame.append(img); return img; });
  const views = el.querySelector(".views");
  const show = (which) => {
    // Layered at 1, 1/2, 1/3 opacity, the stills average equally.
    imgs.forEach((img, i) => { img.style.opacity = which === "all" ? 1 / (i + 1) : (which === i ? 1 : 0); });
    views.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === String(which))));
  };
  [["all", "All three"], [0, "Start"], [1, "Middle"], [2, "End"]].forEach(([v, label]) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.dataset.v = String(v);
    b.onclick = () => show(v); views.append(b);
  });
  show("all");
  if (!wide) {
    el.querySelector(".reset").remove();
    el.querySelector(".readout").textContent = s.width + "×" + s.height + ": not 16:9, so there is no crop box.";
    document.getElementById("songs").append(el);
    continue;
  }
  crops[s.key] = saved[s.key] || { ...s.crop };
  const box = document.createElement("div"); box.className = "box";
  const handle = document.createElement("div"); handle.className = "handle"; box.append(handle); frame.append(box);
  const readout = el.querySelector(".readout");
  const draw = () => {
    const c = crops[s.key];
    Object.assign(box.style, { left: c.x * 100 + "%", top: c.y * 100 + "%", width: c.size * 100 + "%", height: c.size * 100 + "%" });
    readout.textContent = c.size < 1 ? "x " + c.x + "  y " + c.y + "  size " + c.size + " (" + Math.round(1920 * c.size) + " px wide, scaled to 1920)" : "full frame, no crop";
    output();
  };
  const drag = (e, mode) => {
    e.preventDefault(); e.stopPropagation();
    const r = frame.getBoundingClientRect(), start = { ...crops[s.key] }, x0 = e.clientX, y0 = e.clientY;
    const move = (ev) => {
      const dx = (ev.clientX - x0) / r.width, dy = (ev.clientY - y0) / r.height, c = crops[s.key];
      if (mode === "move") {
        c.x = round(Math.min(Math.max(start.x + dx, 0), 1 - c.size));
        c.y = round(Math.min(Math.max(start.y + dy, 0), 1 - c.size));
      } else {
        c.size = round(Math.min(Math.max(start.size + Math.max(dx, dy), 0.2), 1 - c.x, 1 - c.y));
      }
      draw();
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  box.addEventListener("pointerdown", (e) => drag(e, "move"));
  handle.addEventListener("pointerdown", (e) => drag(e, "resize"));
  el.querySelector(".reset").onclick = () => { crops[s.key] = { x: 0, y: 0, size: 1 }; draw(); };
  document.getElementById("songs").append(el);
  draw();
}
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
