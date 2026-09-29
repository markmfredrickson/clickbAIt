/**
 * E-ink client (Kindle browser): shows the relay's pre-rendered pages for the
 * current song and follows the beat.
 *
 * The page asks the relay for pages at its own size, loads them all up front,
 * then picks the page and highlighted line from each beat on the WebSocket —
 * the same beat stream the lyrics display gets. A tap or swipe turns by hand
 * and stays there until LIVE is tapped. With every page already loaded, a
 * dropped connection just means turning by hand.
 *
 * The Kindle's sleep timer counts only touches, so the page shows a tap
 * reminder after a song (or near the timer's end) and treats a tap on the
 * reminder or the top strip as a touch that doesn't turn the page.
 *
 * Query options: ?lead=<beats> (turn early; default one bar),
 * ?lookahead=<beats> (highlight early; default 1), ?marker=bar|0, ?font=<px>,
 * ?sleep=<minutes> (the Kindle's sleep timer; default 10).
 */

import { lineAt, pageAt, type Page } from "../eink/layout.js";
import { needsTapReminder } from "../eink/awake.js";

interface Deck {
  slug: string;
  width: number;
  height: number;
  beatsPerBar: number;
  pages: (Page & { src: string })[];
}

const params = new URLSearchParams(location.search);
const W = window.innerWidth;
const H = window.innerHeight;
const DPR = window.devicePixelRatio || 1;
const lookahead = params.has("lookahead") ? Number(params.get("lookahead")) : 1;

const stage = document.getElementById("stage")!;
const marker = document.getElementById("marker")!;
const msg = document.getElementById("msg")!;
const dot = document.getElementById("dot")!;
const live = document.getElementById("live")!;
const awake = document.getElementById("awake")!;
const sleepMs = (params.has("sleep") ? Number(params.get("sleep")) : 10) * 60_000;
/** Taps this close to the top only keep the screen awake. */
const TOP_STRIP = Math.round(H * 0.08);
let lastTouch = Date.now();
const useMarker = params.get("marker") !== "0";
if (params.get("marker") === "bar") marker.className = "bar";

let deck: Deck | null = null;
let imgs: HTMLImageElement[] = [];
let shown = -1;
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

function show(p: number, line: number): void {
  if (!deck) return;
  p = Math.max(0, Math.min(deck.pages.length - 1, p));
  if (p !== shown) {
    if (shown >= 0) imgs[shown].style.display = "none";
    imgs[p].style.display = "block";
    shown = p;
  }
  const l = deck.pages[p].lines[line];
  if (useMarker && !manual && l) {
    marker.style.top = `${l.y - 4}px`;
    marker.style.height = `${l.h + 8}px`;
    marker.style.width = `${deck.width}px`;
    marker.style.display = "block";
  } else {
    marker.style.display = "none";
  }
}

/** Page and line for the current beat. */
function livePosition(): [number, number] {
  if (!deck) return [0, -1];
  const lead = params.has("lead") ? Number(params.get("lead")) : deck.beatsPerBar;
  const p = pageAt(deck.pages, beat, lead);
  return [p, lineAt(deck.pages[p].lines, beat, lookahead)];
}

function follow(): void {
  if (!deck || manual) return;
  const [p, line] = livePosition();
  show(p, line);
}

async function loadDeck(): Promise<void> {
  const gen = ++generation;
  say("Loading pages…");
  const q = `/eink/deck?w=${W}&h=${H}&dpr=${DPR}${params.has("font") ? `&font=${params.get("font")}` : ""}`;
  let next: Deck;
  try {
    const res = await fetch(q);
    if (res.status === 404) return say("Waiting for a song…");
    if (!res.ok) return say(`Couldn't load pages (${res.status}).`);
    next = await res.json();
  } catch {
    return say("Couldn't reach the relay.");
  }
  // Preload every page before switching, so turns never wait on the network.
  const loaded = await Promise.all(
    next.pages.map(
      (p) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = reject;
          im.src = p.src;
          im.style.width = `${next.width}px`;
          im.style.height = `${next.height}px`;
        }),
    ),
  ).catch(() => null);
  if (gen !== generation) return;
  if (!loaded) return say("Couldn't load pages.");

  for (const im of imgs) im.remove();
  imgs = loaded;
  for (const im of imgs) stage.insertBefore(im, marker);
  deck = next;
  shown = -1;
  manual = false;
  stage.style.width = `${deck.width}px`;
  stage.style.height = `${deck.height}px`;
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

function turn(delta: number): void {
  if (!deck) return;
  manual = true;
  show(shown + delta, -1);
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
  down = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) turn(dx < 0 ? 1 : -1);
  else if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
    const id = (e.target as HTMLElement).id;
    if (id === "awake" || awake.style.display === "block" || e.clientY < TOP_STRIP) awake.style.display = "none";
    else if (id === "live") goLive();
    else turn(e.clientX < W / 3 ? -1 : 1);
  }
});

status();
connect();
