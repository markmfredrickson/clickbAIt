/**
 * A page for answering a song's near-repeat questions (see
 * charts/near-repeats.ts): each question shows the two bars drawn side by
 * side, plays each in the recording (the part's stem, or the full mix), and
 * takes the answer with a button. An answer is written into the manifest's
 * chart entry (sameAs or distinct) at once, and the questions are worked out
 * again, since one answer can change the rest. Answered bars are listed so an
 * answer can be taken back. Rebuild the song when done.
 *
 * Usage:
 *   npm run song:chart-review -- <song folder or .song.json> [--port N]
 *
 * Without --port it takes the first free port from 3100, so two songs can
 * be open at once.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { basename, extname, join } from "node:path";
import { SongManifestSchema, ordinal, resolveBeatMap } from "../manifest.js";
import { beatMapCurve, beatMapToBeats } from "../core/beat-map.js";
import { buildChartsFile } from "../charts/build.js";
import { questionGroup } from "../charts/near-repeats.js";
import { answer, clearAnswer, playWindow, stemFor } from "../charts/review.js";
import { sourceTime } from "../charts/chord-timeline.js";
import { notationCss, renderRanges } from "../charts/notation-svg.js";
import { ALPHATAB_DIR } from "../teleprompter/alphatab-files.js";
import type { Drawing } from "../teleprompter/drawings.js";
import { songArgOrExit } from "../core/song-arg.js";

const args = process.argv.slice(2);
const portFlag = args.indexOf("--port");
const askedPort = portFlag >= 0 ? Number(args.splice(portFlag, 2)[1]) : null;
const { dir, manifest: manifestPath } = songArgOrExit(args[0], "usage: npm run song:chart-review -- <song folder or .song.json> [--port N]");
const manifestName = basename(manifestPath);

const readRaw = () => JSON.parse(readFileSync(manifestPath, "utf8"));
const writeRaw = (m: unknown) => writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");

/** Drawn bars, by chart id and score bar; a score's bars don't change while the page is up. */
const drawn = new Map<string, Drawing | null>();

async function state() {
  const manifest = SongManifestSchema.parse(readRaw());
  manifest.sources.recording.beatMap = resolveBeatMap(manifest.sources.recording.beatMap, dir);
  const { offset } = beatMapToBeats(manifest.sources.recording.beatMap, manifest.bpm);
  const timing = { curve: beatMapCurve(manifest.sources.recording.beatMap, manifest.bpm), clips: manifest.sources.stems?.clips, offset, bpm: manifest.bpm };
  const read = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
  const file = buildChartsFile({ ...manifest, chords: undefined }, read);
  const stems = manifest.sources.stems?.files as Record<string, string> | undefined;
  const sectionName = (i: number) => {
    const s = file.sections[i];
    return file.sections.filter((t) => t.name === s.name).length > 1 ? `${s.name} (${ordinal(s.occurrence)})` : s.name;
  };

  const charts = [];
  for (const chart of file.charts) {
    const entry = manifest.charts?.find((c) => c.id === chart.id);
    const questions = chart.questions ?? [];
    const need = [...new Set(questions.flatMap((q) => [q.scoreBar, q.like]))].filter((n) => !drawn.has(`${chart.id}:${n}`));
    if (need.length) {
      const scoreFile = manifest.scores!.find((s) => s.id === chart.score)!.file;
      const got = await renderRanges(read(scoreFile), chart.track, chart.kind, need.map((start) => ({ start, count: 1 })));
      for (const n of need) drawn.set(`${chart.id}:${n}`, got[`${n}+1`] ?? null);
    }
    const toTime = (beat: number) => sourceTime(beat, timing);
    charts.push({
      id: chart.id,
      instrument: chart.instrument,
      stem: stemFor(chart.instrument, stems),
      questions: questions.map((q) => ({
        ...q,
        group: questionGroup(q),
        sectionName: sectionName(q.section),
        svg: { bar: drawn.get(`${chart.id}:${q.scoreBar}`)?.svg ?? null, like: drawn.get(`${chart.id}:${q.like}`)?.svg ?? null },
        play: { bar: playWindow(chart.bars, q.section, q.scoreBar, toTime), like: playWindow(chart.bars, q.section, q.like, toTime) },
      })),
      answered: { sameAs: entry?.sameAs ?? {}, distinct: entry?.distinct ?? [] },
    });
  }
  return { title: manifest.title, mix: true, charts };
}

/** Audio files the page may play: the recording, and each stem by name. */
function audioPath(name: string): string | null {
  const manifest = readRaw();
  if (name === "mix") return join(dir, manifest.sources.recording.file);
  const stems = manifest.sources.stems;
  const file = stems?.files?.[name];
  return file ? join(dir, stems.dir ?? "", file) : null;
}

const TYPES: Record<string, string> = { ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac", ".opus": "audio/ogg" };

/** Serve a file, honoring a byte Range so the page can seek. */
function sendFile(req: IncomingMessage, res: ServerResponse, path: string, type: string): void {
  const size = statSync(path).size;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1, "Accept-Ranges": "bytes" });
    createReadStream(path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
    createReadStream(path).pipe(res);
  }
}

const body = (req: IncomingMessage) =>
  new Promise<string>((ok) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => ok(s));
  });

const json = (res: ServerResponse, value: unknown, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(PAGE);
    }
    if (url.pathname === "/font.woff2") return sendFile(req, res, join(ALPHATAB_DIR, "font/Bravura.woff2"), "font/woff2");
    if (url.pathname === "/state") return json(res, await state());
    if (url.pathname.startsWith("/audio/")) {
      const path = audioPath(decodeURIComponent(url.pathname.slice("/audio/".length)));
      if (!path) return json(res, { error: "no such audio" }, 404);
      return sendFile(req, res, path, TYPES[extname(path).toLowerCase()] ?? "application/octet-stream");
    }
    if (req.method === "POST" && (url.pathname === "/answer" || url.pathname === "/clear")) {
      const a = JSON.parse(await body(req)) as { chart: string; scoreBar: number; like?: number | null };
      const next = url.pathname === "/answer" ? answer(readRaw(), a.chart, a.scoreBar, a.like ?? null) : clearAnswer(readRaw(), a.chart, a.scoreBar);
      writeRaw(next);
      return json(res, await state());
    }
    json(res, { error: "not found" }, 404);
  } catch (err) {
    json(res, { error: (err as Error).message }, 500);
  }
});

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chart review</title>
<style>
  ${notationCss("/font.woff2")}
  :root { color-scheme: dark; --bg: #111; --card: #1c1c1c; --line: #333; --text: #eee; --dim: #999; --accent: #ffcc00; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: -apple-system, system-ui, sans-serif; padding: 16px; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  .hint { color: var(--dim); font-size: 0.9rem; margin-bottom: 16px; }
  h2 { font-size: 1.1rem; margin: 24px 0 8px; color: var(--accent); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
  .card.focus { border-color: var(--accent); }
  .meta { color: var(--dim); font-size: 0.9rem; margin-bottom: 8px; }
  .runs { font-family: ui-monospace, monospace; font-size: 0.9rem; margin: 6px 0; white-space: pre; }
  .bars { display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-end; }
  .bar { display: flex; flex-direction: column; gap: 4px; }
  .bar .label { font-size: 0.85rem; color: var(--dim); }
  .notation { color: var(--text); background: #000; border-radius: 4px; padding: 4px; overflow-x: auto; max-width: 100%; }
  .notation svg { display: block; }
  button { background: #2a2a2a; color: var(--text); border: 1px solid #444; border-radius: 6px; padding: 6px 12px; font-size: 0.95rem; cursor: pointer; }
  button:hover { border-color: var(--accent); }
  button.same { background: #1e3a24; } button.diff { background: #3a1e1e; }
  .actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .source { margin-bottom: 12px; }
  .answered { color: var(--dim); font-size: 0.9rem; }
  .answered button { padding: 2px 8px; font-size: 0.8rem; margin-left: 6px; }
  .busy { opacity: 0.5; pointer-events: none; }
</style>
</head>
<body>
<h1 id="title">Chart review</h1>
<div class="hint">Keys for the highlighted question: <b>1</b> play this bar, <b>2</b> play the bar it's like, <b>s</b> same, <b>d</b> different.</div>
<div class="source">Play: <label><input type="radio" name="src" value="stem" checked> the part's stem</label> <label><input type="radio" name="src" value="mix"> full mix</label></div>
<div id="list"></div>
<script>
const list = document.getElementById("list");
const audio = new Audio();
let stopAt = null, focusCard = null;

function tick() {
  if (stopAt !== null && audio.currentTime >= stopAt) { audio.pause(); stopAt = null; }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function play(stem, w) {
  if (!w) return;
  const useStem = document.querySelector('input[name=src]:checked').value === "stem" && stem;
  const src = "/audio/" + encodeURIComponent(useStem ? stem : "mix");
  const go = () => { audio.currentTime = w.start; stopAt = w.end; audio.play(); };
  if (!audio.src.endsWith(src)) { audio.src = src; audio.addEventListener("loadedmetadata", go, { once: true }); }
  else go();
}

async function post(path, payload) {
  document.body.classList.add("busy");
  const r = await fetch(path, { method: "POST", body: JSON.stringify(payload) });
  document.body.classList.remove("busy");
  render(await r.json());
}

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

function drawing(svg, label) {
  const box = el("div", "bar");
  box.appendChild(el("div", "label", label));
  const n = el("div", "notation");
  if (svg) n.innerHTML = svg; else n.textContent = "(couldn't draw)";
  box.appendChild(n);
  return box;
}

function render(state) {
  if (state.error) { list.textContent = state.error; return; }
  document.getElementById("title").textContent = "Chart review: " + state.title;
  list.innerHTML = "";
  focusCard = null;
  let total = 0;
  for (const chart of state.charts) {
    const answered = Object.keys(chart.answered.sameAs).length + chart.answered.distinct.length;
    if (!chart.questions.length && !answered) continue;
    list.appendChild(el("h2", null, chart.id + (chart.questions.length ? " (" + chart.questions.length + " to answer)" : "")));
    for (const q of chart.questions) {
      total++;
      const card = el("div", "card");
      card.appendChild(el("div", "meta", q.sectionName + " · " + q.group + " (" + q.differ + " of " + q.of + " beats)"));
      const bars = el("div", "bars");
      bars.appendChild(drawing(q.svg.bar, "bar " + q.scoreBar));
      bars.appendChild(drawing(q.svg.like, "bar " + q.like + " (played more often)"));
      card.appendChild(bars);
      card.appendChild(el("div", "runs", "now:          " + q.before));
      card.appendChild(el("div", "runs", "if the same:  " + q.after));
      const actions = el("div", "actions");
      const b = (text, cls, fn) => { const x = el("button", cls, text); x.onclick = fn; actions.appendChild(x); return x; };
      const playBar = () => play(chart.stem, q.play.bar), playLike = () => play(chart.stem, q.play.like);
      const same = () => post("/answer", { chart: chart.id, scoreBar: q.scoreBar, like: q.like });
      const diff = () => post("/answer", { chart: chart.id, scoreBar: q.scoreBar, like: null });
      b("▶ bar " + q.scoreBar, "", playBar).disabled = !q.play.bar;
      b("▶ bar " + q.like, "", playLike).disabled = !q.play.like;
      b("Same", "same", same);
      b("Different", "diff", diff);
      card.appendChild(actions);
      card.keys = { "1": playBar, "2": playLike, s: same, d: diff };
      card.onclick = () => setFocus(card);
      list.appendChild(card);
      if (!focusCard) setFocus(card);
    }
    if (answered) {
      const a = el("div", "answered", "Answered: ");
      for (const [bar, like] of Object.entries(chart.answered.sameAs)) {
        const s = el("span", null, "bar " + bar + " same as " + like);
        const x = el("button", null, "undo"); x.onclick = () => post("/clear", { chart: chart.id, scoreBar: Number(bar) });
        s.appendChild(x); a.appendChild(s); a.appendChild(document.createTextNode("  "));
      }
      for (const bar of chart.answered.distinct) {
        const s = el("span", null, "bar " + bar + " different");
        const x = el("button", null, "undo"); x.onclick = () => post("/clear", { chart: chart.id, scoreBar: bar });
        s.appendChild(x); a.appendChild(s); a.appendChild(document.createTextNode("  "));
      }
      list.appendChild(a);
    }
  }
  if (!total) list.appendChild(el("p", null, "No questions left. Rebuild the song to see the chart."));
}

function setFocus(card) {
  if (focusCard) focusCard.classList.remove("focus");
  focusCard = card;
  card.classList.add("focus");
}

document.addEventListener("keydown", (e) => {
  if (!focusCard || e.metaKey || e.ctrlKey) return;
  const fn = focusCard.keys[e.key];
  if (fn) { e.preventDefault(); fn(); }
});

fetch("/state").then((r) => r.json()).then(render);
</script>
</body>
</html>`;

// The port asked for, or the first free one from 3100 (another song's review may be open).
let port = askedPort ?? 3100;
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE" && askedPort === null && port < 3120) server.listen(++port);
  else throw err;
});
server.on("listening", () => {
  const url = `http://localhost:${port}/`;
  console.log(`chart review for ${manifestName}: ${url}`);
  execFile("open", ["-a", "Google Chrome", url], () => {});
});
server.listen(port);
