/**
 * clickbAIt Teleprompter — browser client
 *
 * Fetches the full song on load, connects to the relay WebSocket (or drives
 * off an <audio> element in bundle mode), and highlights/scrolls lyrics from
 * the incoming beat position.
 *
 * Two song formats, detected at load:
 *   - LyricsDisplay (`schema: "clickbait/lyrics-display@1"`): word-level
 *     karaoke highlight, beats resolved through the song curve.
 *   - Legacy SongPayload (sections with line-level `lyrics[]`): the original
 *     whole-line highlight. Kept so songs not yet rebuilt still display.
 */

import { Curve } from "../../core/curve.js";
import { sectionLoopBounds, loopWrapTarget } from "../loop.js";
import { activeIndex } from "../highlight.js";
import { layoutChords, currentChord, followTarget, barGrid, rowLines, BARS_PER_LINE } from "../../charts/chord-layout.js";
import { songPosition, sectionMeters } from "../position.js";
import { parseDisplayOptions, displayQuery } from "../display-options.js";
import { songMap, songProgress } from "../song-map.js";
import { runAt } from "../../charts/grooves.js";
import { loadAlphaTab, loadScore, renderBar } from "./notation.js";

(function () {
  "use strict";

  // ── State ──
  let song = null;
  let isLD = false;        // true when song is a LyricsDisplay
  let curve = null;        // Curve built from LyricsDisplay.curve (bundle mode)
  let ws = null;
  let autoScroll = true;
  let offsetBeats = 0;
  let rawBeat = -1;      // most recent beat from OSC (no offset applied)
  let currentBeat = -1;  // rawBeat + offsetBeats (reading position)
  let sectionElements = [];
  let lyricElements = [];  // legacy: flat list of { el, beat, sectionIdx }
  let wordElements = [];   // LyricsDisplay: flat list of { el, startBeat, lineEl }
  let reconnectTimer = null;

  // Chords: the relay's /charts/chords for the current song, shown when the
  // viewer turns them on (a drummer's screen can leave them off).
  // The page's options come from its URL first (so a setup is a link), then
  // from what this screen remembers. Changing one writes it back to the URL.
  const SIZED = ["header", "lyrics", "chords", "drums"];
  const urlOptions = parseDisplayOptions(location.search, SIZED);
  let chordData = null;    // { sections, chords } or null when the song has none
  let chordsOn = channelWanted("chords", false);
  let lyricsOn = channelWanted("lyrics", true);
  // Drums: the song's drum chart (groove letters), from /charts/chart/<id>.
  let drumChart = null;    // the built chart, or null when the song has none
  let drumsOn = channelWanted("drums", false);
  let drumRuns = [];       // section index -> run index -> { el, label, run }
  let drumSectionEls = []; // section index -> its element in the drum chart
  let lastRun = null;
  let drumGeneration = 0;  // bumped per render, so a late score load is dropped
  let chordLayout = null;  // from layoutChords, while chords are shown
  let chordInput = null;   // the layout's input, kept for followTarget
  let chordEls = [];       // chord index -> its element
  let rowEls = [];         // chord row index -> its element
  let lastChord = -1;

  // ── Clock (pub/sub) ──
  const clock = (function () {
    const subs = new Set();
    return {
      subscribe: function (cb) { subs.add(cb); return function () { subs.delete(cb); }; },
      emit: function (beat) { subs.forEach(function (cb) { cb(beat); }); },
    };
  })();

  // Curve (time <-> beat) is the real src/core/curve.ts, imported and bundled —
  // no more hand-ported copy to keep in sync. `curve` below is a Curve instance.

  // Legacy: piecewise-linear accumulation along the tempo map.
  function secondsToBeats(seconds, s) {
    const map = s.tempoMap || [];
    if (map.length === 0) return (seconds / 60) * s.bpm;
    let beat = 0, prevSec = 0, bpm = map[0].bpm;
    for (let i = 0; i < map.length; i++) {
      const tp = map[i];
      if (tp.seconds >= seconds) break;
      if (tp.seconds > prevSec) {
        beat += ((tp.seconds - prevSec) / 60) * bpm;
        prevSec = tp.seconds;
      }
      bpm = tp.bpm;
    }
    beat += ((seconds - prevSec) / 60) * bpm;
    return beat;
  }

  function beatFromSeconds(seconds) {
    return isLD ? curve.toBeat(seconds) : secondsToBeats(seconds, song);
  }

  // ── DOM refs ──
  const titleEl = document.getElementById("song-title");
  const metaEl = document.getElementById("song-meta");
  const container = document.getElementById("lyrics-container");
  const statusEl = document.getElementById("connection-status");
  const beatDisplay = document.getElementById("beat-display");
  const nowSectionEl = document.getElementById("now-section");
  const barBeatEl = document.getElementById("bar-beat");
  const songMapEl = document.getElementById("song-map");
  let mapFills = [];  // section index -> its fill element in the song map

  // Sections with their meters and names, for the header's Section and Bar:Beat.
  let metered = [];
  let sectionNames = [];
  let countInBeatsPerBar = 4;
  const offsetSlider = document.getElementById("offset-slider");
  const offsetValue = document.getElementById("offset-value");
  const scrollModeBtn = document.getElementById("scroll-mode-btn");
  const darkModeBtn = document.getElementById("dark-mode-btn");
  const transportLight = document.getElementById("transport-light");
  const bundleControls = document.getElementById("bundle-controls");
  const loopFrom = document.getElementById("loop-from");
  const loopTo = document.getElementById("loop-to");
  const speedSlider = document.getElementById("speed-slider");
  const speedValue = document.getElementById("speed-value");
  const drawer = document.getElementById("drawer");
  const drawerBtn = document.getElementById("drawer-btn");
  const drawerScrim = document.getElementById("drawer-scrim");
  const drawerChannels = document.getElementById("drawer-channels");

  // Bundle-mode section loop: audio-time window we keep playback inside, or null.
  let loop = null;

  // ── Init ──
  function renderWaiting() {
    titleEl.textContent = "Waiting for song…";
    metaEl.textContent = "Start playback in REAPER, or load a region matching a song slug.";
    nowSectionEl.textContent = "";
    barBeatEl.textContent = "–";
    metered = [];
    sectionNames = [];
    renderSongMap();
    document.title = "clickbAIt: One Simple Track";
    container.innerHTML = '<div class="waiting-message">No song loaded yet.</div>';
    sectionElements = [];
    lyricElements = [];
    wordElements = [];
  }

  async function loadSong() {
    if (typeof window.__SONG_DATA__ === "object" && window.__SONG_DATA__) {
      song = window.__SONG_DATA__;
      // A practice bundle carries its chords inline; there's no relay to ask.
      chordData = song.chordData || null;
      renderSong();
      return;
    }
    try {
      var res = await fetch("song.json");
      if (!res.ok) { renderWaiting(); return; }
      song = await res.json();
      await loadChords();
      await loadDrums();
      renderSong();
      renderDrawerChannels();
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
      var el = document.createElement("div");
      el.className = "map-seg";
      el.style.flex = seg.width + " 1 0";
      el.title = sectionNames[i] || "";
      var fill = document.createElement("div");
      fill.className = "map-fill";
      el.appendChild(fill);
      songMapEl.appendChild(el);
      mapFills.push(fill);
    });
  }

  function updateSongMap(beat) {
    var p = songProgress(metered, beat);
    mapFills.forEach(function (fill, i) {
      var done = i < p.section ? 1 : i === p.section ? p.inSection : 0;
      fill.style.width = (done * 100) + "%";
      fill.parentNode.classList.toggle("past", i < p.section);
      fill.parentNode.classList.toggle("now", i === p.section);
    });
  }

  // ── Chords ──
  // On when the page asks for them (?channels=chords,lyrics) or the viewer
  // turned them on last time.
  function channelWanted(channel, byDefault) {
    if (urlOptions.channels) return urlOptions.channels.indexOf(channel) >= 0;
    try {
      var saved = localStorage.getItem("clickbait." + channel);
      if (saved !== null) return saved === "1";
    } catch (e) { /* private window */ }
    return byDefault;
  }

  /** Rewrite the URL to match the page, so copying it copies the setup. */
  function writeUrl() {
    var options = {
      channels: [lyricsOn ? "lyrics" : null, chordsOn ? "chords" : null, drumsOn ? "drums" : null].filter(Boolean),
      sizes: {},
      offset: offsetBeats !== 0 ? offsetBeats : undefined,
      scroll: autoScroll ? undefined : "manual",
      theme: document.body.classList.contains("light") ? "light" : undefined,
    };
    CHANNELS.forEach(function (c) {
      if (currentSizes[c.channel] !== undefined && currentSizes[c.channel] !== c.size) options.sizes[c.channel] = currentSizes[c.channel];
    });
    try { history.replaceState(null, "", location.pathname + displayQuery(options, SIZED)); } catch (e) { /* file:// */ }
  }

  async function loadChords() {
    chordData = null;
    try {
      var res = await fetch("/charts/chords");
      if (res.ok) chordData = await res.json();
    } catch (e) { /* no relay charts: no chords */ }
  }

  /** Turn chords on or off, re-rendering in place so the page keeps its beat. */
  function setChordsOn(on) {
    chordsOn = on;
    channelChanged("chords", on);
  }

  function setDrumsOn(on) {
    drumsOn = on;
    channelChanged("drums", on);
  }

  function setLyricsOn(on) {
    lyricsOn = on;
    channelChanged("lyrics", on);
  }

  /** Remember a channel switch and re-render in place, keeping the beat. */
  function channelChanged(channel, on) {
    try { localStorage.setItem("clickbait." + channel, on ? "1" : "0"); } catch (e) { /* private window */ }
    writeUrl();
    var beat = rawBeat;
    renderSong();
    if (beat >= 0) onBeatUpdate(beat);
  }

  /** The song's first drum chart, if it has one. */
  async function loadDrums() {
    drumChart = null;
    try {
      var res = await fetch("/charts/channels");
      if (!res.ok) return;
      var drums = (await res.json()).channels.filter(function (c) { return c.kind === "drums"; })[0];
      if (!drums) return;
      var one = await fetch("/charts/chart/" + encodeURIComponent(drums.id));
      if (one.ok) drumChart = (await one.json()).chart;
    } catch (e) { /* no relay charts: no drums */ }
  }

  /** Whether a run shows its groove's notation (its first time in the section). */
  function drawsNotation(run) {
    return run.first && run.letter !== null;
  }

  /** The run's letter: "(A)" over notation, "A" alone, "–" for no score bar. */
  function runLetter(run) {
    return run.letter === null ? "–" : drawsNotation(run) ? "(" + run.letter + ")" : run.letter;
  }

  /**
   * Show a run's count ("×4"), after its notation or after its letter. While
   * it plays, which pass this is ("3/4") hangs under the count, taking no room
   * in the line, so the line doesn't reflow as the highlight moves.
   */
  function showRun(ref, pass) {
    var count = ref.run.count > 1 ? "×" + ref.run.count : "";
    var el = ref.count || ref.label;
    el.textContent = ref.count ? count : runLetter(ref.run) + (count ? " " + count : "");
    if (pass && ref.run.count > 1) {
      var tag = document.createElement("span");
      tag.className = "drum-pass";
      tag.textContent = pass + "/" + ref.run.count;
      el.appendChild(tag);
    }
  }

  /**
   * The drum chart: a line per section of groove letters, with each groove's
   * notation drawn where it's first played.
   */
  function renderDrumChart() {
    drumRuns = [];
    drumSectionEls = [];
    lastRun = null;
    var generation = ++drumGeneration;
    var chart = document.createElement("div");
    chart.className = "drum-chart";
    var toDraw = [];
    drumChart.grooves.sections.forEach(function (sec) {
      var secEl = document.createElement("div");
      secEl.className = "drum-section";
      var nameEl = document.createElement("div");
      nameEl.className = "section-name";
      var bars = metered[sec.section] ? metered[sec.section].bars : 0;
      nameEl.textContent = (sectionNames[sec.section] || "") + (bars ? " · " + bars + (bars === 1 ? " bar" : " bars") : "");
      secEl.appendChild(nameEl);
      if (!lyricsOn && metered[sec.section]) sectionElements.push({ el: nameEl, beat: metered[sec.section].startBeat });
      var runsEl = document.createElement("div");
      runsEl.className = "drum-runs";
      drumRuns[sec.section] = sec.runs.map(function (run) {
        var runEl = document.createElement("div");
        runEl.className = "drum-run" + (run.first ? " first" : "");
        var label = document.createElement("span");
        label.className = "drum-label";
        runEl.appendChild(label);
        var ref = { el: runEl, label: label, count: null, run: run };
        if (drawsNotation(run)) {
          // In line: the letter, the groove, and its count after it: (B) [groove] ×8.
          label.textContent = runLetter(run);
          var body = document.createElement("div");
          body.className = "drum-body";
          body.appendChild(label);
          var groove = drumChart.grooves.grooves.filter(function (g) { return g.letter === run.letter; })[0];
          var notation = document.createElement("div");
          notation.className = "drum-notation";
          body.appendChild(notation);
          ref.count = document.createElement("span");
          ref.count.className = "drum-label drum-count";
          body.appendChild(ref.count);
          runEl.appendChild(body);
          if (groove) toDraw.push({ el: notation, bar: groove.scoreBar });
        }
        showRun(ref, 0);
        runsEl.appendChild(runEl);
        return ref;
      });
      secEl.appendChild(runsEl);
      chart.appendChild(secEl);
      drumSectionEls[sec.section] = secEl;
    });
    container.appendChild(chart);

    // Notation draws once alphaTab and the score have loaded.
    Promise.all([loadAlphaTab(), loadScore("/charts/source/" + encodeURIComponent(drumChart.id))])
      .then(function (loaded) {
        if (generation !== drumGeneration) return;
        // Ink in the page's text color, so notation reads in either theme.
        var ink = getComputedStyle(document.body).color;
        toDraw.forEach(function (d) { renderBar(loaded[0], d.el, loaded[1], drumChart.track, d.bar, ink); });
      })
      .catch(function (e) { statusEl.textContent = "Notation: " + e.message; });
  }

  /** Light the drum run playing, with which pass of it this is ("3/8"). */
  function updateDrumHighlight(beat) {
    if (!drumChart || !drumRuns.length) return;
    var at = runAt(drumChart.grooves, beat);
    var ref = at ? drumRuns[at.section] && drumRuns[at.section][at.run] : null;
    if (lastRun && lastRun !== ref) {
      lastRun.el.classList.remove("now");
      showRun(lastRun, 0);
    }
    if (ref) {
      ref.el.classList.add("now");
      showRun(ref, at.bar);
    }
    lastRun = ref;
  }

  function updateChordHighlight(readingBeat) {
    if (!chordLayout) return;
    var c = currentChord(chordData.chords, readingBeat);
    if (c === lastChord) return;
    if (lastChord >= 0 && chordEls[lastChord]) chordEls[lastChord].classList.remove("current");
    if (c >= 0 && chordEls[c]) chordEls[c].classList.add("current");
    lastChord = c;
  }

  /** A chord row: an optional section label and a line of bars. */
  function chordRowElement(row) {
    var wrap = document.createElement("div");
    wrap.className = "chord-bars-row";
    if (row.label) {
      var nameEl = document.createElement("div");
      nameEl.className = "section-name";
      nameEl.textContent = row.label;
      wrap.appendChild(nameEl);
      sectionElements.push({ el: nameEl, beat: row.bars[0].startBeat });
    }
    // Four-bar lines, the same breaks e-ink uses.
    rowLines(row.bars).forEach(function (line) {
      var barsEl = document.createElement("div");
      barsEl.className = "chord-bars";
      // Each bar's share of the line is set by its beats; a short last line is
      // padded so its bars line up with the lines above.
      line.forEach(function (bar, k) {
        var barEl = document.createElement("div");
        barEl.className = "chord-bar" + (k === line.length - 1 ? " end" : "");
        var grid = barGrid(bar);
        barEl.style.flexGrow = String(bar.beats);
        barEl.style.gridTemplateColumns = "repeat(" + grid.columns + ", 1fr)";
        bar.chords.forEach(function (c, k) {
          var el = document.createElement("span");
          el.className = "chord";
          el.textContent = chordData.chords[c.chord].chord;
          el.style.gridColumnStart = String(grid.starts[k]);
          barEl.appendChild(el);
          chordEls[c.chord] = el;
        });
        barsEl.appendChild(barEl);
      });
      // A full line is four of the song's bars; pad a shorter one to that.
      var room = BARS_PER_LINE * countInBeatsPerBar - line.reduce(function (sum, bar) { return sum + bar.beats; }, 0);
      if (room > 0) {
        var pad = document.createElement("div");
        pad.className = "chord-bar-pad";
        pad.style.flexGrow = String(room);
        barsEl.appendChild(pad);
      }
      wrap.appendChild(barsEl);
    });
    return wrap;
  }

  // ── Bundle-mode clock: drive from <audio id="mix-audio"> ──
  function startAudioClock() {
    const audio = document.getElementById("mix-audio");
    if (!audio) {
      statusEl.textContent = "No <audio id=\"mix-audio\"> element found";
      statusEl.className = "disconnected";
      return;
    }
    statusEl.textContent = "Bundle mode";
    statusEl.className = "connected";
    audio.addEventListener("play",  function () { transportLight.className = "playing"; });
    audio.addEventListener("pause", function () { transportLight.className = "stopped"; });
    audio.addEventListener("ended", function () { transportLight.className = "stopped"; });

    setupBundleControls(audio);

    function tick() {
      if (song && !audio.seeking) {
        // Only act on a SETTLED clock. While a seek is in flight, currentTime
        // reads its stale pre-seek value, which would (a) fire a second wrap
        // (double click) and (b) emit a beat that flickers the highlight back
        // to the section's last line before the seek lands at the start.
        //
        // Keep playback inside the loop: wrap at the end (a scrub earlier is
        // left alone so a manual lead-in works). Setting currentTime starts the
        // seek, so we skip the emit this frame and resume once it settles.
        var wrapTo = loop ? loopWrapTarget(audio.currentTime, loop.startTime, loop.endTime) : null;
        if (wrapTo !== null) {
          audio.currentTime = wrapTo;
        } else {
          clock.emit(beatFromSeconds(audio.currentTime || 0));
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Loop + slow-down controls, shown only in bundle mode (they act on the
  // <audio> element; live/OSC mode has no such clock to steer).
  function setupBundleControls(audio) {
    if (!bundleControls) return;
    bundleControls.hidden = false;

    // Mix variant (full / minus-<part> / click only): the bundle inlines one
    // <option> per rendered file. Every variant is the same render length, so
    // section loops carry over; playback restarts from the top on a switch.
    var variantSel = document.getElementById("mix-variant");
    if (variantSel) {
      variantSel.addEventListener("change", function () {
        var wasPlaying = !audio.paused;
        audio.src = variantSel.value;
        audio.load();
        audio.currentTime = 0;
        if (wasPlaying) audio.play().catch(function () {});
      });
    }
    var sections = (isLD && song.display && song.display.sections) || [];

    // "from" gets Off + every section; "to" gets every section (instrumentals
    // included — loop a solo, or a contiguous run like Verse → Chorus).
    sections.forEach(function (s, i) {
      var a = document.createElement("option");
      a.value = String(i); a.textContent = s.name; loopFrom.appendChild(a);
      var b = document.createElement("option");
      b.value = String(i); b.textContent = s.name; loopTo.appendChild(b);
    });

    // Apply the current from/to selection. Clamps to a valid contiguous range
    // (to >= from), seeks to the range start, and plays.
    function applyLoop() {
      var from = parseInt(loopFrom.value, 10);
      if (from < 0 || !curve || !sections.length) { loop = null; return; }
      var to = parseInt(loopTo.value, 10);
      if (isNaN(to) || to < from) { to = from; loopTo.value = String(to); }
      var dur = isFinite(audio.duration) ? audio.duration : Infinity;
      var b = sectionLoopBounds(sections, from, to, function (beat) { return curve.toTime(beat); }, dur);
      loop = { startTime: b.startTime, endTime: b.endTime };
      audio.currentTime = b.startTime;
      if (audio.paused) audio.play().catch(function () {});
    }

    // Set the range explicitly (used by section-name clicks).
    function setLoopRange(from, to) {
      loopFrom.value = String(from);
      loopTo.value = String(to < from ? from : to);
      applyLoop();
    }

    loopFrom.addEventListener("change", applyLoop);
    loopTo.addEventListener("change", applyLoop);

    // Click a rendered section name to loop just it; shift-click a second one to
    // extend the range to there (a discoverable alternative to the dropdowns —
    // only lyric sections get a header, so the dropdowns still cover instrumentals).
    container.addEventListener("click", function (e) {
      var el = e.target.closest && e.target.closest(".section-name");
      if (!el) return;
      var idx = sections.findIndex(function (s) { return s.name === el.textContent; });
      if (idx < 0) return;
      var from = parseInt(loopFrom.value, 10);
      if (e.shiftKey && from >= 0) {
        setLoopRange(Math.min(from, idx), Math.max(from, idx));
      } else {
        setLoopRange(idx, idx);
      }
    });

    function applySpeed(v) {
      audio.playbackRate = v;
      audio.preservesPitch = true;
      audio.mozPreservesPitch = true;
      audio.webkitPreservesPitch = true;
      speedValue.textContent = Math.round(v * 100) + "%";
    }
    speedSlider.addEventListener("input", function () { applySpeed(parseFloat(this.value)); });
    applySpeed(parseFloat(speedSlider.value));
  }

  // ── Render: dispatch on format ──
  function renderSong() {
    isLD = song.schema === "clickbait/lyrics-display@1";
    curve = isLD && song.curve ? new Curve(song.curve) : null;

    titleEl.textContent = song.title;
    nowSectionEl.textContent = "";
    barBeatEl.textContent = "–";
    countInBeatsPerBar = (song.timeSignature && song.timeSignature[0]) || 4;
    if (isLD) {
      metered = sectionMeters(song);
      sectionNames = song.display.sections.map(function (s) { return s.name; });
    } else {
      metered = (song.sections || []).map(function (s) {
        return { startBeat: s.beat, bars: s.durationBeats / countInBeatsPerBar, beatsPerBar: countInBeatsPerBar };
      });
      sectionNames = (song.sections || []).map(function (s) { return s.name; });
    }
    renderSongMap();
    const parts = [];
    if (song.artist) parts.push(song.artist);
    if (song.key) parts.push("Key: " + song.key);
    parts.push(song.bpm + " BPM");
    metaEl.textContent = parts.join(" · ");
    document.title = song.title + " — clickbAIt: One Simple Track";

    container.innerHTML = "";
    sectionElements = [];
    lyricElements = [];
    wordElements = [];
    chordEls = [];
    rowEls = [];
    lastChord = -1;
    chordLayout = null;
    chordInput = null;
    if (isLD && chordsOn && chordData) {
      // Without lyrics there are no words to hang chords on, so every chord
      // goes into bar rows: a chart, a labeled row per section.
      chordInput = {
        sections: chordData.sections,
        words: lyricsOn ? song.words : [],
        lines: lyricsOn ? song.display.lines : [],
        chords: chordData.chords,
      };
      chordLayout = layoutChords(chordInput);
    }

    container.classList.toggle("chords-on", !!chordLayout);
    if (isLD && drumsOn && drumChart) renderDrumChart();
    if (isLD) renderLyricsDisplay();
    else renderLegacy();

    // New song: jump back to the top and clear the beat position. Otherwise the
    // page lingers at the previous song's scroll/highlight (often the very end)
    // until the next OSC beat arrives — and if REAPER is stopped, none does.
    rawBeat = -1;
    currentBeat = -1;
    scrollTarget = 0;
    window.scrollTo(0, 0);
  }

  // ── LyricsDisplay renderer: words grouped into lines + sections ──
  function renderLyricsDisplay() {
    const words = song.words;
    const lines = lyricsOn ? song.display.lines : [];
    const sections = song.display.sections || [];
    if (!lyricsOn && !chordLayout) {
      // The drum chart already lists every section.
      if (drumsOn && drumChart) return;
      // Neither lyrics nor chords: just the song's sections, to follow along.
      sections.forEach(function (s) {
        var nameEl = document.createElement("div");
        nameEl.className = "section-name";
        nameEl.textContent = s.name + (s.bars ? " · " + s.bars + (s.bars === 1 ? " bar" : " bars") : "");
        container.appendChild(nameEl);
        sectionElements.push({ el: nameEl, beat: s.startBeat });
      });
      return;
    }
    let lastSection = null;
    const rows = chordLayout ? chordLayout.rows : [];
    function appendRowsBefore(li) {
      rows.forEach(function (row, ri) {
        if (row.beforeLine !== li) return;
        var el = chordRowElement(row);
        rowEls[ri] = el;
        container.appendChild(el);
        // A labeled row names its section, so a line after it in the same
        // section shouldn't repeat the header.
        if (row.label) lastSection = row.label;
      });
    }

    lines.forEach(function (line, li) {
      appendRowsBefore(li);
      // Section header when the line's section changes.
      if (line.section && line.section !== lastSection) {
        var nameEl = document.createElement("div");
        nameEl.className = "section-name";
        nameEl.textContent = line.section;
        container.appendChild(nameEl);
        var secInfo = sections.find(function (s) { return s.name === line.section; });
        sectionElements.push({ el: nameEl, beat: secInfo ? secInfo.startBeat : 0 });
        lastSection = line.section;
      }

      var lineEl = document.createElement("div");
      lineEl.className = "lyric-line";
      if (line.tag) lineEl.dataset.tag = line.tag;

      var first = words[line.words[0]];
      lineEl.dataset.beat = first ? first.startBeat : 0;

      for (var i = line.words[0]; i <= line.words[1] && i < words.length; i++) {
        var w = words[i];
        var span = document.createElement("span");
        span.className = "word";
        if (chordLayout) {
          // Every word gets a chord slot above it, empty or not, so all the
          // text in a line sits at the same height under a row of chords.
          var ci = chordLayout.overWord[i];
          var chordEl = document.createElement("span");
          chordEl.className = "chord";
          if (ci !== undefined) {
            chordEl.textContent = chordData.chords[ci].chord;
            chordEls[ci] = chordEl;
          } else {
            chordEl.textContent = "\u00a0";
          }
          span.appendChild(chordEl);
          span.appendChild(document.createTextNode(w.text));
        } else {
          span.textContent = w.text;
        }
        lineEl.appendChild(span);
        lineEl.appendChild(document.createTextNode(" "));
        wordElements.push({ el: span, startBeat: w.startBeat, endBeat: w.endBeat, lineEl: lineEl });
      }

      container.appendChild(lineEl);
    });
    appendRowsBefore(lines.length);
  }

  // ── Legacy renderer (line-level SongPayload) ──
  function renderLegacy() {
    song.sections.forEach(function (section, sIdx) {
      var sectionDiv = document.createElement("div");
      sectionDiv.className = "section";
      sectionDiv.dataset.beat = section.beat;

      var nameEl = document.createElement("div");
      nameEl.className = "section-name";
      nameEl.textContent = section.name;
      sectionDiv.appendChild(nameEl);

      var items = [];
      (section.chords || []).forEach(function (c) { items.push({ beat: c.beat, type: "chord", text: c.chord }); });
      (section.lyrics || []).forEach(function (l) { items.push({ beat: l.beat, type: "lyric", text: l.text, tag: l.tag }); });
      items.sort(function (a, b) { return a.beat - b.beat; });

      var beatGroups = [];
      var lastBeat = null;
      items.forEach(function (item) {
        if (item.beat !== lastBeat) { beatGroups.push({ beat: item.beat, chords: [], lyrics: [] }); lastBeat = item.beat; }
        var group = beatGroups[beatGroups.length - 1];
        if (item.type === "chord") group.chords.push(item); else group.lyrics.push(item);
      });

      beatGroups.forEach(function (group) {
        if (group.chords.length > 0) {
          var chordRow = document.createElement("div");
          chordRow.className = "chord-row";
          chordRow.textContent = group.chords.map(function (c) { return c.text; }).join("  ");
          sectionDiv.appendChild(chordRow);
        }
        group.lyrics.forEach(function (l) {
          var lineEl = document.createElement("div");
          lineEl.className = "lyric-line";
          lineEl.textContent = l.text;
          lineEl.dataset.beat = l.beat;
          sectionDiv.appendChild(lineEl);
          lyricElements.push({ el: lineEl, beat: l.beat, sectionIdx: sIdx });
        });
      });

      container.appendChild(sectionDiv);
      sectionElements.push({ el: sectionDiv, beat: section.beat, sectionIdx: sIdx });
    });
  }

  // ── Show state (bail / vamp), pushed by the relay ──
  //
  // The display's precision should track the system's confidence. While
  // following, it highlights the current word. The moment someone bails, the
  // band is free-running and any word-level claim is the track's opinion rather
  // than the room's — so the body gets a mode class and the CSS lights the
  // whole section instead of pointing at a line that may be wrong.
  function applyShowState(state) {
    if (!state || !state.mode) return;
    document.body.classList.remove(
      "show-following", "show-out", "show-vamping", "show-leaving", "show-stopped",
    );
    document.body.classList.add("show-" + state.mode);
  }

  // ── WebSocket ──
  function connectWebSocket() {
    var protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host);
    ws.onopen = function () {
      statusEl.textContent = "Connected";
      statusEl.className = "connected";
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    };
    ws.onmessage = function (event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.type === "position") clock.emit(msg.beat);
      else if (msg.type === "stop") transportLight.className = "stopped";
      else if (msg.type === "play") transportLight.className = "playing";
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
    var readingBeat = beat + offsetBeats;
    currentBeat = readingBeat;
    // What's playing now (not the reading position): section, bar and beat.
    var pos = songPosition(metered, beat, countInBeatsPerBar);
    updateSongMap(beat);
    nowSectionEl.textContent = " : " + (pos.section >= 0 ? sectionNames[pos.section] : "Count-in");
    // Bar out of the section's bars, so the reader sees how far through it is.
    barBeatEl.textContent = pos.section >= 0
      ? "(" + pos.bar + " : " + pos.beat + ") of " + metered[pos.section].bars
      : "(" + pos.bar + " : " + pos.beat + ")";
    beatDisplay.textContent = "m" + pos.measure + ":" + pos.beat;

    if (isLD) updateWordHighlight(readingBeat);
    else updateHighlightLegacy(beat, readingBeat);
    updateChordHighlight(readingBeat);
    updateDrumHighlight(beat);

    if (autoScroll) scrollToCurrentLine(readingBeat);
  }

  // LyricsDisplay word highlight. The bright ("active") word lights at its start
  // and RELEASES when it's done, so the last word before a solo/rest doesn't
  // stay lit through the gap. Release at min(next word start, start + clamped
  // duration + grace): mid-phrase the next word wins (smooth karaoke, held notes
  // stay lit); before a gap the clamped hold wins. CTC endBeats can be bogus-
  // stretched into the following silence (that's the very lingering we're
  // fixing), so the duration is clamped to a sane 1–3 beats. Words already
  // started still read as "sung", and the last line stays "current" for context.
  var HOLD_MIN = 1, HOLD_MAX = 3, HOLD_GRACE = 0.5;
  function updateWordHighlight(readingBeat) {
    var i = activeIndex(wordElements, readingBeat, function (w) { return w.startBeat; });
    var active = i;
    if (i >= 0) {
      var w = wordElements[i];
      var nextStart = i + 1 < wordElements.length ? wordElements[i + 1].startBeat : Infinity;
      var dur = Math.min(HOLD_MAX, Math.max(HOLD_MIN, (w.endBeat || w.startBeat) - w.startBeat));
      var releaseAt = Math.min(nextStart, w.startBeat + dur + HOLD_GRACE);
      if (readingBeat >= releaseAt) active = -1; // word done — drop the bright highlight
    }
    var activeLine = i >= 0 ? wordElements[i].lineEl : null;
    wordElements.forEach(function (item, idx) {
      item.el.classList.toggle("active", idx === active);
      item.el.classList.toggle("sung", idx <= i && idx !== active);
      item.lineEl.classList.toggle("current", item.lineEl === activeLine);
    });
  }

  // Legacy line-level highlight.
  function updateHighlightLegacy(nowBeat, readingBeat) {
    var beatOf = function (l) { return l.beat; };
    var nowIdx = activeIndex(lyricElements, nowBeat, beatOf);
    var readIdx = activeIndex(lyricElements, readingBeat, beatOf);
    lyricElements.forEach(function (item, idx) {
      item.el.classList.remove("reading", "now", "past");
      if (idx === readIdx) item.el.classList.add("reading");
      else if (idx === nowIdx && nowIdx !== readIdx) item.el.classList.add("now");
      else if (idx < nowIdx) item.el.classList.add("past");
    });
  }

  // ── Scroll ──
  var scrollTarget = 0;
  var scrolling = false;
  function animateScroll() {
    // Manual mode lets the reader scroll: stop pulling toward the last target.
    if (!autoScroll) { scrolling = false; return; }
    var current = window.scrollY;
    var diff = scrollTarget - current;
    if (Math.abs(diff) < 1) { scrolling = false; return; }
    window.scrollTo(0, current + diff * 0.1);
    requestAnimationFrame(animateScroll);
  }

  function scrollToCurrentLine(beat) {
    var target = null;
    // While a chord row plays and nothing has been sung since, follow the row.
    var follow = chordLayout ? followTarget(chordLayout, chordInput, beat) : null;
    if (follow && "row" in follow) target = rowEls[follow.row] || null;
    // A drum chart without lyrics follows its current section.
    if (!target && drumsOn && !lyricsOn && drumChart && drumSectionEls.length) {
      var dr = runAt(drumChart.grooves, beat);
      if (dr) target = drumSectionEls[dr.section] || null;
    }
    if (!target && isLD) {
      var wi = activeIndex(wordElements, beat, function (w) { return w.startBeat; });
      if (wi >= 0) target = wordElements[wi].lineEl;
    } else if (!target) {
      var li = activeIndex(lyricElements, beat, function (l) { return l.beat; });
      if (li >= 0) target = lyricElements[li].el;
    }
    if (!target) {
      var si = activeIndex(sectionElements, beat, function (s) { return s.beat; });
      if (si >= 0) target = sectionElements[si].el;
    }
    if (target) {
      var rect = target.getBoundingClientRect();
      scrollTarget = window.scrollY + rect.top - window.innerHeight * 0.4;
      if (!scrolling) { scrolling = true; requestAnimationFrame(animateScroll); }
    }
  }

  // ── Channels in the drawer ──
  // One drawer section per channel the song offers: a show/hide switch for
  // the optional ones and a size, remembered per screen. A new channel (tab,
  // staff, …) adds an entry here with the CSS variable its rows use. `also`
  // sets variables that follow the size (section labels belong to the lyrics).
  var CHANNELS = [
    {
      // Not a channel: always shown, so it has a size but no switch.
      channel: "header", label: "Header", cssVar: "--header-size", also: [],
      min: 0.8, max: 3, step: 0.05, size: 1.2,
      fixed: true,
      isOn: function () { return true; },
    },
    {
      channel: "lyrics", label: "Lyrics", cssVar: "--lyric-size", also: [{ cssVar: "--section-size", scale: 0.5 }],
      min: 0.75, max: 3, step: 0.125, size: 1.5,
      isOn: function () { return lyricsOn; },
      setOn: setLyricsOn,
    },
    {
      channel: "drums", label: "Drums", cssVar: "--drum-size", also: [{ cssVar: "--drum-zoom", scale: 1 / 1.2, unitless: true }],
      min: 0.6, max: 2.5, step: 0.05, size: 1.2,
      available: function () { return !!drumChart; },
      isOn: function () { return drumsOn; },
      setOn: setDrumsOn,
    },
    {
      channel: "chords", label: "Chords", cssVar: "--chord-size", also: [],
      min: 0.5, max: 2.25, step: 0.0625, size: 0.9,
      available: function () { return !!chordData; },
      isOn: function () { return chordsOn; },
      setOn: setChordsOn,
    },
  ];

  function sizeKey(c) { return "clickbait.size." + c.channel; }

  var currentSizes = {};

  function savedSize(c) {
    if (urlOptions.sizes[c.channel] !== undefined) return Math.min(c.max, Math.max(c.min, urlOptions.sizes[c.channel]));
    var saved = null;
    try { saved = localStorage.getItem(sizeKey(c)); } catch (e) { /* private window */ }
    var v = saved === null ? NaN : parseFloat(saved);
    // Clamped, so a size saved under an older, wider range still fits.
    return isNaN(v) ? c.size : Math.min(c.max, Math.max(c.min, v));
  }

  function applySize(c, v) {
    var root = document.documentElement;
    currentSizes[c.channel] = v;
    root.style.setProperty(c.cssVar, v + "rem");
    c.also.forEach(function (a) { root.style.setProperty(a.cssVar, v * a.scale + (a.unitless ? "" : "rem")); });
  }

  /**
   * The drawer's channel part: a checkbox per channel the song offers, then a
   * settings section for each channel that's on.
   */
  function renderDrawerChannels() {
    if (!drawerChannels) return;
    drawerChannels.innerHTML = "";
    var offered = CHANNELS.filter(function (c) { return !c.available || c.available(); });
    var switchable = offered.filter(function (c) { return !c.fixed; });

    var list = document.createElement("section");
    list.className = "drawer-section";
    var listHead = document.createElement("h2");
    listHead.textContent = "Channels";
    list.appendChild(listHead);
    switchable.forEach(function (c) {
      var label = document.createElement("label");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = c.isOn();
      box.disabled = !c.setOn;
      if (c.setOn) {
        box.addEventListener("change", function () {
          c.setOn(box.checked);
          renderDrawerChannels();
        });
      }
      label.appendChild(document.createTextNode(c.label));
      label.appendChild(box);
      list.appendChild(label);
    });
    drawerChannels.appendChild(list);

    offered.forEach(function (c) {
      if (!c.isOn()) return;
      var section = document.createElement("section");
      section.className = "drawer-section";
      var h = document.createElement("h2");
      h.textContent = c.label;
      section.appendChild(h);
      var sizeLabel = document.createElement("label");
      var slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(c.min);
      slider.max = String(c.max);
      slider.step = String(c.step);
      slider.value = String(savedSize(c));
      slider.addEventListener("input", function () {
        applySize(c, parseFloat(slider.value));
        try { localStorage.setItem(sizeKey(c), slider.value); } catch (e) { /* private window */ }
        writeUrl();
      });
      sizeLabel.appendChild(document.createTextNode("Size"));
      sizeLabel.appendChild(slider);
      section.appendChild(sizeLabel);
      drawerChannels.appendChild(section);
    });
  }

  // ── Drawer ──
  function setDrawerOpen(open) {
    drawer.classList.toggle("open", open);
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
    drawerBtn.setAttribute("aria-expanded", open ? "true" : "false");
    drawerScrim.hidden = !open;
  }

  // ── Controls ──
  function setupControls() {
    offsetSlider.addEventListener("input", function () {
      offsetBeats = parseFloat(this.value);
      offsetValue.textContent = offsetBeats;
      if (rawBeat >= 0) onBeatUpdate(rawBeat);
      writeUrl();
    });
    if (urlOptions.offset !== undefined) {
      offsetSlider.value = String(urlOptions.offset);
      offsetBeats = parseFloat(offsetSlider.value);
      offsetValue.textContent = offsetBeats;
    }
    function showScrollMode() {
      scrollModeBtn.classList.toggle("active", autoScroll);
      scrollModeBtn.textContent = autoScroll ? "Auto" : "Manual";
    }
    autoScroll = urlOptions.scroll !== "manual";
    showScrollMode();
    scrollModeBtn.addEventListener("click", function () {
      autoScroll = !autoScroll;
      showScrollMode();
      writeUrl();
    });
    if (urlOptions.theme === "light") {
      document.body.classList.add("light");
      darkModeBtn.textContent = "☀️";
    }
    CHANNELS.forEach(function (c) { applySize(c, savedSize(c)); });
    renderDrawerChannels();
    drawerBtn.addEventListener("click", function () { setDrawerOpen(!drawer.classList.contains("open")); });
    document.getElementById("drawer-close").addEventListener("click", function () { setDrawerOpen(false); });
    drawerScrim.addEventListener("click", function () { setDrawerOpen(false); });
    darkModeBtn.addEventListener("click", function () {
      document.body.classList.toggle("light");
      this.textContent = document.body.classList.contains("light") ? "☀️" : "🌙";
      writeUrl();
      // Notation is drawn in the theme's ink, so redraw it in the new one.
      if (drumsOn && drumChart) {
        var beat = rawBeat;
        renderSong();
        if (beat >= 0) onBeatUpdate(beat);
      }
    });
    // The picker's Custom choice opens the page with the settings out.
    if (new URLSearchParams(location.search).get("settings") === "open") setDrawerOpen(true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setDrawerOpen(false);
      if (e.key === "ArrowUp") { offsetSlider.value = parseFloat(offsetSlider.value) + 0.5; offsetSlider.dispatchEvent(new Event("input")); }
      if (e.key === "ArrowDown") { offsetSlider.value = parseFloat(offsetSlider.value) - 0.5; offsetSlider.dispatchEvent(new Event("input")); }
    });
  }

  init();
})();
