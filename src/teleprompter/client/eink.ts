/**
 * E-ink client (Kindle browser): shows the relay's pre-rendered panes for the
 * current song and follows the beat.
 *
 * The page asks the relay for the song at its own size, showing the one
 * channel its URL names (`channel=drums`; without one, the relay serves a
 * page to pick it from instead). The pane is a set of page images and turns, as its bottom row starts (see
 * panes.ts); a box inverts what's playing in it (in a figure run, the bar
 * playing), and under a figure run a bar fills one step per time through. A strip at the top names the song and
 * section. Before the song, a card covers the panes (the song's notes and
 * opening figures, see card.ts) while the song is at its start.
 * Tapping a pane turns it by hand (left third back, the rest forward) and
 * holds every pane there until LIVE is tapped.
 *
 * The Kindle's sleep timer counts only touches, so the page shows a tap
 * reminder after a song (or near the timer's end) and treats a tap on the
 * reminder or the top strip as a touch that doesn't turn a page.
 *
 * Query options: ?channel=drums, ?<channel>.rows=<n> (rows the pane shows;
 * it fills the screen unless told), ?lookahead=<beats>
 * (turn and light early; default 1), ?barlead=<beats> (how early a part's
 * bar lights; default 0.5), ?marker=bar|0, ?font=<px>,
 * ?sleep=<minutes> (the Kindle's sleep timer; default 10), ?rotate=left|right
 * (the Kindle held sideways, turned that way; the TURN button in the top
 * strip steps through them), ?staff=<px> (the note size: staff lines that far
 * apart; the − and + buttons step it). PICK goes back to the page that offers
 * the channels, keeping the other options.
 */

import { boxAt, markAt, parseRotation, passOf, rotationTransform, screenToPage, type EinkDeck, type EinkPane } from "../eink/layout.js";
import { panePageAt } from "../panes.js";
import { cardShowing } from "../card.js";
import { needsTapReminder } from "../eink/awake.js";
import { DEFAULT_STAFF_PX, parseStaffPx } from "../flow.js";

const params = new URLSearchParams(location.search);
// Held sideways, the page is laid out on its side and turned to the screen.
const rotation = parseRotation(params.get("rotate"));
const screenW = window.innerWidth;
const screenH = window.innerHeight;
const W = rotation ? screenH : screenW;
const H = rotation ? screenW : screenH;
if (rotation) {
  Object.assign(document.body.style, {
    position: "absolute",
    width: `${W}px`,
    height: `${H}px`,
    transformOrigin: "0 0",
    transform: rotationTransform(rotation, screenW, screenH),
  });
}
const DPR = window.devicePixelRatio || 1;
/** The strip at the top: the song and section. */
const HEAD = Math.round(H * 0.045);
const lookahead = params.has("lookahead") ? Number(params.get("lookahead")) : 1;
/** How early a part's bar lights, in beats, so the screen's redraw lands on the downbeat. */
const barLead = params.has("barlead") ? Number(params.get("barlead")) : 0.5;

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
// The song's name stops short of the buttons.
head.style.paddingRight = `${HEAD * 7 + 40}px`;
for (const b of document.querySelectorAll<HTMLElement>("#tools div")) {
  Object.assign(b.style, { height: `${HEAD - 3}px`, lineHeight: `${HEAD - 3}px`, fontSize: `${Math.round(HEAD * 0.5)}px` });
}

/** The note size (see flow.ts): staff lines this many px apart. */
const staff = parseStaffPx(params.get("staff")) ?? DEFAULT_STAFF_PX;

/** Reload with an option changed (null drops it); the relay renders the pages for it. */
function reloadWith(name: string, value: string | null): void {
  const q = new URLSearchParams(location.search);
  if (value === null) q.delete(name);
  else q.set(name, value);
  location.replace(`${location.pathname}?${q.toString()}`);
}

/** Notes a step smaller or bigger. */
function resize(step: number): void {
  const next = staff + step;
  if (parseStaffPx(String(next)) !== null) reloadWith("staff", String(next));
}

/** The next way to hold the Kindle (upright, turned left, turned right): the page reloads laid out for it. */
function rotateNext(): void {
  reloadWith("rotate", rotation === null ? "left" : rotation === "left" ? "right" : null);
}

/** A pane on screen: its images, its marker, and the page it shows. */
interface Shown {
  pane: EinkPane;
  imgs: HTMLImageElement[];
  marker: HTMLElement;
  passBar: HTMLElement;
  page: number;
}

let deck: EinkDeck | null = null;
let cardImg: HTMLImageElement | null = null;
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

/** Invert what's playing on the pane's page, and fill a figure run's pass bar. */
function light(s: Shown): void {
  const marks = s.pane.pages[s.page]?.marks ?? [];
  // A part's bar lights just ahead of the music, to allow for the redraw; words and chords a beat ahead.
  const at = s.pane.kind === "figures" || s.pane.kind === "score" ? beat + barLead : beat + lookahead;
  const i = manual || markerMode === "0" ? -1 : markAt(marks, at);
  const m = marks[i];
  if (!m) {
    s.marker.style.display = "none";
    s.passBar.style.display = "none";
    return;
  }
  // In a figure run, the bar playing; otherwise the whole mark.
  const b = boxAt(m, at);
  if (markerMode === "bar") {
    Object.assign(s.marker.style, { left: "0", top: `${b.y}px`, width: "14px", height: `${b.h}px` });
  } else {
    Object.assign(s.marker.style, { left: `${b.x - 4}px`, top: `${b.y - 4}px`, width: `${b.w + 8}px`, height: `${b.h + 8}px` });
  }
  s.marker.style.display = "block";
  const pass = passOf(m, at);
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

/** The card before the song, over the panes while the song is at its start (a beat of -Infinity is none yet). */
function showCard(): void {
  if (!cardImg || !deck?.card) return;
  const on = cardShowing(beat === -Infinity ? null : beat, deck.card.startBeat);
  const want = on ? "block" : "none";
  if (cardImg.style.display !== want) cardImg.style.display = want;
}

function follow(): void {
  if (!deck) return;
  showSection();
  showCard();
  for (const s of shown) {
    if (!manual) showPage(s, panePageAt(s.pane.pages, beat + lookahead));
    light(s);
  }
}

async function loadDeck(): Promise<void> {
  const gen = ++generation;
  say("Loading pages…");
  const passOn = params.has("font") ? [`&font=${encodeURIComponent(params.get("font")!)}`] : [];
  passOn.push(`&staff=${staff}`);
  if (params.has("channel")) passOn.push(`&channels=${encodeURIComponent(params.get("channel")!)}`);
  for (const [k, v] of params) if (k.endsWith(".rows")) passOn.push(`&${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  const q = `/eink/deck?w=${W}&h=${H - HEAD}&dpr=${DPR}` + passOn.join("");
  let next: EinkDeck;
  let song: { title?: string; display?: { sections?: { name: string; startBeat: number }[] } } = {};
  try {
    const [res, songRes] = await Promise.all([fetch(q), fetch("/song.json")]);
    // The song may lack this page's channel, which the relay names.
    if (res.status === 404) {
      const missing = await res.json().then((b: { error?: string }) => (b.error?.startsWith("This song has no") ? b.error : null), () => null);
      return say(missing ? missing + " Open /eink to pick another." : "Waiting for a song…");
    }
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
    // What the pane is, in its corner; it never changes, so it costs no redraws.
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = pane.title ?? "";
    box.appendChild(marker);
    box.appendChild(passBar);
    box.appendChild(label);
    stage.appendChild(box);
    return { pane, imgs: loaded[i], marker, passBar, page: -1 };
  });
  for (const s of shown) showPage(s, 0);
  cardImg = null;
  if (next.card) {
    cardImg = await new Promise<HTMLImageElement | null>((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = next.card!.src;
    });
    if (gen !== generation) return;
    if (cardImg) {
      cardImg.className = "card";
      Object.assign(cardImg.style, { top: `${HEAD}px`, width: `${next.width}px`, height: `${next.height}px` });
      stage.appendChild(cardImg);
    }
  }
  deck = next;
  // A new song starts with its card, until its beats come.
  beat = -Infinity;
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
/** Where a touch is on the page, which is turned when the Kindle is held sideways. */
const onPage = (e: PointerEvent) => screenToPage(rotation, e.clientX, e.clientY, screenW, screenH);
document.addEventListener("pointerdown", (e) => {
  down = onPage(e);
  lastTouch = Date.now();
});
document.addEventListener("pointercancel", () => {
  down = null;
});
document.addEventListener("pointerup", (e) => {
  if (!down) return;
  const up = onPage(e);
  const dx = up.x - down.x;
  const dy = up.y - down.y;
  const y = down.y;
  down = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) turn(y, dx < 0 ? 1 : -1);
  else if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
    const id = (e.target as HTMLElement).id;
    if (id === "pick") reloadWith("channel", null);
    else if (id === "rotate") rotateNext();
    else if (id === "smaller") resize(-1);
    else if (id === "bigger") resize(1);
    else if (id === "awake" || awake.style.display === "block" || up.y < HEAD) awake.style.display = "none";
    else if (id === "live") goLive();
    else turn(y, up.x < W / 3 ? -1 : 1);
  }
});

status();
connect();
