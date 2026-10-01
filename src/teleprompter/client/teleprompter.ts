/**
 * clickbAIt Teleprompter — browser client
 *
 * Shows the song's channels (lyrics, chords, drums) as panes stacked in the
 * order the viewer picks, each following the beat on its own. A pane shows
 * a set number of its channel's rows and turns them all at once as its
 * bottom row starts, so that row moves to the top (see panes.ts). Section
 * names are only in the header.
 *
 * The song comes from the relay (its lyrics display for the header and
 * timing, its row document for the panes) with beats over the WebSocket, or
 * in a practice bundle inline, with beats from an <audio> element.
 */

import { Curve } from "../../core/curve.js";
import { sectionLoopBounds, loopWrapTarget } from "../loop.js";
import { songPosition, sectionMeters } from "../position.js";
import { parseDisplayOptions, displayQuery } from "../display-options.js";
import { songMap, songProgress } from "../song-map.js";
import { itemsAt, type RowChannel, type RowDocument } from "../rows.js";
import { panePages, panePageAt, type PanePage } from "../panes.js";
import { channelView, showPass, type ChannelView } from "./pane-view.js";
import { drawNotation } from "./notation.js";

(function () {
  "use strict";

  // ── State ──
  let song = null;         // the lyrics display: header, sections, timing
  let doc: RowDocument | null = null; // the row document: what the panes show
  let curve = null;        // Curve built from the display's curve (bundle mode)
  let ws = null;
  let autoScroll = true;
  let offsetBeats = 0;
  let rawBeat = -1;      // most recent beat from OSC (no offset applied)
  let reconnectTimer = null;

  // The page's options come from its URL first (so a setup is a link), then
  // from what this screen remembers. Changing one writes it back to the URL.
  let urlOptions = parseDisplayOptions(location.search, ["header"]);

  /** One pane: a channel's rows in a window that shows `perPage` of them. */
  interface Pane {
    channel: RowChannel;
    view: ChannelView;
    el: HTMLElement;
    rowsEl: HTMLElement;
    perPage: number;
    pages: PanePage[];
    page: number;
    litRow: number;
    litItem: number;
  }
  let panes: Pane[] = [];
  let order: string[] = [];  // channel ids shown, top to bottom
  let generation = 0;        // bumped per render, so a late notation load is dropped

  // ── Clock (pub/sub) ──
  const clock = (function () {
    const subs = new Set();
    return {
      subscribe: function (cb) { subs.add(cb); return function () { subs.delete(cb); }; },
      emit: function (beat) { subs.forEach(function (cb: any) { cb(beat); }); },
    };
  })();

  // ── DOM refs ──
  const titleEl = document.getElementById("song-title");
  const container = document.getElementById("panes");
  const statusEl = document.getElementById("connection-status");
  const beatDisplay = document.getElementById("beat-display");
  const nowSectionEl = document.getElementById("now-section");
  const barBeatEl = document.getElementById("bar-beat");
  const songMapEl = document.getElementById("song-map");
  let mapFills = [];  // section index -> its fill element in the song map
  let ringed = -1;    // bundle: the section the player was sent to, ringed until it plays

  // Sections with their meters and names, for the header's Section and Bar:Beat.
  let metered = [];
  let sectionNames = [];
  let countInBeatsPerBar = 4;
  const offsetSlider = document.getElementById("offset-slider") as HTMLInputElement;
  const offsetValue = document.getElementById("offset-value");
  const scrollModeBtn = document.getElementById("scroll-mode-btn");
  const darkModeBtn = document.getElementById("dark-mode-btn");
  const bundleControls = document.getElementById("bundle-controls");
  const loopFrom = document.getElementById("loop-from") as HTMLSelectElement;
  const loopTo = document.getElementById("loop-to") as HTMLSelectElement;
  const speedSlider = document.getElementById("speed-slider") as HTMLInputElement;
  const speedValue = document.getElementById("speed-value");
  const playBtn = document.getElementById("play-btn");
  const playTime = document.getElementById("play-time");
  const drawer = document.getElementById("drawer");
  const drawerBtn = document.getElementById("drawer-btn");
  const drawerScrim = document.getElementById("drawer-scrim");
  const drawerChannels = document.getElementById("drawer-channels");

  // Bundle-mode section loop: audio-time window we keep playback inside, or null.
  let loop = null;

  // ── Channels ──
  // What each kind of channel starts with. A size is in rem; `rows` is how
  // many of its rows its pane shows.
  const KINDS = {
    lyrics: { label: "Lyrics", size: 1.5, min: 0.75, max: 3, step: 0.125, rows: 6 },
    chords: { label: "Chords", size: 1.3, min: 0.6, max: 3, step: 0.05, rows: 2 },
    drums: { label: "Drums", size: 1.2, min: 0.6, max: 2.5, step: 0.05, rows: 2 },
  };
  const HEADER = { channel: "header", label: "Header", cssVar: "--header-size", size: 1.2, min: 0.8, max: 3, step: 0.05 };
  const MAX_ROWS = 20;

  function kindOf(channel: RowChannel) { return KINDS[channel.kind]; }

  function channelLabel(channel: RowChannel): string {
    if (channel.kind === "drums") {
      const name = channel.instrument || channel.id;
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return kindOf(channel).label;
  }

  /** The channels a list of names asks for: each name an id or an instrument. */
  function resolve(names: readonly string[]): string[] {
    const ids: string[] = [];
    names.forEach(function (name) {
      doc!.channels.forEach(function (c) {
        const match = c.id === name || (c.kind === "drums" && c.instrument === name);
        if (match && ids.indexOf(c.id) < 0) ids.push(c.id);
      });
    });
    return ids;
  }

  function remembered(key: string): string | null {
    try { return localStorage.getItem("clickbait." + key); } catch (e) { return null; }
  }
  function remember(key: string, value: string): void {
    try { localStorage.setItem("clickbait." + key, value); } catch (e) { /* private window */ }
  }

  /** The panes to show: the URL's channels, else what this screen showed last, else lyrics. */
  function wantedOrder(): string[] {
    if (urlOptions.channels) return resolve(urlOptions.channels);
    const saved = remembered("channels");
    if (saved !== null) {
      try { return resolve(JSON.parse(saved)); } catch (e) { /* ignore */ }
    }
    const lyrics = resolve(["lyrics"]);
    return lyrics.length ? lyrics : doc!.channels.slice(0, 1).map(function (c) { return c.id; });
  }

  function sizeOf(channel: RowChannel): number {
    const k = kindOf(channel);
    const v = urlOptions.sizes[channel.id] ?? parseFloat(remembered("size." + channel.id) ?? "");
    return isNaN(v) ? k.size : Math.min(k.max, Math.max(k.min, v));
  }

  function rowsOf(channel: RowChannel): number {
    const v = urlOptions.rows[channel.id] ?? parseInt(remembered("rows." + channel.id) ?? "", 10);
    return isNaN(v) ? kindOf(channel).rows : Math.min(MAX_ROWS, Math.max(1, v));
  }

  function headerSize(): number {
    const v = urlOptions.sizes.header ?? parseFloat(remembered("size.header") ?? "");
    return isNaN(v) ? HEADER.size : Math.min(HEADER.max, Math.max(HEADER.min, v));
  }

  /** Rewrite the URL to match the page, so copying it copies the setup. */
  function writeUrl() {
    const options = {
      channels: order.slice(),
      sizes: {},
      rows: {},
      offset: offsetBeats !== 0 ? offsetBeats : undefined,
      scroll: autoScroll ? undefined : "manual",
      theme: document.body.classList.contains("light") ? "light" : undefined,
    } as any;
    if (headerSize() !== HEADER.size) options.sizes.header = headerSize();
    const names = ["header"];
    (doc ? doc.channels : []).forEach(function (c) {
      names.push(c.id);
      if (order.indexOf(c.id) < 0) return;
      if (sizeOf(c) !== kindOf(c).size) options.sizes[c.id] = sizeOf(c);
      if (rowsOf(c) !== kindOf(c).rows) options.rows[c.id] = rowsOf(c);
    });
    try { history.replaceState(null, "", location.pathname + displayQuery(options, names)); } catch (e) { /* file:// */ }
  }

  /** Change what's shown and re-render in place, keeping the beat. */
  function changed() {
    remember("channels", JSON.stringify(order));
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
      song = (window as any).__SONG_DATA__;
      // A practice bundle carries its rows inline; there's no relay to ask.
      doc = song.rows || null;
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

  function updateSongMap(beat) {
    const p = songProgress(metered, beat);
    mapFills.forEach(function (fill, i) {
      const done = i < p.section ? 1 : i === p.section ? p.inSection : 0;
      fill.style.width = (done * 100) + "%";
      fill.parentNode.classList.toggle("past", i < p.section);
      fill.parentNode.classList.toggle("now", i === p.section);
      // While a bundle's player is stopped, ring where it will play from:
      // the section it was sent to, else the one it's in.
      const paused = document.body.classList.contains("paused");
      fill.parentNode.classList.toggle("ring", paused && i === (ringed >= 0 ? ringed : p.section));
    });
  }

  // ── Bundle-mode clock: drive from <audio id="mix-audio"> ──
  function startAudioClock() {
    const audio = document.getElementById("mix-audio") as HTMLAudioElement;
    if (!audio) {
      statusEl.textContent = "No <audio id=\"mix-audio\"> element found";
      statusEl.className = "disconnected";
      return;
    }
    statusEl.textContent = "Bundle mode";
    statusEl.className = "connected";
    function playing(on: boolean) {
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
      const s = song.display.sections[i];
      ringed = i;
      audio.currentTime = Math.max(0, curve.toTime(s.cueBeat !== undefined ? s.cueBeat : s.startBeat) + 0.03);
      if (audio.paused) clock.emit(curve.toBeat(audio.currentTime));
    });

    // Mix variant (full / minus-<part> / click only): the bundle inlines one
    // <option> per rendered file. Every variant is the same render length, so
    // section loops carry over; playback restarts from the top on a switch.
    const variantSel = document.getElementById("mix-variant") as HTMLSelectElement;
    if (variantSel) {
      variantSel.addEventListener("change", function () {
        const wasPlaying = !audio.paused;
        audio.src = variantSel.value;
        audio.load();
        audio.currentTime = 0;
        if (wasPlaying) audio.play().catch(function () {});
      });
    }
    const sections = (song.display && song.display.sections) || [];

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
      const b = sectionLoopBounds(sections, from, to, function (beat) { return curve.toTime(beat); }, dur);
      loop = { startTime: b.startTime, endTime: b.endTime };
      audio.currentTime = b.startTime;
      if (audio.paused) audio.play().catch(function () {});
    }

    loopFrom.addEventListener("change", applyLoop);
    loopTo.addEventListener("change", applyLoop);

    function applySpeed(v) {
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
    if (song.schema !== "clickbait/lyrics-display@1") {
      renderWaiting();
      titleEl.textContent = song.title || "Song";
      container.innerHTML = '<div class="waiting-message">This song was built by an older clickbait. Rebuild it to show it here.</div>';
      return;
    }
    curve = song.curve ? new Curve(song.curve) : null;

    titleEl.textContent = song.title;
    nowSectionEl.textContent = "";
    barBeatEl.textContent = "–";
    countInBeatsPerBar = (song.timeSignature && song.timeSignature[0]) || 4;
    metered = sectionMeters(song);
    sectionNames = song.display.sections.map(function (s) { return s.name; });
    renderSongMap();
    document.title = song.title + " — clickbAIt: One Simple Track";

    // Sizes and rows in the URL are by channel id, known only now.
    const names = ["header"].concat(doc ? doc.channels.map(function (c) { return c.id; }) : []);
    urlOptions = parseDisplayOptions(location.search, names);
    order = doc ? wantedOrder() : [];
    renderPanes();
    renderDrawerChannels();

    // New song: clear the beat position, so the page doesn't linger at the
    // previous song's place until the next OSC beat arrives.
    rawBeat = -1;
    window.scrollTo(0, 0);
  }

  function renderPanes() {
    container.innerHTML = "";
    panes = [];
    const gen = ++generation;
    if (!doc) {
      container.innerHTML = '<div class="waiting-message">No rows for this song yet. Rebuild it to show it here.</div>';
      return;
    }
    if (!order.length) {
      container.innerHTML = '<div class="waiting-message">Nothing shown. Pick channels in ⚙.</div>';
      return;
    }
    order.forEach(function (id) {
      const channel = doc!.channels.filter(function (c) { return c.id === id; })[0];
      if (!channel) return;
      const view = channelView(channel);
      const el = document.createElement("section");
      el.className = "pane pane-" + channel.kind;
      el.style.fontSize = sizeOf(channel) + "rem";
      // Notation scales with the pane's size.
      if (channel.kind === "drums") el.style.setProperty("--drum-zoom", String(sizeOf(channel) / 1.2));
      const rowsEl = document.createElement("div");
      rowsEl.className = "pane-rows";
      view.rows.forEach(function (r) { rowsEl.appendChild(r.el); });
      el.appendChild(rowsEl);
      container.appendChild(el);
      const perPage = rowsOf(channel);
      const pane: Pane = { channel, view, el, rowsEl, perPage, pages: panePages(channel.rows, perPage), page: -1, litRow: -1, litItem: -1 };
      panes.push(pane);
      // A bundle carries its staffs drawn; live, they draw once alphaTab and
      // the score load, and the pane is sized again when they do.
      const drawn = song.notation && song.notation[channel.id];
      if (drawn) {
        view.notation.forEach(function (t) { t.el.innerHTML = drawn[t.scoreBar] || ""; });
      } else if (channel.kind === "drums" && view.notation.length && !song.bundle) {
        const ink = getComputedStyle(document.body).color;
        drawNotation(view.notation, "/charts/source/" + encodeURIComponent(channel.id), channel.track, ink)
          .then(function () { if (gen === generation) sizePane(pane); })
          .catch(function (e) { statusEl.textContent = "Notation: " + e.message; });
      }
      if (typeof ResizeObserver !== "undefined") new ResizeObserver(function () { sizePane(pane); }).observe(rowsEl);
    });
    panes.forEach(sizePane);
    showScrollClass();
  }

  /** Make a pane tall enough for its tallest page, and put it back on its page. */
  function sizePane(p: Pane) {
    const rows = p.view.rows.map(function (r) { return r.el; });
    let height = 0;
    p.pages.forEach(function (pg) {
      const top = rows[pg.first].offsetTop;
      const bottom = rows[pg.last].offsetTop + rows[pg.last].offsetHeight;
      height = Math.max(height, bottom - top);
    });
    p.el.style.height = height ? height + "px" : "";
    const page = p.page;
    p.page = -1;
    if (page >= 0) showPage(p, page, false);
  }

  function showPage(p: Pane, index: number, smooth: boolean) {
    if (index === p.page || !p.pages[index]) return;
    p.page = index;
    const top = p.view.rows[p.pages[index].first].el.offsetTop;
    try { p.el.scrollTo({ top, behavior: smooth ? "smooth" : "auto" }); } catch (e) { p.el.scrollTop = top; }
  }

  /** Manual scroll lets the reader scroll each pane; auto turns them. */
  function showScrollClass() {
    container.classList.toggle("manual", !autoScroll);
  }

  // ── Show state (bail / vamp), pushed by the relay ──
  //
  // The display's precision should track the system's confidence. The moment
  // someone bails, the band is free-running, so the body gets a mode class
  // and the CSS stops pointing at a word that may be wrong.
  function applyShowState(state) {
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
      else if (msg.type === "show-state") applyShowState(msg.state);
    };
    ws.onclose = function () {
      statusEl.textContent = "Disconnected — retrying…";
      statusEl.className = "disconnected";
      reconnectTimer = setTimeout(connectWebSocket, 2000);
    };
    ws.onerror = function () { ws.close(); };
  }

  // ── Beat update ──
  function onBeatUpdate(beat) {
    rawBeat = beat;
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
    // drum pass counts the bar actually playing.
    const reading = itemsAt(doc, readingBeat);
    const playing = itemsAt(doc, beat);
    panes.forEach(function (p) {
      if (autoScroll) showPage(p, panePageAt(p.pages, readingBeat), true);
      const at = p.channel.kind === "drums" ? playing[p.channel.id] : reading[p.channel.id];
      light(p, at, p.channel.kind === "drums" ? beat : readingBeat);
    });
  }

  function light(p: Pane, at, beat: number) {
    const rows = p.view.rows;
    if (p.litRow !== at.row) {
      if (p.litRow >= 0 && rows[p.litRow]) rows[p.litRow].el.classList.remove("current");
      if (at.row >= 0) rows[at.row].el.classList.add("current");
    }
    // The item: a word, a chord, or a drum run with its pass.
    if (p.litRow >= 0 && p.litItem >= 0 && (p.litRow !== at.row || p.litItem !== at.item)) {
      const old = rows[p.litRow].items[p.litItem];
      if (old) {
        old.classList.remove("now");
        if (p.channel.kind === "drums") showPass(old, p.channel.rows[p.litRow].items[p.litItem], 0);
      }
    }
    if (at.row >= 0 && at.item >= 0) {
      const item = rows[at.row].items[at.item];
      if (item) {
        item.classList.add("now");
        if (p.channel.kind === "drums") showPass(item, p.channel.rows[at.row].items[at.item], at.pass);
      }
    }
    // Words already sung in the current line stay marked.
    if (p.channel.kind === "lyrics" && at.row >= 0) {
      const row = p.channel.rows[at.row];
      rows[at.row].items.forEach(function (w, i) { w.classList.toggle("sung", row.items[i].start <= beat && i !== at.item); });
    }
    p.litRow = at.row;
    p.litItem = at.item;
  }

  // ── Drawer ──
  // A checkbox per channel the song offers, with buttons to move it up or
  // down the stack, then each shown channel's size and rows.
  function renderDrawerChannels() {
    if (!drawerChannels) return;
    drawerChannels.innerHTML = "";

    const list = document.createElement("section");
    list.className = "drawer-section";
    const listHead = document.createElement("h2");
    listHead.textContent = "Channels";
    list.appendChild(listHead);
    const offered = doc ? doc.channels.slice() : [];
    // Shown channels first, in their order, then the rest.
    offered.sort(function (a, b) {
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    offered.forEach(function (c) {
      const label = document.createElement("label");
      label.className = "channel-row";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = order.indexOf(c.id) >= 0;
      box.addEventListener("change", function () {
        order = box.checked ? order.concat([c.id]) : order.filter(function (id) { return id !== c.id; });
        changed();
      });
      label.appendChild(document.createTextNode(channelLabel(c)));
      const i = order.indexOf(c.id);
      if (i >= 0) {
        const move = document.createElement("span");
        move.className = "move";
        [["↑", -1], ["↓", 1]].forEach(function (m) {
          const btn = document.createElement("button");
          btn.textContent = m[0] as string;
          btn.title = m[1] === -1 ? "Move up" : "Move down";
          const j = i + (m[1] as number);
          btn.disabled = j < 0 || j >= order.length;
          btn.addEventListener("click", function (e) {
            e.preventDefault();
            const next = order.slice();
            next[i] = order[j];
            next[j] = order[i];
            order = next;
            changed();
          });
          move.appendChild(btn);
        });
        label.appendChild(move);
      }
      label.appendChild(box);
      list.appendChild(label);
    });
    drawerChannels.appendChild(list);

    // The header's size, then each shown channel's.
    drawerChannels.appendChild(settingsSection(HEADER.label, [
      slider("Size", HEADER, headerSize(), function (v) {
        delete urlOptions.sizes.header;
        remember("size.header", String(v));
        applyHeaderSize(v);
      }),
    ]));
    order.forEach(function (id) {
      const c = doc!.channels.filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      const k = kindOf(c);
      drawerChannels.appendChild(settingsSection(channelLabel(c), [
        slider("Size", k, sizeOf(c), function (v) {
          delete urlOptions.sizes[c.id];
          remember("size." + c.id, String(v));
          writeUrl();
          const pane = panes.filter(function (p) { return p.channel.id === c.id; })[0];
          if (pane) {
            pane.el.style.fontSize = v + "rem";
            if (c.kind === "drums") pane.el.style.setProperty("--drum-zoom", String(v / 1.2));
          }
        }),
        rowsInput(c),
      ]));
    });
  }

  function settingsSection(title: string, controls: HTMLElement[]): HTMLElement {
    const section = document.createElement("section");
    section.className = "drawer-section";
    const h = document.createElement("h2");
    h.textContent = title;
    section.appendChild(h);
    controls.forEach(function (c) { section.appendChild(c); });
    return section;
  }

  function slider(name: string, range, value: number, onInput: (v: number) => void): HTMLElement {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.value = String(value);
    input.addEventListener("input", function () {
      onInput(parseFloat(input.value));
      writeUrl();
    });
    label.appendChild(document.createTextNode(name));
    label.appendChild(input);
    return label;
  }

  function rowsInput(c: RowChannel): HTMLElement {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = String(MAX_ROWS);
    input.value = String(rowsOf(c));
    input.className = "rows-input";
    input.addEventListener("change", function () {
      const v = Math.min(MAX_ROWS, Math.max(1, parseInt(input.value, 10) || 1));
      delete urlOptions.rows[c.id];
      remember("rows." + c.id, String(v));
      changed();
    });
    label.appendChild(document.createTextNode("Rows"));
    label.appendChild(input);
    return label;
  }

  function applyHeaderSize(v: number) {
    document.documentElement.style.setProperty(HEADER.cssVar, v + "rem");
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
    applyHeaderSize(headerSize());
    drawerBtn.addEventListener("click", function () { setDrawerOpen(!drawer.classList.contains("open")); });
    document.getElementById("drawer-close").addEventListener("click", function () { setDrawerOpen(false); });
    drawerScrim.addEventListener("click", function () { setDrawerOpen(false); });
    darkModeBtn.addEventListener("click", function () {
      document.body.classList.toggle("light");
      this.textContent = document.body.classList.contains("light") ? "☀️" : "🌙";
      writeUrl();
      // Notation is drawn in the theme's ink, so redraw it in the new one.
      if (panes.some(function (p) { return p.view.notation.length > 0; })) {
        renderPanes();
        if (rawBeat >= 0) onBeatUpdate(rawBeat);
      }
    });
    // The picker's Custom choice opens the page with the settings out.
    if (new URLSearchParams(location.search).get("settings") === "open") setDrawerOpen(true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setDrawerOpen(false);
      if (e.key === "ArrowUp") { offsetSlider.value = String(parseFloat(offsetSlider.value) + 0.5); offsetSlider.dispatchEvent(new Event("input")); }
      if (e.key === "ArrowDown") { offsetSlider.value = String(parseFloat(offsetSlider.value) - 0.5); offsetSlider.dispatchEvent(new Event("input")); }
    });
  }

  init();
})();
