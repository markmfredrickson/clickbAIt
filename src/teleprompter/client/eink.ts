/**
 * E-ink client (Kindle browser): shows the relay's pre-rendered panes for the
 * current song and follows the beat.
 *
 * The page asks the relay for the song at its own size, as panes stacked in
 * the order of `channels=` (drums above lyrics, say). Each pane is its own
 * set of page images and turns on its own, as its bottom row starts (see
 * panes.ts); a box inverts what's playing in it, and under a drum run a bar
 * fills one step per pass. A strip at the top names the song and section.
 * Tapping a pane turns it by hand (left third back, the rest forward) and
 * holds every pane there until LIVE is tapped.
 *
 * The Kindle's sleep timer counts only touches, so the page shows a tap
 * reminder after a song (or near the timer's end) and treats a tap on the
 * reminder or the top strip as a touch that doesn't turn a page.
 *
 * Query options: ?channels=drums,lyrics, ?<channel>.rows=<n> (rows a pane
 * shows; the last pane fills the screen unless told), ?lookahead=<beats>
 * (turn and light early; default 1), ?marker=bar|0, ?font=<px>,
 * ?sleep=<minutes> (the Kindle's sleep timer; default 10).
 */

import { markAt, passOf, type EinkDeck, type EinkPane } from "../eink/layout.js";
import { panePageAt } from "../panes.js";
import { needsTapReminder } from "../eink/awake.js";

const params = new URLSearchParams(location.search);
const W = window.innerWidth;
const H = window.innerHeight;
const DPR = window.devicePixelRatio || 1;
/** The strip at the top: the song and section. */
const HEAD = Math.round(H * 0.045);
const lookahead = params.has("lookahead") ? Number(params.get("lookahead")) : 1;

const stage = document.getElementById("stage")!;
const head = document.getElementById("head")!;
const msg = document.getElementById("msg")!;
const dot = document.getElementById("dot")!;
const live = document.getElementById("live")!;
const awake = document.getElementById("awake")!;
const sleepMs = (params.has("sleep") ? Number(params.get("sleep")) : 10) * 60_000;
let lastTouch = Date.now();
const markerMode = params.get("marker");
head.style.height = `${HEAD}px`;
head.style.fontSize = `${Math.round(HEAD * 0.6)}px`;
head.style.lineHeight = `${HEAD}px`;

/** A pane on screen: its images, its marker, and the page it shows. */
interface Shown {
  pane: EinkPane;
  imgs: HTMLImageElement[];
  marker: HTMLElement;
  passBar: HTMLElement;
  page: number;
}

let deck: EinkDeck | null = null;
let shown: Shown[] = [];
let title = "";
let sections: { name: string; startBeat: number }[] = [];
let sectionShown = -2;
let beat = -Infinity;
let manual = false;
let connected = false;
/** Bumped per song load, so a slow response for an old song is dropped. */
let generation = 0;

function say(text: string | null): void {
  msg.textContent = text ?? "";
  msg.style.display = text ? "block" : "none";
}

function status(): void {
  dot.style.display = connected ? "none" : "block";
  live.style.display = manual ? "block" : "none";
}

function showPage(s: Shown, p: number): void {
  p = Math.max(0, Math.min(s.pane.pages.length - 1, p));
  if (p === s.page) return;
  if (s.page >= 0) s.imgs[s.page].style.display = "none";
  s.imgs[p].style.display = "block";
  s.page = p;
}

/** Invert what's playing on the pane's page, and fill a drum run's pass bar. */
function light(s: Shown): void {
  const marks = s.pane.pages[s.page]?.marks ?? [];
  // A drum pass counts the bar actually playing; the rest light a little early.
  const at = s.pane.kind === "drums" ? beat : beat + lookahead;
  const i = manual || markerMode === "0" ? -1 : markAt(marks, at);
  const m = marks[i];
  if (!m) {
    s.marker.style.display = "none";
    s.passBar.style.display = "none";
    return;
  }
  if (markerMode === "bar") {
    Object.assign(s.marker.style, { left: "0", top: `${m.y}px`, width: "14px", height: `${m.h}px` });
  } else {
    Object.assign(s.marker.style, { left: `${m.x - 4}px`, top: `${m.y - 4}px`, width: `${m.w + 8}px`, height: `${m.h + 8}px` });
  }
  s.marker.style.display = "block";
  const pass = passOf(m, beat);
  if (pass && pass.of > 1) {
    Object.assign(s.passBar.style, { left: `${m.x}px`, top: `${m.y + m.h + 6}px`, width: `${(m.w * pass.pass) / pass.of}px` });
    s.passBar.style.display = "block";
  } else {
    s.passBar.style.display = "none";
  }
}

/** Name the section playing, only when it changes (every redraw costs on e-ink). */
function showSection(): void {
  let i = -1;
  for (let k = 0; k < sections.length; k++) if (sections[k].startBeat <= beat) i = k;
  if (i === sectionShown) return;
  sectionShown = i;
  head.textContent = title + (i >= 0 ? ` : ${sections[i].name}` : "");
}

function follow(): void {
  if (!deck) return;
  showSection();
  for (const s of shown) {
    if (!manual) showPage(s, panePageAt(s.pane.pages, beat + lookahead));
    light(s);
  }
}

async function loadDeck(): Promise<void> {
  const gen = ++generation;
  say("Loading pages…");
  const passOn = ["font", "channels"].filter((k) => params.has(k)).map((k) => `&${k}=${encodeURIComponent(params.get(k)!)}`);
  for (const [k, v] of params) if (k.endsWith(".rows")) passOn.push(`&${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  const q = `/eink/deck?w=${W}&h=${H - HEAD}&dpr=${DPR}` + passOn.join("");
  let next: EinkDeck;
  let song: { title?: string; display?: { sections?: { name: string; startBeat: number }[] } } = {};
  try {
    const [res, songRes] = await Promise.all([fetch(q), fetch("/song.json")]);
    if (res.status === 404) return say("Waiting for a song…");
    if (!res.ok) return say(`Couldn't load pages (${res.status}).`);
    next = await res.json();
    if (songRes.ok) song = await songRes.json();
  } catch {
    return say("Couldn't reach the relay.");
  }
  // Preload every page before switching, so turns never wait on the network.
  const loaded = await Promise.all(
    next.panes.map((pane) =>
      Promise.all(
        pane.pages.map(
          (p) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const im = new Image();
              im.onload = () => resolve(im);
              im.onerror = reject;
              im.src = p.src;
              im.style.width = `${next.width}px`;
              im.style.height = `${pane.height}px`;
            }),
        ),
      ),
    ),
  ).catch(() => null);
  if (gen !== generation) return;
  if (!loaded) return say("Couldn't load pages.");

  stage.innerHTML = "";
  shown = next.panes.map((pane, i) => {
    const box = document.createElement("div");
    box.className = "pane";
    Object.assign(box.style, { top: `${HEAD + pane.top}px`, width: `${next.width}px`, height: `${pane.height}px` });
    for (const im of loaded[i]) box.appendChild(im);
    const marker = document.createElement("div");
    marker.className = markerMode === "bar" ? "marker bar" : "marker";
    const passBar = document.createElement("div");
    passBar.className = "pass";
    box.appendChild(marker);
    box.appendChild(passBar);
    stage.appendChild(box);
    return { pane, imgs: loaded[i], marker, passBar, page: -1 };
  });
  for (const s of shown) showPage(s, 0);
  deck = next;
  title = song.title ?? deck.slug;
  sections = song.display?.sections ?? [];
  sectionShown = -2;
  manual = false;
  say(null);
  follow();
  status();
}

// ── Relay connection ──

function connect(): void {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`);
  ws.onopen = () => {
    connected = true;
    // The relay announces its song right after connecting, if it has one.
    if (!deck) say("Waiting for a song…");
    status();
  };
  ws.onmessage = (e) => {
    let m: { type?: string; beat?: number };
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.type === "song-changed") loadDeck();
    else if (m.type === "stop") checkAwake(true);
    else if (m.type === "position" && typeof m.beat === "number") {
      beat = m.beat;
      follow();
    }
  };
  ws.onclose = () => {
    connected = false;
    status();
    setTimeout(connect, 2000);
  };
}

// ── Turning by hand ──

function turn(y: number, delta: number): void {
  const s = shown.find((p) => y >= HEAD + p.pane.top && y < HEAD + p.pane.top + p.pane.height) ?? shown[shown.length - 1];
  if (!s) return;
  manual = true;
  showPage(s, s.page + delta);
  for (const p of shown) light(p);
  status();
}

function goLive(): void {
  manual = false;
  follow();
  status();
}

// ── Staying awake ──

function checkAwake(songEnded: boolean): void {
  if (needsTapReminder({ sinceTouchMs: Date.now() - lastTouch, sleepMs, songEnded })) awake.style.display = "block";
}
setInterval(() => checkAwake(false), 15_000);

// Tap zones like the Kindle reader (left third back, the rest forward, the
// top strip only keeps the screen awake), horizontal swipes (swipe left =
// forward), and the LIVE button.
let down: { x: number; y: number } | null = null;
document.addEventListener("pointerdown", (e) => {
  down = { x: e.clientX, y: e.clientY };
  lastTouch = Date.now();
});
document.addEventListener("pointercancel", () => {
  down = null;
});
document.addEventListener("pointerup", (e) => {
  if (!down) return;
  const dx = e.clientX - down.x;
  const dy = e.clientY - down.y;
  const y = down.y;
  down = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) turn(y, dx < 0 ? 1 : -1);
  else if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
    const id = (e.target as HTMLElement).id;
    if (id === "awake" || awake.style.display === "block" || e.clientY < HEAD) awake.style.display = "none";
    else if (id === "live") goLive();
    else turn(y, e.clientX < W / 3 ? -1 : 1);
  }
});

status();
connect();
