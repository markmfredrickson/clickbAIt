/**
 * desilence-inspect — a playback tool for the desilence-concatenate aligner.
 *
 *   npm run desilence-inspect -- <song-dir>
 *
 * Serves a local page that plays the song (mix or vocal stem) over two aligned
 * lanes on one timeline:
 *   - SEGMENTS — the kept voiced regions the `chunk` splitter produced (silence
 *     gaps show as empty). Spot where real vocal audio was dropped/trimmed.
 *   - LINES — where the alignment placed each lyric line (source time).
 * Overlaying them is the QC: a line sitting over a silence gap, or lines
 * bunching, jumps out — then scrub there and listen to confirm.
 *
 * Reads `<stem>.desilence.json` (the segment map, written by
 * desilence-align-cli --debug) and its `<stem>.desilence.align.json` sibling.
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync, statSync, createReadStream } from "node:fs";
import { resolve, join, basename } from "node:path";

const songDir = resolve(process.argv[2] ?? ".");
if (!existsSync(songDir)) {
  console.error(`no such dir: ${songDir}`);
  process.exit(1);
}

function findManifest(): any | null {
  const f = readdirSync(songDir).find((n) => n.endsWith(".song.json"));
  return f ? JSON.parse(readFileSync(join(songDir, f), "utf8")) : null;
}
const manifest = findManifest();
const mixPath = join(songDir, manifest?.sources?.recording?.file ?? "source.m4a");
const stemsDir = manifest?.sources?.stems?.dir ?? "stems/";
const vocalsFile = manifest?.sources?.stems?.files?.vocals ?? "source_vocals.wav";
const stemPath = join(songDir, stemsDir, vocalsFile);
const stemBase = vocalsFile.replace(/\.wav$/, "");
const mapPath = join(songDir, stemsDir, `${stemBase}.desilence.json`);
const alignPath = join(songDir, stemsDir, `${stemBase}.desilence.align.json`);

if (!existsSync(mapPath) || !existsSync(alignPath)) {
  console.error(`missing desilence artifacts in ${join(songDir, stemsDir)}`);
  console.error(`  need ${basename(mapPath)} + ${basename(alignPath)}`);
  console.error(`  run: npx tsx src/authoring/desilence-align-cli.ts <stem> --text <lyrics> -o <align> --debug <map>`);
  process.exit(1);
}

const TYPES: Record<string, string> = { ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
function serveFile(path: string, req: any, res: any) {
  if (!existsSync(path)) return void res.writeHead(404).end("not found");
  const size = statSync(path).size;
  const type = TYPES[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";
  const range = req.headers.range as string | undefined;
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": type,
    });
    createReadStream(path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Length": size, "Accept-Ranges": "bytes", "Content-Type": type });
    createReadStream(path).pipe(res);
  }
}

const server = createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
  } else if (url === "/data") {
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    const align = JSON.parse(readFileSync(alignPath, "utf8"));
    const payload = {
      sampleRate: map.sampleRate,
      joinGapMs: map.joinGapMs,
      padMs: map.padMs,
      segments: map.segments,
      lines: align.lines,
      words: align.words.map((w: any) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs })),
    };
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
  } else if (url === "/mix") {
    serveFile(mixPath, req, res);
  } else if (url === "/stem") {
    serveFile(stemPath, req, res);
  } else {
    res.writeHead(404).end("not found");
  }
});

const PORT = 4600;
server.listen(PORT, () => {
  console.error(`desilence-inspect: ${basename(songDir)}`);
  console.error(`  mix : ${existsSync(mixPath) ? mixPath : "(missing)"}`);
  console.error(`  stem: ${existsSync(stemPath) ? stemPath : "(missing)"}`);
  console.error(`  map : ${mapPath}`);
  console.error(`\n  open  http://localhost:${PORT}\n`);
});

const PAGE = /* html */ `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>desilence-inspect</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: #14161a; color: #d6dae0; }
  header { padding: 12px 16px; border-bottom: 1px solid #2a2f37; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  button { font: inherit; background: #262b33; color: #d6dae0; border: 1px solid #3a414c; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  button:hover { background: #30363f; }
  button.on { background: #2d6cdf; border-color: #2d6cdf; color: #fff; }
  .spacer { flex: 1; }
  .time { color: #8b93a0; font-variant-numeric: tabular-nums; }
  main { padding: 16px; }
  .lane-label { color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; margin: 10px 0 3px; }
  .tl { position: relative; background: #0e1013; border: 1px solid #2a2f37; border-radius: 6px; cursor: pointer; overflow: hidden; }
  .tl.segs { height: 40px; }
  .tl.lines { height: 54px; }
  .block { position: absolute; top: 2px; bottom: 2px; border-radius: 3px; overflow: hidden; font-size: 10px; }
  .seg { background: #2f6b3f; }
  .ln  { background: #35507a; border: 1px solid #4a6ea5; color: #cde0ff; padding: 1px 3px; white-space: nowrap; }
  .ln.gapwarn { background: #7a3b3b; border-color: #d0453f; }
  .ln.cur { background: #2d6cdf; border-color: #6fa0ff; }
  .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: #ff5c57; pointer-events: none; z-index: 5; }
  .axis { position: relative; height: 16px; color: #6b7280; font-size: 10px; margin-top: 2px; }
  .axis span { position: absolute; transform: translateX(-50%); }
  .panels { display: grid; grid-template-columns: 1fr 360px; gap: 16px; align-items: start; margin-top: 18px; }
  .now { background: #1a1e24; border: 1px solid #2a2f37; border-radius: 8px; padding: 16px; min-height: 90px; }
  .now .meta { color: #8b93a0; font-size: 12px; margin-bottom: 8px; }
  .now .line { font-size: 20px; line-height: 1.4; }
  .now .line b { color: #fff; background: #2d6cdf; border-radius: 3px; padding: 0 2px; }
  .now .warn { color: #ff8a84; }
  .side { background: #1a1e24; border: 1px solid #2a2f37; border-radius: 8px; padding: 10px; max-height: 60vh; overflow: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  td { padding: 4px 6px; border-bottom: 1px solid #21262d; vertical-align: top; cursor: pointer; }
  tr:hover td { background: #222834; } tr.cur td { background: #223; }
  td.t { color: #8b93a0; white-space: nowrap; }
  .legend { color: #9aa2ae; font-size: 12px; margin-top: 8px; }
  .legend i { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
</style></head>
<body>
<header>
  <strong>desilence-inspect</strong>
  <button id="play">▶ play</button>
  <button id="src-mix" class="on">mix</button>
  <button id="src-stem">vocal stem</button>
  <span class="time" id="clock">0:00</span>
  <span class="spacer"></span>
  <span class="time" id="count"></span>
</header>
<main>
  <div class="lane-label">segments (kept voiced) — gaps = deleted silence</div>
  <div class="tl segs" id="segs"></div>
  <div class="lane-label">aligned lyric lines</div>
  <div class="tl lines" id="lines"><div class="playhead" id="ph"></div></div>
  <div class="axis" id="axis"></div>
  <div class="legend">
    <i class="seg" style="background:#2f6b3f"></i>voiced segment &nbsp;
    <i style="background:#35507a"></i>aligned line &nbsp;
    <i style="background:#7a3b3b"></i>line over silence (suspect) &nbsp;
    <i style="background:#2d6cdf"></i>current
  </div>
  <div class="panels">
    <div class="now" id="now"><div class="meta">at playhead</div><div class="line">—</div></div>
    <div class="side"><table id="rows"></table></div>
  </div>
</main>
<audio id="au" preload="auto"></audio>
<script>
const fmt = s => { s = Math.max(0, s||0); return Math.floor(s/60) + ':' + String(Math.floor(s%60)).padStart(2,'0'); };
const au = document.getElementById('au');
let D, dur = 0, curLine = -1;

function setSrc(kind, keep) {
  const t = au.currentTime, playing = !au.paused;
  au.src = kind === 'mix' ? '/mix' : '/stem';
  document.getElementById('src-mix').classList.toggle('on', kind==='mix');
  document.getElementById('src-stem').classList.toggle('on', kind==='stem');
  au.addEventListener('loadedmetadata', () => { if (keep) au.currentTime = t; if (playing) au.play(); }, { once:true });
}

// Is [aMs,bMs] mostly outside every kept segment? (a line placed over silence)
function overGap(aMs, bMs) {
  const mid = (aMs + bMs) / 2;
  return !D.segments.some(s => mid >= s.sourceStartMs - 60 && mid <= s.sourceEndMs + 60);
}

fetch('/data').then(r=>r.json()).then(d => {
  D = d;
  const lastSeg = d.segments.length ? d.segments[d.segments.length-1].sourceEndMs/1000 : 0;
  const lastLine = d.lines.length ? d.lines[d.lines.length-1].endMs/1000 : 0;
  dur = Math.max(lastSeg, lastLine) + 2;
  const gaps = d.lines.filter(l => overGap(l.startMs, l.endMs)).length;
  document.getElementById('count').textContent =
    d.segments.length + ' segments · ' + d.lines.length + ' lines · ' + d.words.length + ' words' + (gaps ? ' · ' + gaps + ' over silence' : '');
  setSrc('mix', false);
  au.addEventListener('loadedmetadata', () => { if (au.duration && isFinite(au.duration)) { dur = Math.max(dur, au.duration); render(); } }, { once:true });
  render();
});

function render() {
  const segs = document.getElementById('segs');
  segs.innerHTML = '';
  for (const s of D.segments) {
    const b = document.createElement('div');
    b.className = 'block seg';
    b.style.left = (s.sourceStartMs/1000/dur*100) + '%';
    b.style.width = Math.max(0.1, (s.sourceEndMs-s.sourceStartMs)/1000/dur*100) + '%';
    b.title = fmt(s.sourceStartMs/1000)+'–'+fmt(s.sourceEndMs/1000);
    b.onclick = e => { e.stopPropagation(); au.currentTime = s.sourceStartMs/1000; };
    segs.appendChild(b);
  }
  const lines = document.getElementById('lines');
  [...lines.querySelectorAll('.block')].forEach(x=>x.remove());
  D.lines.forEach((l, i) => {
    const b = document.createElement('div');
    b.className = 'block ln' + (overGap(l.startMs, l.endMs) ? ' gapwarn' : '');
    b.dataset.i = i;
    b.style.left = (l.startMs/1000/dur*100) + '%';
    b.style.width = Math.max(0.3, (l.endMs-l.startMs)/1000/dur*100) + '%';
    b.textContent = i;
    b.title = fmt(l.startMs/1000)+'  '+l.text;
    b.onclick = e => { e.stopPropagation(); au.currentTime = l.startMs/1000; };
    lines.appendChild(b);
  });
  const axis = document.getElementById('axis'); axis.innerHTML = '';
  for (let s=0; s<=dur; s+=30) { const el=document.createElement('span'); el.style.left=(s/dur*100)+'%'; el.textContent=fmt(s); axis.appendChild(el); }
  const rows = document.getElementById('rows'); rows.innerHTML = '';
  D.lines.forEach((l, i) => {
    const tr = document.createElement('tr'); tr.dataset.i = i;
    tr.innerHTML = '<td class="t">'+fmt(l.startMs/1000)+'</td><td>'+(overGap(l.startMs,l.endMs)?'⚠ ':'')+l.text+'</td>';
    tr.onclick = () => { au.currentTime = l.startMs/1000; };
    rows.appendChild(tr);
  });
}

function lineAt(ms){ let r=-1; D.lines.forEach((l,i)=>{ if(ms>=l.startMs && ms<=l.endMs) r=i; }); return r; }

function showNow(ms) {
  const i = lineAt(ms);
  const now = document.getElementById('now');
  if (i < 0) { now.querySelector('.line').innerHTML = '<span style="color:#5b626d">— (between lines)</span>'; now.querySelector('.meta').textContent = 'at playhead ' + fmt(ms/1000); return; }
  const l = D.lines[i];
  const warn = overGap(l.startMs, l.endMs);
  now.querySelector('.meta').innerHTML = 'line '+i+' · '+fmt(l.startMs/1000)+'–'+fmt(l.endMs/1000) + (warn ? ' · <span class="warn">⚠ placed over silence</span>' : '');
  // word highlight = the LAST word whose start has passed (stays lit through
  // inter-word gaps and sub-frame-short words, instead of flickering dark).
  let active = -1;
  for (let w = l.wordRange[0]; w <= l.wordRange[1]; w++) {
    if (D.words[w] && D.words[w].startMs <= ms) active = w;
  }
  let html = '';
  for (let w = l.wordRange[0]; w <= l.wordRange[1]; w++) {
    const wd = D.words[w]; if (!wd) continue;
    html += (w === active ? '<b>'+wd.text+'</b>' : wd.text) + ' ';
  }
  now.querySelector('.line').innerHTML = html || l.text;
}

function update() {
  if (!D) return; // data not loaded yet — keep the rAF loop alive, do nothing
  const ms = au.currentTime*1000;
  document.getElementById('clock').textContent = fmt(au.currentTime) + ' / ' + fmt(dur);
  document.getElementById('ph').style.left = (au.currentTime/dur*100) + '%';
  showNow(ms);
  const i = lineAt(ms);
  if (i !== curLine) {
    curLine = i;
    document.querySelectorAll('#lines .block').forEach(b => b.classList.toggle('cur', +b.dataset.i === i));
    document.querySelectorAll('#rows tr').forEach(tr => tr.classList.toggle('cur', +tr.dataset.i === i));
    const row = document.querySelector('#rows tr.cur'); if (row) row.scrollIntoView({block:'nearest'});
  }
}
// Poll at frame rate (~60fps) instead of the ~4Hz 'timeupdate' event, so a
// word shorter than a timeupdate tick (~250ms) isn't skipped between updates.
// Also covers seek-while-paused for free (rAF runs regardless of play state).
function tick(){ update(); requestAnimationFrame(tick); }
requestAnimationFrame(tick);
for (const id of ['segs','lines']) document.getElementById(id).onclick = e => {
  const r = e.currentTarget.getBoundingClientRect();
  au.currentTime = (e.clientX - r.left)/r.width * dur;
};
document.getElementById('play').onclick = () => au.paused ? au.play() : au.pause();
au.addEventListener('play', ()=>document.getElementById('play').textContent='⏸ pause');
au.addEventListener('pause', ()=>document.getElementById('play').textContent='▶ play');
document.getElementById('src-mix').onclick = () => setSrc('mix', true);
document.getElementById('src-stem').onclick = () => setSrc('stem', true);
</script>
</body></html>`;
