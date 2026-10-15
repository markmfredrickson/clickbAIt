/**
 * clickbAIt Teleprompter — browser client
 *
 * Shows one of the song's channels (lyrics, chords, charts of parts) in a
 * pane, or two in panes split side by side or stacked, as the URL lays them
 * out (pane-layout.ts). One header above the panes names the song, the
 * section and the count. Each pane follows the beat on its own: it shows as
 * many of its channel's rows as fit its box and turns them all at once as
 * its bottom row starts, so that row moves to the top (see panes.ts).
 *
 * The song comes from the relay (its lyrics display for the header and
 * timing, its row document for the panes) with beats over the WebSocket, or
 * in a practice bundle inline, with beats from an <audio> element.
 */

import { Curve } from "../../core/curve.js";
import { sectionLoopBounds, loopWrapTarget } from "../loop.js";
import { songPosition, sectionMeters, type MeteredSection } from "../position.js";
import type { LyricsDisplay } from "../lyrics-display.js";
import { parseDisplayOptions, displayQuery } from "../display-options.js";
import { channelChoices, layoutQuery, paneChannel, parseLayout, withLayout, type LayoutChange, type PaneLayout } from "../pane-layout.js";
import { songMap, songProgress } from "../song-map.js";
import { channelTitle, itemsAt, type ChannelPosition, type RowChannel, type RowDocument } from "../rows.js";
import { panePageAt, type PanePage, pagesByHeight } from "../panes.js";
import { channelView, fitRows, placeDrawing, showPass, type ChannelView } from "./pane-view.js";
import { drawingKey } from "../drawings.js";
import { cardShowing } from "../card.js";
import { cardView, fitCard } from "./card-view.js";

/** The song as the page gets it: the lyrics display, and in a bundle, its rows and mixes. */
type ClientSong = LyricsDisplay & { bundle?: boolean; rows?: RowDocument };

(function () {
  "use strict";

  /** An element the page's markup always has. */
  function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
  }

  // ── State ──
  let song: ClientSong | null = null; // the lyrics display: header, sections, timing
  let doc: RowDocument | null = null; // the row document: what the panes show
  let curve: Curve | null = null;     // Curve built from the display's curve (bundle mode)
  let ws: WebSocket | null = null;
  let autoScroll = true;
  /** Whether the track is running. Stopped, the reader scrolls the panes freely. */
  let running = false;
  let offsetBeats = 0;
  let rawBeat = -1;      // most recent beat from OSC (no offset applied)
  let heard: number | null = null; // the last beat heard for this song, or null before any
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // The page's options and layout come from its URL, so a setup is a link.
  // Changing one writes it back to the URL.
  const urlOptions = parseDisplayOptions(location.search);
  const parsedLayout = parseLayout(location.search);
  let layout: PaneLayout = "error" in parsedLayout ? { panes: 1, split: "vertical", views: [null], at: 50 } : parsedLayout;
  const layoutError = "error" in parsedLayout ? parsedLayout.error : null;

  /** One pane: a channel's rows, a page of them at a time, as many as fit its box. */
  interface Pane {
    /** Which of the layout's panes it is, from 0. */
    slot: number;
    channel: RowChannel;
    view: ChannelView;
    el: HTMLElement;
    rowsEl: HTMLElement;
    pages: PanePage[];
    page: number;
    litRow: number;
    litItem: number;
    litPass?: number;
    /** The box lit over the bar playing in a figure run. */
    litBar?: HTMLElement | null;
  }
  let panes: Pane[] = [];
  let order: string[] = [];  // channel ids shown, in the panes' order

  // ── Clock (pub/sub) ──
  const clock = (function () {
    const subs = new Set<(beat: number) => void>();
    return {
      subscribe: function (cb: (beat: number) => void) { subs.add(cb); return function () { subs.delete(cb); }; },
      emit: function (beat: number) { subs.forEach(function (cb) { cb(beat); }); },
    };
  })();

  // ── DOM refs ──
  const titleEl = byId("song-title");
  const container = byId("panes");
  const cardEl = byId("card");
  const statusEl = byId("connection-status");
  const beatDisplay = byId("beat-display");
  const nowSectionEl = byId("now-section");
  const barBeatEl = byId("bar-beat");
  const songMapEl = byId("song-map");
  let mapFills: HTMLElement[] = [];  // section index -> its fill element in the song map
  let ringed = -1;    // bundle: the section the player was sent to, ringed until it plays

  // Sections with their meters and names, for the header's Section and Bar:Beat.
  let metered: MeteredSection[] = [];
  let sectionNames: string[] = [];
  let countInBeatsPerBar = 4;
  const offsetSlider = byId<HTMLInputElement>("offset-slider");
  const offsetValue = byId("offset-value");
  const scrollModeBtn = byId("scroll-mode-btn");
  const darkModeBtn = byId("dark-mode-btn");
  const bundleControls = byId("bundle-controls");
  const loopFrom = byId<HTMLSelectElement>("loop-from");
  const loopTo = byId<HTMLSelectElement>("loop-to");
  const speedSlider = byId<HTMLInputElement>("speed-slider");
  const speedValue = byId("speed-value");
  const playBtn = byId("play-btn");
  const playTime = byId("play-time");
  const drawer = byId("drawer");
  const drawerBtn = byId("drawer-btn");
  const drawerScrim = byId("drawer-scrim");
  const drawerChannels = byId("drawer-channels");
  const flipBtn = byId("flip-btn");
  const swapBtn = byId("swap-btn");

  // Bundle-mode section loop: audio-time window we keep playback inside, or null.
  let loop: { startTime: number; endTime: number } | null = null;

  // ── Channels ──
  // The size each kind of channel is drawn at, in rem.
  const SIZES = { lyrics: 1.5, chords: 1.3, figures: 1.2, score: 1.2 };

  /** A part's chart: figures or a score, drawn in notation. */
  function isChart(c: RowChannel): c is Extract<RowChannel, { kind: "figures" | "score" }> {
    return c.kind === "figures" || c.kind === "score";
  }

  /** Rewrite the URL to match the page, so copying it copies the setup. */
  function writeUrl() {
    // A link that can't be shown stays as it was, for the reader to see what's wrong.
    if (layoutError) return;
    const display = displayQuery({
      offset: offsetBeats !== 0 ? offsetBeats : undefined,
      scroll: autoScroll ? undefined : "manual",
      theme: document.body.classList.contains("light") ? "light" : undefined,
      role: urlOptions.role,
    });
    try { history.replaceState(null, "", location.pathname + layoutQuery(layout, display)); } catch (e) { /* file:// */ }
  }

  /** Change the layout and re-render in place, keeping the beat. */
  function relayout(change: LayoutChange) {
    const next = parseLayout(withLayout(layoutQuery(layout), change));
    if ("error" in next) return;
    layout = next;
    writeUrl();
    renderPanes();
    renderDrawerChannels();
    if (rawBeat >= 0) onBeatUpdate(rawBeat);
  }

  // ── Init ──
  function renderWaiting() {
    titleEl.textContent = "Waiting for song…";
    nowSectionEl.textContent = "";
    barBeatEl.textContent = "–";
    metered = [];
    sectionNames = [];
    doc = null;
    renderSongMap();
    document.title = "clickbAIt: One Simple Track";
    container.innerHTML = '<div class="waiting-message">No song loaded yet. Start playback in REAPER, or load a region matching a song slug.</div>';
    panes = [];
  }

  async function loadSong() {
    if (typeof (window as any).__SONG_DATA__ === "object" && (window as any).__SONG_DATA__) {
      const inline: ClientSong = (window as any).__SONG_DATA__;
      song = inline;
      // A practice bundle carries its rows inline; there's no relay to ask.
      doc = inline.rows || null;
      renderSong();
      return;
    }
    try {
      const res = await fetch("song.json");
      if (!res.ok) { renderWaiting(); return; }
      song = await res.json();
      const rows = await fetch("rows.json");
      doc = rows.ok ? await rows.json() : null;
      renderSong();
    } catch (e) {
      statusEl.textContent = "Failed to load song";
      statusEl.className = "disconnected";
    }
  }

  async function init() {
    await loadSong();
    clock.subscribe(onBeatUpdate);
    if (song && song.bundle) {
      startAudioClock();
    } else {
      connectWebSocket();
    }
    setupControls();
  }

  // ── Song map ──
  function renderSongMap() {
    songMapEl.innerHTML = "";
    mapFills = [];
    songMap(metered).forEach(function (seg, i) {
      const el = document.createElement("div");
      el.className = "map-seg";
      el.style.flex = seg.width + " 1 0";
      el.title = sectionNames[i] || "";
      const fill = document.createElement("div");
      fill.className = "map-fill";
      el.appendChild(fill);
      songMapEl.appendChild(el);
      mapFills.push(fill);
    });
  }

  function updateSongMap(beat: number) {
    const p = songProgress(metered, beat);
    mapFills.forEach(function (fill, i) {
      const done = i < p.section ? 1 : i === p.section ? p.inSection : 0;
      fill.style.width = (done * 100) + "%";
      const seg = fill.parentElement!;
      seg.classList.toggle("past", i < p.section);
      seg.classList.toggle("now", i === p.section);
      // While a bundle's player is stopped, ring where it will play from:
      // the section it was sent to, else the one it's in.
      const paused = document.body.classList.contains("paused");
      seg.classList.toggle("ring", paused && i === (ringed >= 0 ? ringed : p.section));
    });
  }

  // ── Bundle-mode clock: drive from <audio id="mix-audio"> ──
  function startAudioClock() {
    const audio = byId<HTMLAudioElement>("mix-audio");
    if (!audio) {
      statusEl.textContent = "No <audio id=\"mix-audio\"> element found";
      statusEl.className = "disconnected";
      return;
    }
    statusEl.textContent = "Bundle mode";
    statusEl.className = "connected";
    function playing(on: boolean) {
      setRunning(on);
      document.body.classList.toggle("paused", !on);
      playBtn.textContent = on ? "❚❚" : "▶";
      playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    }
    audio.addEventListener("play",  function () { ringed = -1; playing(true); });
    audio.addEventListener("pause", function () { playing(false); });
    audio.addEventListener("ended", function () { playing(false); });

    setupBundleControls(audio);

    function tick() {
      if (song && !audio.seeking) {
        // Only act on a SETTLED clock. While a seek is in flight, currentTime
        // reads its stale pre-seek value, which would (a) fire a second wrap
        // (double click) and (b) emit a beat that flickers the highlight back
        // before the seek lands at the start.
        //
        // Keep playback inside the loop: wrap at the end (a scrub earlier is
        // left alone so a manual lead-in works). Setting currentTime starts the
        // seek, so we skip the emit this frame and resume once it settles.
        const wrapTo = loop ? loopWrapTarget(audio.currentTime, loop.startTime, loop.endTime) : null;
        if (wrapTo !== null) {
          audio.currentTime = wrapTo;
        } else if (curve) {
          clock.emit(curve.toBeat(audio.currentTime || 0));
        }
        showTime(audio.currentTime || 0);
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  let shownSecond = -1;
  function showTime(seconds: number) {
    const whole = Math.floor(seconds);
    if (whole === shownSecond) return;
    shownSecond = whole;
    playTime.textContent = Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
  }

  // Playback controls in the header, shown only in bundle mode (they act on
  // the <audio> element; live/OSC mode has no such clock to steer).
  function setupBundleControls(audio: HTMLAudioElement) {
    if (!bundleControls) return;
    bundleControls.hidden = false;
    document.body.classList.add("bundle", "paused");

    function togglePlay() {
      if (audio.paused) audio.play().catch(function () {});
      else audio.pause();
    }
    playBtn.addEventListener("click", togglePlay);
    // Space plays and pauses, except while typing in a control.
    document.addEventListener("keydown", function (e) {
      const t = e.target as HTMLElement;
      if (e.key !== " " || (t && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName))) return;
      e.preventDefault();
      togglePlay();
    });
    // A click on a section of the song map jumps to its cue (its name and
    // count-in), or its start when it has none, a hair inside: a seek can
    // land just short of where it's sent.
    songMapEl.addEventListener("click", function (e) {
      const seg = (e.target as HTMLElement).closest(".map-seg");
      const i = seg ? Array.prototype.indexOf.call(songMapEl.children, seg) : -1;
      if (i < 0 || !curve || !metered[i]) return;
      const s = song!.display.sections[i];
      ringed = i;
      audio.currentTime = Math.max(0, curve.toTime(s.cueBeat !== undefined ? s.cueBeat : s.startBeat) + 0.03);
      if (audio.paused) clock.emit(curve.toBeat(audio.currentTime));
    });

    // Mix variant (full / minus-<part> / click only): the bundle inlines one
    // <option> per rendered file. Every variant is the same render length, so
    // section loops carry over; playback restarts from the top on a switch.
    const variantSel = byId<HTMLSelectElement>("mix-variant");
    if (variantSel) {
      variantSel.addEventListener("change", function () {
        const wasPlaying = !audio.paused;
        audio.src = variantSel.value;
        audio.load();
        audio.currentTime = 0;
        if (wasPlaying) audio.play().catch(function () {});
      });
    }
    const sections = song!.display.sections;

    // "from" gets Off + every section; "to" gets every section (instrumentals
    // included — loop a solo, or a contiguous run like Verse → Chorus).
    sections.forEach(function (s, i) {
      const a = document.createElement("option");
      a.value = String(i); a.textContent = s.name; loopFrom.appendChild(a);
      const b = document.createElement("option");
      b.value = String(i); b.textContent = s.name; loopTo.appendChild(b);
    });

    // Apply the current from/to selection. Clamps to a valid contiguous range
    // (to >= from), seeks to the range start, and plays.
    function applyLoop() {
      const from = parseInt(loopFrom.value, 10);
      if (from < 0 || !curve || !sections.length) { loop = null; return; }
      let to = parseInt(loopTo.value, 10);
      if (isNaN(to) || to < from) { to = from; loopTo.value = String(to); }
      const dur = isFinite(audio.duration) ? audio.duration : Infinity;
      const b = sectionLoopBounds(sections, from, to, function (beat) { return curve!.toTime(beat); }, dur);
      loop = { startTime: b.startTime, endTime: b.endTime };
      audio.currentTime = b.startTime;
      if (audio.paused) audio.play().catch(function () {});
    }

    loopFrom.addEventListener("change", applyLoop);
    loopTo.addEventListener("change", applyLoop);

    function applySpeed(v: number) {
      audio.playbackRate = v;
      audio.preservesPitch = true;
      (audio as any).mozPreservesPitch = true;
      (audio as any).webkitPreservesPitch = true;
      speedValue.textContent = Math.round(v * 100) + "%";
    }
    speedSlider.addEventListener("input", function () { applySpeed(parseFloat(this.value)); });
    applySpeed(parseFloat(speedSlider.value));
  }

  // ── Render ──
  function renderSong() {
    if (!song) return;
    const s = song;
    if (s.schema !== "clickbait/lyrics-display@1") {
      renderWaiting();
      titleEl.textContent = s.title || "Song";
      container.innerHTML = '<div class="waiting-message">This song was built by an older clickbait. Rebuild it to show it here.</div>';
      return;
    }
    curve = s.curve ? new Curve(s.curve) : null;

    titleEl.textContent = s.title;
    nowSectionEl.textContent = "";
    barBeatEl.textContent = "–";
    countInBeatsPerBar = (s.timeSignature && s.timeSignature[0]) || 4;
    metered = sectionMeters(s);
    sectionNames = s.display.sections.map(function (x) { return x.name; });
    renderSongMap();
    document.title = s.title + " — clickbAIt: One Simple Track";

    renderPanes();
    renderDrawerChannels();

    // New song: clear the beat position, so the page doesn't linger at the
    // previous song's place until the next OSC beat arrives.
    rawBeat = -1;
    heard = null;
    if (doc && doc.card) showCard(true);
    window.scrollTo(0, 0);
  }

  /** The card before the song, for what this screen shows; the beat decides when it's up. */
  function renderCard() {
    cardEl.innerHTML = "";
    if (!doc || !doc.card || !song) { showCard(false); return; }
    cardEl.appendChild(cardView(doc, song, order, urlOptions.role));
    showCard(heard === null || cardShowing(heard, doc.card.startBeat));
    if (!cardEl.hidden) fitCard(cardEl);
  }

  function showCard(on: boolean) {
    cardEl.hidden = !on;
    placeCard();
  }

  // Over the panes, under the header, whatever its height (a bundle's
  // playback line makes it taller, and the header's size can change).
  function placeCard() {
    if (!cardEl.hidden) cardEl.style.top = byId("header").offsetHeight + "px";
  }
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(placeCard).observe(byId("header"));

  /** The name of a layout's pane, where it sits. */
  function slotName(slot: number): string {
    if (layout.panes === 1) return "Pane";
    if (layout.split === "vertical") return slot === 0 ? "Left pane" : "Right pane";
    return slot === 0 ? "Top pane" : "Bottom pane";
  }

  /** A button per channel the song has, for a pane that shows none. */
  function chooser(slot: number, message: string): HTMLElement {
    const box = document.createElement("div");
    box.className = "chooser";
    const p = document.createElement("p");
    p.textContent = message;
    box.appendChild(p);
    channelChoices(doc!).forEach(function (c) {
      const b = document.createElement("button");
      b.textContent = c.label;
      b.addEventListener("click", function () { relayout({ pane: slot, view: c.name }); });
      box.appendChild(b);
    });
    return box;
  }

  function renderPanes() {
    container.innerHTML = "";
    container.className = "split-" + layout.split + (layout.panes === 2 ? " two" : " one");
    panes = [];
    order = [];
    if (!doc) {
      renderCard();
      container.innerHTML = '<div class="waiting-message">No rows for this song yet. Rebuild it to show it here.</div>';
      return;
    }
    if (layoutError) {
      renderCard();
      container.innerHTML = '<div class="waiting-message"></div>';
      container.firstElementChild!.textContent = "This link can't be shown: " + layoutError + ".";
      return;
    }
    layout.views.forEach(function (name, slot) {
      const slotEl = document.createElement("div");
      slotEl.className = "slot";
      if (layout.panes === 2 && slot === 0) slotEl.style.flexBasis = layout.at + "%";
      container.appendChild(slotEl);
      if (layout.panes === 2 && slot === 0) container.appendChild(divider());
      const channel = name ? paneChannel(doc!, name) : null;
      if (!channel) {
        slotEl.appendChild(chooser(slot, name
          ? "This song has no " + name + ". Pick what this pane shows:"
          : "Pick what this pane shows:"));
        return;
      }
      order.push(channel.id);
      const view = channelView(channel);
      const el = document.createElement("section");
      el.className = "pane pane-" + channel.kind;
      el.style.fontSize = SIZES[channel.kind] + "rem";
      // Notation scales with the pane's size.
      if (isChart(channel)) el.style.setProperty("--notation-zoom", String((SIZES[channel.kind] / 1.2) * 1.1));
      // What the pane is, in its corner: parts can look alike (rhythm and lead guitar).
      const label = document.createElement("div");
      label.className = "pane-label";
      label.innerHTML = "<span></span>";
      (label.firstChild as HTMLElement).textContent = channelTitle(channel);
      el.appendChild(label);
      const rowsEl = document.createElement("div");
      rowsEl.className = "pane-rows";
      view.rows.forEach(function (r) { rowsEl.appendChild(r.el); });
      el.appendChild(rowsEl);
      slotEl.appendChild(el);
      const pane: Pane = { slot, channel, view, el, rowsEl, pages: [], page: -1, litRow: -1, litItem: -1 };
      panes.push(pane);
      // Notation comes drawn, in the rows (a song built before that shows its letters only).
      const drawn = doc!.notation && doc!.notation[channel.id];
      if (drawn) {
        view.notation.forEach(function (t) {
          const d = drawn[drawingKey(t.start, t.count)];
          if (d) placeDrawing(t, d, d.svg);
        });
      }
      // The pane's box changes with the window and the divider; its rows with their drawings.
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(function () { sizePane(pane); });
        ro.observe(el);
        ro.observe(rowsEl);
      }
    });
    renderCard();
    panes.forEach(sizePane);
    showScrollClass();
  }

  /** The bar between two panes: dragging it moves it, and the URL keeps where. */
  function divider(): HTMLElement {
    const d = document.createElement("div");
    d.className = "divider";
    d.addEventListener("pointerdown", function (e) {
      d.setPointerCapture(e.pointerId);
      container.classList.add("dragging");
    });
    d.addEventListener("pointermove", function (e) {
      if (!d.hasPointerCapture(e.pointerId)) return;
      const box = container.getBoundingClientRect();
      const pct = layout.split === "vertical"
        ? ((e.clientX - box.left) / box.width) * 100
        : ((e.clientY - box.top) / box.height) * 100;
      // Moving it is only a resize; the URL is written when it's let go.
      layout.at = Math.min(90, Math.max(10, pct));
      (container.firstElementChild as HTMLElement).style.flexBasis = layout.at + "%";
    });
    function done(e: PointerEvent) {
      if (!d.hasPointerCapture(e.pointerId)) return;
      d.releasePointerCapture(e.pointerId);
      container.classList.remove("dragging");
      layout = parseLayout(withLayout(layoutQuery(layout), { at: layout.at })) as PaneLayout;
      writeUrl();
    }
    d.addEventListener("pointerup", done);
    d.addEventListener("pointercancel", done);
    return d;
  }

  /** Page a pane by its own box, and put it back on its page. */
  function sizePane(p: Pane) {
    fitRows(p.view);
    const rows = p.view.rows.map(function (r) { return r.el; });
    const available = Math.max(40, p.el.clientHeight);
    p.pages = pagesByHeight(rows.map(function (el, i) { return { start: p.channel.rows[i].start, height: el.offsetHeight }; }), available);
    const turned = p.page;
    p.page = -1;
    if (turned >= 0) showPage(p, Math.min(turned, p.pages.length - 1), false);
  }

  function showPage(p: Pane, index: number, smooth: boolean) {
    if (index === p.page || !p.pages[index]) return;
    p.page = index;
    const top = p.view.rows[p.pages[index].first].el.offsetTop;
    try { p.el.scrollTo({ top, behavior: smooth ? "smooth" : "auto" }); } catch (e) { p.el.scrollTop = top; }
  }

  /**
   * Manual scroll lets the reader scroll each pane; auto turns them, but only
   * while the track runs. Stopped, there is nothing to follow, so the reader
   * can look anywhere in the song.
   */
  function showScrollClass() {
    container.classList.toggle("manual", !autoScroll || !running);
  }

  /** The track started or stopped. Starting puts every pane back on the page being played. */
  function setRunning(on: boolean) {
    if (on === running) return;
    running = on;
    document.body.classList.toggle("running", on);
    showScrollClass();
    if (on) {
      panes.forEach(function (p) { p.page = -1; });
      onBeatUpdate(rawBeat);
    }
  }

  // ── Show state (bail / vamp), pushed by the relay ──
  //
  // The display's precision should track the system's confidence. The moment
  // someone bails, the band is free-running, so the body gets a mode class
  // and the CSS stops pointing at a word that may be wrong.
  function applyShowState(state: { mode?: string } | undefined) {
    if (!state || !state.mode) return;
    document.body.classList.remove(
      "show-following", "show-out", "show-vamping", "show-leaving", "show-stopped",
    );
    document.body.classList.add("show-" + state.mode);
  }

  // ── WebSocket ──
  function connectWebSocket() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host);
    ws.onopen = function () {
      statusEl.textContent = "Connected";
      statusEl.className = "connected";
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    };
    ws.onmessage = function (event) {
      let msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.type === "position") clock.emit(msg.beat);
      else if (msg.type === "song-changed") loadSong();
      else if (msg.type === "show-state") {
        applyShowState(msg.state);
        if (typeof msg.playing === "boolean") setRunning(msg.playing);
      }
      else if (msg.type === "play") setRunning(true);
      else if (msg.type === "stop") setRunning(false);
    };
    ws.onclose = function () {
      statusEl.textContent = "Disconnected — retrying…";
      statusEl.className = "disconnected";
      reconnectTimer = setTimeout(connectWebSocket, 2000);
    };
    ws.onerror = function () { ws!.close(); };
  }

  // ── Beat update ──
  function onBeatUpdate(beat: number) {
    rawBeat = beat;
    heard = beat;
    if (doc && doc.card) {
      const on = cardShowing(beat, doc.card.startBeat);
      if (on === cardEl.hidden) showCard(on);
    }
    if (!song || !metered.length) return;
    const readingBeat = beat + offsetBeats;
    // What's playing now (not the reading position): section, bar and beat.
    const pos = songPosition(metered, beat, countInBeatsPerBar);
    updateSongMap(beat);
    nowSectionEl.textContent = " : " + (pos.section >= 0 ? sectionNames[pos.section] : "Count-in");
    // Bar out of the section's bars, so the reader sees how far through it is.
    barBeatEl.textContent = pos.section >= 0
      ? "(" + pos.bar + " : " + pos.beat + ") of " + metered[pos.section].bars
      : "(" + pos.bar + " : " + pos.beat + ")";
    beatDisplay.textContent = "m" + pos.measure + ":" + pos.beat;
    if (!doc) return;

    // Words and chords light at the reading position, ahead of the music; a
    // part's chart follows the bar actually playing.
    const reading = itemsAt(doc, readingBeat);
    const playing = itemsAt(doc, beat);
    panes.forEach(function (p) {
      if (autoScroll && running) showPage(p, panePageAt(p.pages, readingBeat), true);
      const at = isChart(p.channel) ? playing[p.channel.id] : reading[p.channel.id];
      light(p, at, isChart(p.channel) ? beat : readingBeat);
    });
  }

  function light(p: Pane, at: ChannelPosition, beat: number) {
    const rows = p.view.rows;
    if (p.litRow !== at.row) {
      if (p.litRow >= 0 && rows[p.litRow]) rows[p.litRow].el.classList.remove("current");
      if (at.row >= 0) rows[at.row].el.classList.add("current");
    }
    // The item: a word, a chord, a bar, or a figure run with its pass.
    const moved = p.litRow !== at.row || p.litItem !== at.item;
    if (p.litRow >= 0 && p.litItem >= 0 && moved) rows[p.litRow].items[p.litItem]?.classList.remove("now");
    if (at.row >= 0 && at.item >= 0) rows[at.row].items[at.item]?.classList.add("now");
    // Every repeated run shows its pass: 0 ahead, the count behind. A move
    // can be a jump either way, so all of them are set again.
    if (p.channel.kind === "figures" && (moved || at.pass !== p.litPass)) {
      p.channel.rows.forEach(function (row, r) {
        if (row.type !== "figures") return;
        row.items.forEach(function (run, i) {
          const el = rows[r].items[i];
          if (!el || run.count < 2) return;
          showPass(el, run, r === at.row && i === at.item ? at.pass ?? 0 : run.end <= beat ? run.count : 0);
        });
      });
    }
    // Words already sung in the current line stay marked.
    if (p.channel.kind === "lyrics" && at.row >= 0) {
      const row = p.channel.rows[at.row];
      rows[at.row].items.forEach(function (w, i) { w.classList.toggle("sung", row.items[i].start <= beat && i !== at.item); });
    }
    // The bar playing in a figure run.
    const bar = at.row >= 0 && at.item >= 0 && at.bar !== undefined ? rows[at.row].runBars?.[at.item]?.[at.bar] ?? null : null;
    if (bar !== p.litBar) {
      p.litBar?.classList.remove("now");
      bar?.classList.add("now");
      p.litBar = bar;
    }
    p.litRow = at.row;
    p.litItem = at.item;
    p.litPass = at.pass;
  }

  // ── Drawer ──
  // A section per pane, choosing what it shows.
  function renderDrawerChannels() {
    if (!drawerChannels) return;
    drawerChannels.innerHTML = "";
    if (!doc || layoutError) return;
    layout.views.forEach(function (name, slot) {
      const shown = name ? paneChannel(doc!, name) : null;
      const section = document.createElement("section");
      section.className = "drawer-section";
      const h = document.createElement("h2");
      h.textContent = slotName(slot);
      section.appendChild(h);
      channelChoices(doc!).forEach(function (c) {
        const label = document.createElement("label");
        label.className = "channel-row";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "view-" + slot;
        radio.checked = !!shown && shown.id === c.name;
        radio.addEventListener("change", function () {
          if (radio.checked) relayout({ pane: slot, view: c.name });
        });
        label.appendChild(document.createTextNode(c.label));
        label.appendChild(radio);
        section.appendChild(label);
      });
      drawerChannels.appendChild(section);
    });
  }

  /** The flip button shows the split it turns to; swap, which way the panes trade. */
  function showLayoutButtons() {
    const two = layout.panes === 2 && !layoutError;
    flipBtn.hidden = !two;
    swapBtn.hidden = !two;
    const toHorizontal = layout.split === "vertical";
    flipBtn.innerHTML = toHorizontal
      ? '<svg viewBox="0 0 20 16" aria-hidden="true"><rect x="1" y="1" width="18" height="14" rx="2"/><line x1="1" y1="8" x2="19" y2="8"/></svg>'
      : '<svg viewBox="0 0 20 16" aria-hidden="true"><rect x="1" y="1" width="18" height="14" rx="2"/><line x1="10" y1="1" x2="10" y2="15"/></svg>';
    flipBtn.title = toHorizontal ? "Stack the panes" : "Put the panes side by side";
    flipBtn.setAttribute("aria-label", flipBtn.title);
    swapBtn.textContent = toHorizontal ? "⇄" : "⇅";
    swapBtn.title = "Swap the panes";
    swapBtn.setAttribute("aria-label", swapBtn.title);
  }

  function setDrawerOpen(open: boolean) {
    drawer.classList.toggle("open", open);
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
    drawerBtn.setAttribute("aria-expanded", open ? "true" : "false");
    drawerScrim.hidden = !open;
  }

  // ── Controls ──
  function setupControls() {
    offsetSlider.addEventListener("input", function () {
      offsetBeats = parseFloat(this.value);
      offsetValue.textContent = String(offsetBeats);
      if (rawBeat >= 0) onBeatUpdate(rawBeat);
      writeUrl();
    });
    if (urlOptions.offset !== undefined) {
      offsetSlider.value = String(urlOptions.offset);
      offsetBeats = parseFloat(offsetSlider.value);
      offsetValue.textContent = String(offsetBeats);
    }
    function showScrollMode() {
      scrollModeBtn.classList.toggle("active", autoScroll);
      scrollModeBtn.textContent = autoScroll ? "Auto" : "Manual";
    }
    autoScroll = urlOptions.scroll !== "manual";
    showScrollMode();
    showScrollClass();
    scrollModeBtn.addEventListener("click", function () {
      autoScroll = !autoScroll;
      showScrollMode();
      showScrollClass();
      writeUrl();
    });
    if (urlOptions.theme === "light") {
      document.body.classList.add("light");
      darkModeBtn.textContent = "☀️";
    }
    showLayoutButtons();
    flipBtn.addEventListener("click", function () { relayout({ flip: true }); showLayoutButtons(); });
    swapBtn.addEventListener("click", function () { relayout({ swap: true }); });
    drawerBtn.addEventListener("click", function () { setDrawerOpen(!drawer.classList.contains("open")); });
    byId("drawer-close").addEventListener("click", function () { setDrawerOpen(false); });
    drawerScrim.addEventListener("click", function () { setDrawerOpen(false); });
    darkModeBtn.addEventListener("click", function () {
      document.body.classList.toggle("light");
      this.textContent = document.body.classList.contains("light") ? "☀️" : "🌙";
      writeUrl();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setDrawerOpen(false);
      if (e.key === "ArrowUp") { offsetSlider.value = String(parseFloat(offsetSlider.value) + 0.5); offsetSlider.dispatchEvent(new Event("input")); }
      if (e.key === "ArrowDown") { offsetSlider.value = String(parseFloat(offsetSlider.value) - 0.5); offsetSlider.dispatchEvent(new Event("input")); }
    });
  }

  init();
})();
