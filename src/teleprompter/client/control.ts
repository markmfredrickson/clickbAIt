/**
 * The control surface: one bar that always says what a tap will do.
 *
 * Tap = the obvious next thing (bail / tap in / leave a vamp). Swipe up = the
 * rare drawer (start a vamp over a range, or stop the track), each needing a
 * second press. Nothing is on a timer, so a hurried tap can't come back as
 * something else.
 *
 * The relay owns the authoritative state — this page sends intents and renders
 * whatever comes back, so two phones and the lyrics display never disagree.
 * `show-state.ts` is imported rather than reimplemented for the same reason.
 */

import { controlLabel, isControllable, sectionAt, type ShowSection, type ShowState } from "../show-state.js";
import type { LyricsDisplay } from "../lyrics-display.js";
import { sectionMeters, type MeteredSection } from "../position.js";
import { songMap, songProgress } from "../song-map.js";

const $ = (id: string) => document.getElementById(id)!;
const bar = $("bar"), barMain = $("bar-main"), barSub = $("bar-sub");
const bannerLabel = $("banner-label"), bannerName = $("banner-name");
const warn = $("warn"), mapEl = $("map"), rowsEl = $("rows"), conn = $("conn");
const drawer = $("drawer"), drawerTitle = $("drawer-title"), drawerRows = $("drawer-rows");
const dVamp = $("d-vamp"), dStop = $("d-stop"), drawerClose = $("drawer-close");

let sections: ShowSection[] = [];
// The same sections with their meters, for the song map (shared with the prompter).
let metered: MeteredSection[] = [];
let state: ShowState = { mode: "following", at: 0 };
let beat = 0;
let playing = false;
let ws: WebSocket | null = null;
let drawerOpen = false, anchorIdx = 0, endIdx = 0, stopArmed = false;
let segEls: HTMLElement[] = [], rowEls: HTMLElement[] = [], drawerRowEls: HTMLElement[] = [];

// ── Song ──

async function loadSong(): Promise<void> {
  try {
    const res = await fetch("/song.json");
    if (!res.ok) return;
    const song = (await res.json()) as LyricsDisplay & { sections?: ShowSection[] };
    $("song").firstChild!.textContent = song.title ?? "Untitled";
    $("song-artist").textContent = song.artist ?? "";

    const secs = song.display?.sections;
    if (secs) {
      const end = song.words?.length ? Math.max(...song.words.map((w) => w.endBeat)) : 0;
      sections = secs.map((s, i) => ({
        name: s.name,
        beat: s.startBeat,
        durationBeats: (i + 1 < secs.length ? secs[i + 1].startBeat : Math.max(end, s.startBeat)) - s.startBeat,
      }));
      metered = sectionMeters(song);
    } else {
      sections = song.sections ?? [];
      metered = sections.map((s) => ({ startBeat: s.beat, bars: 1, beatsPerBar: s.durationBeats }));
    }
    buildLists();
    render();
  } catch { /* relay not ready — the next song-changed will retry */ }
}

function buildLists(): void {
  mapEl.textContent = "";
  rowsEl.textContent = "";
  drawerRows.textContent = "";
  segEls = []; rowEls = []; drawerRowEls = [];
  const widths = songMap(metered);

  sections.forEach((s, i) => {
    const seg = document.createElement("div");
    seg.className = "seg";
    seg.style.flex = String(widths[i]?.width ?? Math.max(s.durationBeats, 1));
    mapEl.appendChild(seg);
    segEls.push(seg);

    for (const [host, list] of [[rowsEl, rowEls], [drawerRows, drawerRowEls]] as const) {
      const row = document.createElement("div");
      row.className = "row";
      const name = document.createElement("div");
      name.className = "row-name";
      name.textContent = s.name;
      const b = document.createElement("div");
      b.className = "row-beat";
      b.textContent = `${Math.round(s.durationBeats)} beats`;
      row.appendChild(name); row.appendChild(b);
      if (host === drawerRows) {
        row.addEventListener("click", () => {
          if (i < anchorIdx) return;       // contiguous, forward only
          endIdx = i;
          render();
        });
      }
      host.appendChild(row);
      (list as HTMLElement[]).push(row);
    }
  });
}

// ── Render ──

function render(): void {
  document.body.className = "m-" + state.mode;

  const here = sectionAt(sections, beat);
  const loop = state.loop;
  const progress = songProgress(metered, beat);
  segEls.forEach((el, i) => {
    const inLoop = (loop && i >= loop.from && i <= loop.to) || (drawerOpen && i >= anchorIdx && i <= endIdx);
    el.classList.toggle("loop", !!inLoop);
    el.classList.toggle("now", i === here && !inLoop);
    el.classList.toggle("past", i < here && !inLoop);
    // How far through the current section, for its fill.
    el.style.setProperty("--p", String(i === progress.section ? progress.inSection : 0));
  });
  rowEls.forEach((el, i) => el.classList.toggle("here", i === here));

  const live = isControllable(state, playing);
  document.body.classList.toggle("idle", !live);
  bar.toggleAttribute("disabled", !live);
  const label = live
    ? controlLabel(state, sections)
    : state.mode === "stopped"
      ? controlLabel(state, sections)
      : { main: "Waiting for playback", sub: "Start the track in REAPER" };
  barMain.textContent = label.main;
  barSub.textContent = label.sub;

  if (state.mode === "out") {
    const next = sections[Math.min(state.at + 1, sections.length - 1)];
    bannerLabel.textContent = "Out — tap in at";
    bannerName.textContent = next ? next.name : "—";
    warn.hidden = false;
    warn.className = "";
    warn.textContent = "No click · you're on your own";
  } else if (state.mode === "vamping" || state.mode === "leaving") {
    bannerLabel.textContent = state.mode === "leaving" ? "Leaving at end of pass" : "Vamping";
    bannerName.textContent = loop
      ? loop.from === loop.to
        ? sections[loop.from]?.name ?? "—"
        : `${sections[loop.from]?.name} → ${sections[loop.to]?.name}`
      : "—";
    warn.hidden = false;
    warn.className = "vamp";
    warn.textContent = state.mode === "leaving" ? "Cue will count you in" : "Looping · cue muted";
  } else if (state.mode === "stopped") {
    bannerLabel.textContent = "Stopped";
    bannerName.textContent = sections[here]?.name ?? "—";
    warn.hidden = true;
  } else {
    bannerLabel.textContent = "Now playing";
    bannerName.textContent = sections[here]?.name ?? "—";
    warn.hidden = true;
  }

  drawer.classList.toggle("on", drawerOpen);
  if (drawerOpen) {
    const range = anchorIdx === endIdx
      ? sections[anchorIdx]?.name ?? ""
      : `${sections[anchorIdx]?.name} → ${sections[endIdx]?.name}`;
    drawerTitle.textContent = "Vamp over " + range;
    dVamp.textContent = anchorIdx === endIdx ? "Start vamp" : `Start vamp · ${endIdx - anchorIdx + 1} sections`;
    dStop.textContent = stopArmed ? "Tap again to stop" : "Stop the track";
    dStop.classList.toggle("armed", stopArmed);
    drawerRowEls.forEach((el, i) => {
      el.classList.toggle("sel", i >= anchorIdx && i <= endIdx);
      el.classList.toggle("before", i < anchorIdx);
    });
  }
}

// ── Intents ──

function send(intent: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "intent", intent }));
  }
}

function openDrawer(): void {
  if (state.mode !== "following" || !playing) return;
  anchorIdx = sectionAt(sections, beat);
  endIdx = anchorIdx;
  stopArmed = false;
  drawerOpen = true;
  render();
}
function closeDrawer(): void { drawerOpen = false; stopArmed = false; render(); }

// Tap, or swipe up for the drawer. No hold: the common cases are all taps, so
// there's no press-and-hold threshold for a panicked tap to fall foul of.
const SWIPE_PX = 44;
let downY = 0, swiped = false;

bar.addEventListener("pointerdown", (e) => {
  bar.setPointerCapture(e.pointerId);
  downY = e.clientY;
  swiped = false;
});
bar.addEventListener("pointermove", (e) => {
  if (downY - e.clientY > SWIPE_PX) swiped = true;
});
bar.addEventListener("pointerup", () => {
  if (!isControllable(state, playing) && state.mode !== "stopped") { swiped = false; return; }
  if (swiped) openDrawer();
  else send({ action: state.mode === "stopped" ? "restart" : "tap" });
  swiped = false;
});
bar.addEventListener("pointercancel", () => { swiped = false; });

dVamp.addEventListener("click", () => {
  send({ action: "vamp", from: anchorIdx, to: endIdx });
  closeDrawer();
});
dStop.addEventListener("click", () => {
  if (!stopArmed) { stopArmed = true; render(); return; }
  send({ action: "stop" });
  closeDrawer();
});
drawerClose.addEventListener("click", closeDrawer);

// ── Relay socket ──

function connect(): void {
  ws = new WebSocket((location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host);
  ws.onopen = () => { conn.textContent = "Connected"; conn.className = "ok"; };
  ws.onmessage = (ev) => {
    let msg: { type?: string; beat?: number; state?: ShowState; playing?: boolean };
    try { msg = JSON.parse(ev.data as string); } catch { return; }
    if (msg.type === "position" && typeof msg.beat === "number") { beat = msg.beat; render(); }
    else if (msg.type === "play") { playing = true; render(); }
    else if (msg.type === "stop") { playing = false; closeDrawer(); }
    else if (msg.type === "show-state" && msg.state) {
      state = msg.state;
      if (typeof msg.playing === "boolean") playing = msg.playing;
      render();
    }
    else if (msg.type === "song-changed") loadSong();
  };
  ws.onclose = () => {
    conn.textContent = "Disconnected";
    conn.className = "bad";
    setTimeout(connect, 2000);
  };
  ws.onerror = () => ws?.close();
}

loadSong();
connect();
render();
