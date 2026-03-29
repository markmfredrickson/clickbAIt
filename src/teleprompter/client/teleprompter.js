/**
 * clickbAIt Teleprompter — browser client
 *
 * Fetches the full song on load, connects to the relay WebSocket,
 * and highlights/scrolls lyrics based on incoming beat position.
 */

(function () {
  "use strict";

  // ── State ──
  let song = null;
  let ws = null;
  let autoScroll = true;
  let offsetBeats = 0;
  let currentBeat = -1;
  let sectionElements = [];
  let lyricElements = [];  // flat list of { el, beat, sectionIdx }
  let reconnectTimer = null;

  // ── DOM refs ──
  const titleEl = document.getElementById("song-title");
  const metaEl = document.getElementById("song-meta");
  const container = document.getElementById("lyrics-container");
  const statusEl = document.getElementById("connection-status");
  const beatDisplay = document.getElementById("beat-display");
  const offsetSlider = document.getElementById("offset-slider");
  const offsetValue = document.getElementById("offset-value");
  const scrollModeBtn = document.getElementById("scroll-mode-btn");
  const darkModeBtn = document.getElementById("dark-mode-btn");
  const transportLight = document.getElementById("transport-light");

  // ── Init ──
  async function loadSong() {
    try {
      var res = await fetch("/song.json");
      if (!res.ok) {
        statusEl.textContent = "Waiting for song…";
        return;
      }
      song = await res.json();
      renderSong();
    } catch (e) {
      statusEl.textContent = "Failed to load song";
      statusEl.className = "disconnected";
    }
  }

  async function init() {
    await loadSong();
    connectWebSocket();
    setupControls();
  }

  // ── Render full song ──
  function renderSong() {
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

    song.sections.forEach(function (section, sIdx) {
      var sectionDiv = document.createElement("div");
      sectionDiv.className = "section";
      sectionDiv.dataset.beat = section.beat;

      var nameEl = document.createElement("div");
      nameEl.className = "section-name";
      nameEl.textContent = section.name;
      sectionDiv.appendChild(nameEl);

      // Interleave chords and lyrics by beat position
      var items = [];
      section.chords.forEach(function (c) {
        items.push({ beat: c.beat, type: "chord", text: c.chord });
      });
      section.lyrics.forEach(function (l) {
        items.push({ beat: l.beat, type: "lyric", text: l.text, tag: l.tag });
      });
      items.sort(function (a, b) { return a.beat - b.beat; });

      // Group items at the same beat into chord+lyric pairs
      var beatGroups = [];
      var lastBeat = null;
      items.forEach(function (item) {
        if (item.beat !== lastBeat) {
          beatGroups.push({ beat: item.beat, chords: [], lyrics: [] });
          lastBeat = item.beat;
        }
        var group = beatGroups[beatGroups.length - 1];
        if (item.type === "chord") group.chords.push(item);
        else group.lyrics.push(item);
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
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = function (event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.type === "position") {
        onBeatUpdate(msg.beat);
      } else if (msg.type === "stop") {
        transportLight.className = "stopped";
      } else if (msg.type === "play") {
        transportLight.className = "playing";
      } else if (msg.type === "song-changed") {
        loadSong();
      }
    };

    ws.onclose = function () {
      statusEl.textContent = "Disconnected — retrying…";
      statusEl.className = "disconnected";
      reconnectTimer = setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = function () {
      ws.close();
    };
  }

  // ── Beat update ──
  function onBeatUpdate(beat) {
    var effectiveBeat = beat + offsetBeats;
    currentBeat = effectiveBeat;
    beatDisplay.textContent = "Beat: " + Math.round(beat * 10) / 10;

    updateHighlight(effectiveBeat);

    if (autoScroll) {
      scrollToCurrentLine(effectiveBeat);
    }
  }

  function updateHighlight(beat) {
    var activeIdx = -1;

    for (var i = lyricElements.length - 1; i >= 0; i--) {
      if (beat >= lyricElements[i].beat) {
        activeIdx = i;
        break;
      }
    }

    lyricElements.forEach(function (item, idx) {
      item.el.classList.remove("active", "past");
      if (idx === activeIdx) {
        item.el.classList.add("active");
      } else if (idx < activeIdx) {
        item.el.classList.add("past");
      }
    });
  }

  var scrollTarget = 0;
  var scrolling = false;

  function animateScroll() {
    var current = window.scrollY;
    var diff = scrollTarget - current;
    if (Math.abs(diff) < 1) {
      scrolling = false;
      return;
    }
    // Ease toward target — 10% per frame for smooth but responsive motion
    window.scrollTo(0, current + diff * 0.1);
    requestAnimationFrame(animateScroll);
  }

  function scrollToCurrentLine(beat) {
    var target = null;
    for (var i = lyricElements.length - 1; i >= 0; i--) {
      if (beat >= lyricElements[i].beat) {
        target = lyricElements[i].el;
        break;
      }
    }

    if (!target) {
      for (var j = sectionElements.length - 1; j >= 0; j--) {
        if (beat >= sectionElements[j].beat) {
          target = sectionElements[j].el;
          break;
        }
      }
    }

    if (target) {
      var rect = target.getBoundingClientRect();
      scrollTarget = window.scrollY + rect.top - window.innerHeight * 0.33;
      if (!scrolling) {
        scrolling = true;
        requestAnimationFrame(animateScroll);
      }
    }
  }

  // ── Controls ──
  function setupControls() {
    // Offset slider
    offsetSlider.addEventListener("input", function () {
      offsetBeats = parseFloat(this.value);
      offsetValue.textContent = offsetBeats > 0 ? "+" + offsetBeats : offsetBeats;
      if (currentBeat >= 0) onBeatUpdate(currentBeat - offsetBeats); // re-apply
    });

    // Auto-scroll toggle
    scrollModeBtn.classList.add("active");
    scrollModeBtn.addEventListener("click", function () {
      autoScroll = !autoScroll;
      this.classList.toggle("active", autoScroll);
      this.textContent = autoScroll ? "Auto" : "Manual";
    });

    // Dark/light mode
    darkModeBtn.addEventListener("click", function () {
      document.body.classList.toggle("light");
      this.textContent = document.body.classList.contains("light") ? "☀️" : "🌙";
    });

    // Keyboard shortcuts — only arrow keys for offset, no accidental scroll toggle
    document.addEventListener("keydown", function (e) {
      if (e.key === "ArrowUp") {
        offsetSlider.value = parseFloat(offsetSlider.value) + 0.5;
        offsetSlider.dispatchEvent(new Event("input"));
      }
      if (e.key === "ArrowDown") {
        offsetSlider.value = parseFloat(offsetSlider.value) - 0.5;
        offsetSlider.dispatchEvent(new Event("input"));
      }
    });
  }

  // Go
  init();
})();
