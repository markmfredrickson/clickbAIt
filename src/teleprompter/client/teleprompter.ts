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
  const offsetSlider = document.getElementById("offset-slider");
  const offsetValue = document.getElementById("offset-value");
  const scrollModeBtn = document.getElementById("scroll-mode-btn");
  const sizeSlider = document.getElementById("size-slider");
  const darkModeBtn = document.getElementById("dark-mode-btn");
  const transportLight = document.getElementById("transport-light");
  const bundleControls = document.getElementById("bundle-controls");
  const loopFrom = document.getElementById("loop-from");
  const loopTo = document.getElementById("loop-to");
  const speedSlider = document.getElementById("speed-slider");
  const speedValue = document.getElementById("speed-value");

  // Bundle-mode section loop: audio-time window we keep playback inside, or null.
  let loop = null;

  // ── Init ──
  function renderWaiting() {
    titleEl.textContent = "Waiting for song…";
    metaEl.textContent = "Start playback in REAPER, or load a region matching a song slug.";
    document.title = "clickbAIt: One Simple Track";
    container.innerHTML = '<div class="waiting-message">No song loaded yet.</div>';
    sectionElements = [];
    lyricElements = [];
    wordElements = [];
  }

  async function loadSong() {
    if (typeof window.__SONG_DATA__ === "object" && window.__SONG_DATA__) {
      song = window.__SONG_DATA__;
      renderSong();
      return;
    }
    try {
      var res = await fetch("song.json");
      if (!res.ok) { renderWaiting(); return; }
      song = await res.json();
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

    if (isLD) renderLyricsDisplay();
    else renderLegacy();
  }

  // ── LyricsDisplay renderer: words grouped into lines + sections ──
  function renderLyricsDisplay() {
    const words = song.words;
    const lines = song.display.lines;
    const sections = song.display.sections || [];
    let lastSection = null;

    lines.forEach(function (line) {
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
        span.textContent = w.text;
        lineEl.appendChild(span);
        lineEl.appendChild(document.createTextNode(" "));
        wordElements.push({ el: span, startBeat: w.startBeat, lineEl: lineEl });
      }

      container.appendChild(lineEl);
    });
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
    beatDisplay.textContent = "Beat: " + Math.round(beat * 10) / 10;

    if (isLD) updateWordHighlight(readingBeat);
    else updateHighlightLegacy(beat, readingBeat);

    if (autoScroll) scrollToCurrentLine(readingBeat);
  }

  // LyricsDisplay: a word is active from its start until the NEXT word's start
  // (CTC word ends are unreliable — see TODO). The active word lights; earlier
  // words read as sung; the active line is marked for context.
  function updateWordHighlight(readingBeat) {
    var active = activeIndex(wordElements, readingBeat, function (w) { return w.startBeat; });
    var activeLine = active >= 0 ? wordElements[active].lineEl : null;
    wordElements.forEach(function (item, idx) {
      item.el.classList.toggle("active", idx === active);
      item.el.classList.toggle("sung", idx < active);
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
    var current = window.scrollY;
    var diff = scrollTarget - current;
    if (Math.abs(diff) < 1) { scrolling = false; return; }
    window.scrollTo(0, current + diff * 0.1);
    requestAnimationFrame(animateScroll);
  }

  function scrollToCurrentLine(beat) {
    var target = null;
    if (isLD) {
      var wi = activeIndex(wordElements, beat, function (w) { return w.startBeat; });
      if (wi >= 0) target = wordElements[wi].lineEl;
    } else {
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

  // ── Controls ──
  function setupControls() {
    offsetSlider.addEventListener("input", function () {
      offsetBeats = parseFloat(this.value);
      offsetValue.textContent = offsetBeats;
      if (rawBeat >= 0) onBeatUpdate(rawBeat);
    });
    scrollModeBtn.classList.add("active");
    scrollModeBtn.addEventListener("click", function () {
      autoScroll = !autoScroll;
      this.classList.toggle("active", autoScroll);
      this.textContent = autoScroll ? "Auto" : "Manual";
    });
    sizeSlider.addEventListener("input", function () {
      var s = parseFloat(this.value);
      var root = document.documentElement;
      root.style.setProperty("--lyric-size", s + "rem");
      root.style.setProperty("--chord-size", (s * 0.6) + "rem");
      root.style.setProperty("--section-size", (s * 0.5) + "rem");
    });
    darkModeBtn.addEventListener("click", function () {
      document.body.classList.toggle("light");
      this.textContent = document.body.classList.contains("light") ? "☀️" : "🌙";
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "ArrowUp") { offsetSlider.value = parseFloat(offsetSlider.value) + 0.5; offsetSlider.dispatchEvent(new Event("input")); }
      if (e.key === "ArrowDown") { offsetSlider.value = parseFloat(offsetSlider.value) - 0.5; offsetSlider.dispatchEvent(new Event("input")); }
    });
  }

  init();
})();
