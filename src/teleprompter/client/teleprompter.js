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

  // ── Curve (port of src/curve.ts:toBeat) ──
  // anchors: sorted [{t, b}], strictly increasing in both. Linear interp,
  // end-slope extrapolation. Constant-tempo songs have two anchors.
  function makeCurve(anchors) {
    const a = anchors;
    const last = a.length - 1;
    const leadBps = (a[1].b - a[0].b) / (a[1].t - a[0].t);
    const tailBps = (a[last].b - a[last - 1].b) / (a[last].t - a[last - 1].t);
    return {
      toBeat: function (t) {
        if (t <= a[0].t) return a[0].b + (t - a[0].t) * leadBps;
        if (t >= a[last].t) return a[last].b + (t - a[last].t) * tailBps;
        let lo = 0, hi = last;
        while (lo < hi - 1) { const m = (lo + hi) >> 1; if (a[m].t <= t) lo = m; else hi = m; }
        const slope = (a[lo + 1].b - a[lo].b) / (a[lo + 1].t - a[lo].t);
        return a[lo].b + (t - a[lo].t) * slope;
      },
      // Inverse (beat -> time), for section-loop bounds. Mirror of toBeat.
      toTime: function (b) {
        if (b <= a[0].b) return a[0].t + (b - a[0].b) / leadBps;
        if (b >= a[last].b) return a[last].t + (b - a[last].b) / tailBps;
        let lo = 0, hi = last;
        while (lo < hi - 1) { const m = (lo + hi) >> 1; if (a[m].b <= b) lo = m; else hi = m; }
        const slope = (a[lo + 1].b - a[lo].b) / (a[lo + 1].t - a[lo].t);
        return a[lo].t + (b - a[lo].b) / slope;
      },
    };
  }

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
  const loopSelect = document.getElementById("loop-select");
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
      if (song) {
        // Keep playback inside the loop (wrap at the end; a scrub earlier is
        // left alone so a manual lead-in works).
        if (loop && audio.currentTime >= loop.endTime) audio.currentTime = loop.startTime;
        clock.emit(beatFromSeconds(audio.currentTime || 0));
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

    // One loop option per section (instrumentals included — loop a solo).
    sections.forEach(function (s, i) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = s.name;
      loopSelect.appendChild(opt);
    });

    function setLoop(index) {
      loopSelect.value = String(index);
      if (index < 0 || !curve || !sections[index]) { loop = null; return; }
      var start = curve.toTime(sections[index].startBeat);
      var end = index + 1 < sections.length
        ? curve.toTime(sections[index + 1].startBeat)
        : (isFinite(audio.duration) ? audio.duration : Infinity);
      loop = { startTime: start, endTime: end };
      audio.currentTime = start;
      if (audio.paused) audio.play().catch(function () {});
    }

    loopSelect.addEventListener("change", function () { setLoop(parseInt(this.value, 10)); });

    // Click a rendered section name to loop it (a discoverable alternative to
    // the dropdown; only lyric sections get a header, so the dropdown still
    // covers instrumentals).
    container.addEventListener("click", function (e) {
      var el = e.target.closest && e.target.closest(".section-name");
      if (!el) return;
      var idx = sections.findIndex(function (s) { return s.name === el.textContent; });
      if (idx >= 0) setLoop(idx);
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
    curve = isLD && song.curve ? makeCurve(song.curve) : null;

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
    var active = -1;
    for (var i = wordElements.length - 1; i >= 0; i--) {
      if (readingBeat >= wordElements[i].startBeat) { active = i; break; }
    }
    var activeLine = active >= 0 ? wordElements[active].lineEl : null;
    wordElements.forEach(function (item, idx) {
      item.el.classList.toggle("active", idx === active);
      item.el.classList.toggle("sung", idx < active);
      item.lineEl.classList.toggle("current", item.lineEl === activeLine);
    });
  }

  // Legacy line-level highlight.
  function updateHighlightLegacy(nowBeat, readingBeat) {
    var nowIdx = -1;
    for (var i = lyricElements.length - 1; i >= 0; i--) { if (nowBeat >= lyricElements[i].beat) { nowIdx = i; break; } }
    var readIdx = -1;
    for (var j = lyricElements.length - 1; j >= 0; j--) { if (readingBeat >= lyricElements[j].beat) { readIdx = j; break; } }
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
      for (var i = wordElements.length - 1; i >= 0; i--) {
        if (beat >= wordElements[i].startBeat) { target = wordElements[i].lineEl; break; }
      }
    } else {
      for (var k = lyricElements.length - 1; k >= 0; k--) {
        if (beat >= lyricElements[k].beat) { target = lyricElements[k].el; break; }
      }
    }
    if (!target) {
      for (var j = sectionElements.length - 1; j >= 0; j--) {
        if (beat >= sectionElements[j].beat) { target = sectionElements[j].el; break; }
      }
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
