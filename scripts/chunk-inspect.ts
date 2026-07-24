/**
 * chunk-inspect — a playback tool for understanding the chunked aligner.
 *
 *   npm run chunk-inspect -- <song-dir>
 *
 * Serves a local page that plays the song (mix or vocal stem, toggle) over a
 * timeline of the aligner's chunks and silence gaps. For each chunk it shows
 * what Whisper heard and what lyric span the matcher assigned to it — so you can
 * see, span by span, why the alignment landed where it did.
 *
 * Reads every `*.chunks.json` debug artifact in the stem dir (the chunk aligner
 * writes one with --debug). Multiple — e.g. `source_vocals.chunks.json` and
 * `source_vocals.large.chunks.json` — appear as switchable datasets so you can
 * compare Whisper models over the same audio. If none exist, run `npm run align`
 * (the recipe passes --debug) or the aligner directly with --debug first.
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
const stemsDirAbs = join(songDir, stemsDir);

// Discover every debug artifact. Label = the bit between the stem base and
// `.chunks.json` (`source_vocals.chunks.json` -> "base"; `.large.` -> "large").
function labelOf(fn: string): string {
  const mid = fn.replace(/\.chunks\.json$/, "").split(".").slice(1).join(".");
  return mid || "base";
}
const datasets = (existsSync(stemsDirAbs) ? readdirSync(stemsDirAbs) : [])
  .filter((f) => f.endsWith(".chunks.json"))
  .map((f) => ({ label: labelOf(f), file: join(stemsDirAbs, f) }))
  .sort((a, b) => (a.label === "base" ? -1 : b.label === "base" ? 1 : a.label.localeCompare(b.label)));

if (datasets.length === 0) {
  console.error(`no *.chunks.json debug artifacts in ${stemsDirAbs}`);
  console.error(`run \`npm run align\` (the recipe passes --debug), or the aligner directly with --debug.`);
  process.exit(1);
}

const TYPES: Record<string, string> = { ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav" };

/** Serve a (possibly large) file with HTTP Range support so media seeks work. */
function serveFile(path: string, req: any, res: any) {
  if (!existsSync(path)) {
    res.writeHead(404).end("not found");
    return;
  }
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
  } else if (url === "/datasets") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(datasets.map((d) => d.label)));
  } else if (url.startsWith("/data/")) {
    const label = decodeURIComponent(url.slice("/data/".length));
    const ds = datasets.find((d) => d.label === label);
    if (!ds) return res.writeHead(404).end("no such dataset");
    res.writeHead(200, { "Content-Type": "application/json" }).end(readFileSync(ds.file, "utf8"));
  } else if (url === "/mix") {
    serveFile(mixPath, req, res);
  } else if (url === "/stem") {
    serveFile(stemPath, req, res);
  } else {
    res.writeHead(404).end("not found");
  }
});

const PORT = 4599;
server.listen(PORT, () => {
  console.error(`chunk-inspect: ${basename(songDir)}`);
  console.error(`  mix : ${existsSync(mixPath) ? mixPath : "(missing)"}`);
  console.error(`  stem: ${existsSync(stemPath) ? stemPath : "(missing)"}`);
  console.error(`  datasets: ${datasets.map((d) => d.label).join(", ")}`);
  console.error(`\n  open  http://localhost:${PORT}\n`);
});

const PAGE = /* html */ `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>chunk-inspect</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: #14161a; color: #d6dae0; }
  header { padding: 12px 16px; border-bottom: 1px solid #2a2f37; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  button, select { font: inherit; background: #262b33; color: #d6dae0; border: 1px solid #3a414c; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  button:hover { background: #30363f; }
  button.on { background: #2d6cdf; border-color: #2d6cdf; color: #fff; }
  label.sel { color: #8b93a0; display: flex; gap: 6px; align-items: center; }
  .spacer { flex: 1; }
  .time { color: #8b93a0; font-variant-numeric: tabular-nums; }
  main { padding: 16px; }
  .tl-wrap { position: relative; margin: 8px 0 4px; }
  .timeline { position: relative; height: 72px; background: #0e1013; border: 1px solid #2a2f37; border-radius: 6px; overflow: hidden; cursor: pointer; }
  .block { position: absolute; top: 0; bottom: 0; border-radius: 3px; overflow: hidden; }
  .block .lbl { position: absolute; top: 2px; left: 3px; font-size: 10px; color: rgba(255,255,255,.75); pointer-events: none; white-space: nowrap; }
  .lyric      { background: #2f6b3f; }
  .unassigned { background: #7a5a24; }
  .dropped    { background: #33383f; }
  .failed     { outline: 2px solid #d0453f; outline-offset: -2px; }
  .block.sel  { box-shadow: 0 0 0 2px #fff inset; }
  .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: #ff5c57; pointer-events: none; left: 0; }
  .axis { position: relative; height: 16px; color: #6b7280; font-size: 10px; }
  .axis span { position: absolute; transform: translateX(-50%); }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; margin: 10px 0 18px; color: #9aa2ae; font-size: 12px; }
  .legend i { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
  .panels { display: grid; grid-template-columns: 340px 1fr; gap: 16px; align-items: start; }
  .now { background: #1a1e24; border: 1px solid #2a2f37; border-radius: 8px; padding: 14px; position: sticky; top: 16px; }
  .now h2 { margin: 0 0 8px; font-size: 13px; color: #8b93a0; text-transform: uppercase; letter-spacing: .05em; }
  .now .k { color: #8b93a0; }
  .now .field { margin: 10px 0; }
  .now .field .h { color: #8b93a0; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 2px; }
  .now .whisper { color: #d9b56b; }
  .now .assigned { color: #7fce93; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #21262d; vertical-align: top; }
  th { color: #8b93a0; position: sticky; top: 0; background: #14161a; }
  tr { cursor: pointer; }
  tr:hover td { background: #1a1e24; }
  tr.cur td { background: #223; }
  td.w { color: #d9b56b; }
  td.a { color: #7fce93; }
  td.n { color: #5b626d; font-style: italic; }
  .tag { font-size: 10px; padding: 1px 6px; border-radius: 10px; }
  .tag.lyric { background: #2f6b3f; } .tag.unassigned { background: #7a5a24; } .tag.dropped { background: #33383f; color: #9aa2ae; }
</style></head>
<body>
<header>
  <strong>chunk-inspect</strong>
  <label class="sel">dataset <select id="dataset"></select></label>
  <button id="play">▶ play</button>
  <button id="src-mix" class="on">mix</button>
  <button id="src-stem">vocal stem</button>
  <span class="time" id="clock">0:00</span>
  <span class="spacer"></span>
  <span class="time" id="count"></span>
</header>
<main>
  <div class="tl-wrap">
    <div class="timeline" id="tl"><div class="playhead" id="ph"></div></div>
  </div>
  <div class="axis" id="axis"></div>
  <div class="legend">
    <span><i class="lyric" style="background:#2f6b3f"></i>lyric (aligned)</span>
    <span><i style="background:#7a5a24"></i>lyric chunk, no lyrics assigned</span>
    <span><i style="background:#33383f"></i>dropped (instrumental / bleed)</span>
    <span><i style="background:#0e1013;outline:2px solid #d0453f"></i>align failed</span>
    <span><i style="background:#0e1013;border:1px solid #2a2f37"></i>silence (gap)</span>
  </div>
  <div class="panels">
    <div class="now" id="now"><h2>at playhead</h2><div id="nowbody" class="k">—</div></div>
    <div>
      <table><thead><tr><th>#</th><th>time</th><th>kind</th><th>whisper heard</th><th>aligned to chunk</th></tr></thead>
      <tbody id="rows"></tbody></table>
    </div>
  </div>
</main>
<audio id="au" preload="auto"></audio>
<script>
const fmt = s => { s = Math.max(0, s||0); return Math.floor(s/60) + ':' + String(Math.floor(s%60)).padStart(2,'0'); };
const au = document.getElementById('au');
let data, dur = 0, sel = null;

function setSrc(kind, keepTime) {
  const t = au.currentTime, playing = !au.paused;
  au.src = kind === 'mix' ? '/mix' : '/stem';
  document.getElementById('src-mix').classList.toggle('on', kind==='mix');
  document.getElementById('src-stem').classList.toggle('on', kind==='stem');
  au.addEventListener('loadedmetadata', () => { if (keepTime) au.currentTime = t; if (playing) au.play(); }, { once:true });
}

async function loadData(label) {
  data = await (await fetch('/data/' + encodeURIComponent(label))).json();
  const last = data.chunks.length ? data.chunks[data.chunks.length-1].endMs/1000 : 0;
  dur = Math.max(dur, last + 2, au.duration && isFinite(au.duration) ? au.duration : 0);
  document.getElementById('count').textContent =
    label + ': ' + data.chunks.length + ' chunks · ' + data.chunks.filter(c=>c.kind==='lyric').length + ' lyric · '
    + data.chunks.filter(c=>c.kind==='dropped').length + ' dropped · ' + data.chunks.filter(c=>c.alignFailed).length + ' failed';
  render();
}

(async () => {
  const labels = await (await fetch('/datasets')).json();
  const dd = document.getElementById('dataset');
  labels.forEach(l => { const o=document.createElement('option'); o.value=o.textContent=l; dd.appendChild(o); });
  dd.onchange = () => loadData(dd.value);
  setSrc('mix', false);
  au.addEventListener('loadedmetadata', () => { if (au.duration && isFinite(au.duration)) { dur = Math.max(dur, au.duration); render(); } }, { once:true });
  await loadData(labels[0]);
})();

function cls(c) { return c.kind==='dropped' ? 'dropped' : (c.assigned ? 'lyric' : 'unassigned'); }

function render() {
  if (!data) return;
  const tl = document.getElementById('tl');
  [...tl.querySelectorAll('.block')].forEach(b=>b.remove());
  for (const c of data.chunks) {
    const b = document.createElement('div');
    b.className = 'block ' + cls(c) + (c.alignFailed ? ' failed' : '');
    b.style.left = (c.startMs/1000/dur*100) + '%';
    b.style.width = Math.max(0.15, (c.endMs-c.startMs)/1000/dur*100) + '%';
    b.title = '#'+c.index+' '+fmt(c.startMs/1000)+'–'+fmt(c.endMs/1000);
    b.innerHTML = '<span class="lbl">'+c.index+'</span>';
    b.onclick = e => { e.stopPropagation(); au.currentTime = c.startMs/1000; select(c.index); };
    tl.appendChild(b);
  }
  const axis = document.getElementById('axis'); axis.innerHTML = '';
  for (let s=0; s<=dur; s+=30) { const el=document.createElement('span'); el.style.left=(s/dur*100)+'%'; el.textContent=fmt(s); axis.appendChild(el); }
  const rows = document.getElementById('rows'); rows.innerHTML = '';
  for (const c of data.chunks) {
    const tr = document.createElement('tr'); tr.dataset.i = c.index;
    tr.innerHTML = '<td>'+c.index+'</td>'
      + '<td class="time">'+fmt(c.startMs/1000)+'–'+fmt(c.endMs/1000)+'</td>'
      + '<td><span class="tag '+cls(c)+'">'+(c.kind==='dropped'?'dropped':(c.assigned?'lyric':'no match'))+(c.alignFailed?' · failed':'')+'</span></td>'
      + '<td class="w">'+(c.whisper||'<span class="n">—</span>')+'</td>'
      + '<td class="'+(c.assigned?'a':'n')+'">'+(c.assigned||'—')+'</td>';
    tr.onclick = () => { au.currentTime = c.startMs/1000; select(c.index); };
    rows.appendChild(tr);
  }
  if (sel !== null) select(sel);
}

function chunkAt(t) { const ms=t*1000; return data && data.chunks.find(c => ms>=c.startMs && ms<c.endMs) || null; }

function select(i) {
  sel = i;
  const chunks = data.chunks;
  document.querySelectorAll('#tl .block').forEach((b,k)=>b.classList.toggle('sel', chunks[k] && chunks[k].index===i));
  document.querySelectorAll('#rows tr').forEach(tr=>tr.classList.toggle('cur', +tr.dataset.i===i));
  const c = chunks.find(x=>x.index===i);
  const nb = document.getElementById('nowbody');
  if (!c) { nb.innerHTML='<span class="k">(silence — no chunk here)</span>'; return; }
  nb.innerHTML = '<div><span class="k">chunk #'+c.index+'</span> · '+fmt(c.startMs/1000)+'–'+fmt(c.endMs/1000)
    +' · '+((c.endMs-c.startMs)/1000).toFixed(1)+'s · '+c.kind+(c.alignFailed?' · <b style="color:#d0453f">align failed</b>':'')+'</div>'
    +'<div class="field"><div class="h">whisper heard</div><div class="whisper">'+(c.whisper||'—')+'</div></div>'
    +'<div class="field"><div class="h">aligned to chunk</div><div class="assigned">'+(c.assigned||'<span class="k">(none)</span>')+'</div></div>';
}

au.addEventListener('timeupdate', () => {
  document.getElementById('clock').textContent = fmt(au.currentTime) + ' / ' + fmt(dur);
  document.getElementById('ph').style.left = (au.currentTime/dur*100) + '%';
  const c = chunkAt(au.currentTime);
  if (c && c.index !== sel) select(c.index);
});
document.getElementById('tl').onclick = e => {
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
