#!/usr/bin/env node

// src/generate.ts
import { writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from "fs";
import { execSync as execSync2 } from "child_process";
import { resolve as resolve2, dirname as dirname2 } from "path";

// src/build-rpp.ts
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { readFileSync } from "fs";

// src/linearize.ts
function durationBeats(d, ts) {
  if ("beats" in d) return d.beats;
  return d.bars * ts[0];
}
function walk(node, ctx, out) {
  switch (node.kind) {
    case "song": {
      const songCtx = {
        beatOffset: 0,
        bpm: node.bpm,
        timeSignature: node.timeSignature
      };
      out.push({ beat: 0, seconds: 0, type: "tempo", value: String(node.bpm) });
      out.push({ beat: 0, seconds: 0, type: "timesig", value: `${node.timeSignature[0]}/${node.timeSignature[1]}` });
      for (const child of node.children) {
        walk(child, songCtx, out);
      }
      break;
    }
    case "event": {
      const beat = ctx.beatOffset + (node.offset ?? 0);
      out.push({
        beat,
        seconds: 0,
        // filled in later
        type: node.type,
        value: node.value,
        tag: node.tag ?? ctx.tag
      });
      break;
    }
    case "span": {
      walkSpan(node, ctx, out);
      break;
    }
    case "sequence": {
      walkSequence(node, ctx, out);
      break;
    }
    case "audio": {
      const beat = ctx.beatOffset + (node.offset ?? 0);
      out.push({
        beat,
        seconds: 0,
        type: "audio",
        value: node.name,
        // track name
        file: node.file,
        soffs: node.soffs,
        beatsFile: node.beatsFile,
        smStride: node.smStride
      });
      break;
    }
  }
}
function walkSpan(node, ctx, out) {
  const beat = ctx.beatOffset + (node.offset ?? 0);
  const bpm = node.bpm ?? ctx.bpm;
  const ts = node.timeSignature ?? ctx.timeSignature;
  const tag = node.tag ?? ctx.tag;
  const bpmChanged = node.bpm !== void 0 && node.bpm !== ctx.bpm;
  const tsChanged = node.timeSignature !== void 0 && (node.timeSignature[0] !== ctx.timeSignature[0] || node.timeSignature[1] !== ctx.timeSignature[1]);
  if (bpmChanged) {
    out.push({ beat, seconds: 0, type: "tempo", value: String(bpm) });
  }
  if (tsChanged) {
    out.push({ beat, seconds: 0, type: "timesig", value: `${ts[0]}/${ts[1]}` });
  }
  const childCtx = { beatOffset: beat, bpm, timeSignature: ts, tag };
  if (node.children) {
    for (const child of node.children) {
      walk(child, childCtx, out);
    }
  }
  const dur = node.duration ? durationBeats(node.duration, ts) : 0;
  const endBeat = beat + dur;
  if (bpmChanged) {
    out.push({ beat: endBeat, seconds: 0, type: "tempo", value: String(ctx.bpm) });
  }
  if (tsChanged) {
    out.push({ beat: endBeat, seconds: 0, type: "timesig", value: `${ctx.timeSignature[0]}/${ctx.timeSignature[1]}` });
  }
}
function walkSequence(node, ctx, out) {
  const seqStart = ctx.beatOffset + (node.offset ?? 0);
  const bpm = node.bpm ?? ctx.bpm;
  const ts = node.timeSignature ?? ctx.timeSignature;
  const tag = node.tag ?? ctx.tag;
  let cursor = seqStart;
  for (const child of node.children ?? []) {
    const childCtx = { beatOffset: cursor, bpm, timeSignature: ts, tag };
    walk(child, childCtx, out);
    cursor += childDuration(child, ts);
  }
}
function childDuration(node, ts) {
  switch (node.kind) {
    case "event":
    case "audio":
      return 0;
    case "span":
    case "sequence": {
      const localTs = node.timeSignature ?? ts;
      if (node.duration) return durationBeats(node.duration, localTs);
      return 0;
    }
    case "song":
      return 0;
  }
}
function assignSeconds(events) {
  events.sort((a, b) => {
    if (a.beat !== b.beat) return a.beat - b.beat;
    const priority = (e) => e.type === "tempo" || e.type === "timesig" ? 0 : 1;
    return priority(a) - priority(b);
  });
  let currentBpm = 0;
  let currentBeat = 0;
  let currentSeconds = 0;
  for (const event of events) {
    if (event.beat > currentBeat && currentBpm > 0) {
      const deltaBeats = event.beat - currentBeat;
      currentSeconds += deltaBeats / currentBpm * 60;
      currentBeat = event.beat;
    }
    event.seconds = currentSeconds;
    if (event.type === "tempo") {
      currentBpm = Number(event.value);
    }
  }
}
function computePadding(events, ts) {
  const minBeat = Math.min(...events.map((e) => e.beat));
  if (minBeat >= 0) return 0;
  const beatsPerBar = ts[0];
  const barsNeeded = Math.ceil(Math.abs(minBeat) / beatsPerBar);
  return barsNeeded * beatsPerBar;
}
function linearize(root2, opts) {
  const events = [];
  walk(root2, { beatOffset: 0, bpm: root2.bpm, timeSignature: root2.timeSignature }, events);
  const computed = computePadding(events, root2.timeSignature);
  const shift = Math.max(computed, opts?.minPaddingBeats ?? 0);
  if (shift > 0) {
    for (const e of events) {
      e.beat += shift;
    }
    events.push({ beat: 0, seconds: 0, type: "tempo", value: String(root2.bpm) });
    events.push({ beat: 0, seconds: 0, type: "timesig", value: `${root2.timeSignature[0]}/${root2.timeSignature[1]}` });
  }
  dedupeMetaEvents(events);
  assignSeconds(events);
  if (opts?.withPadding) {
    return { events, paddingBeats: shift };
  }
  return events;
}
function dedupeMetaEvents(events) {
  const seen = /* @__PURE__ */ new Set();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "tempo" || e.type === "timesig") {
      const key = `${e.type}@${e.beat}:${e.value}`;
      if (seen.has(key)) {
        events.splice(i, 1);
      } else {
        seen.add(key);
      }
    }
  }
}

// src/sections.ts
function durationBeats2(d, ts) {
  if ("beats" in d) return d.beats;
  return d.bars * ts[0];
}
function childDuration2(node, ts) {
  if (node.kind === "event" || node.kind === "song") return 0;
  const localTs = node.timeSignature ?? ts;
  if (node.duration) return durationBeats2(node.duration, localTs);
  return 0;
}
function extractSections(song2) {
  const sections2 = [];
  const ctx = { beatOffset: 0, bpm: song2.bpm, timeSignature: song2.timeSignature };
  walkChildren(song2.children, ctx, sections2, true);
  return sections2;
}
function walkChildren(children, ctx, out, isSequence) {
  let cursor = ctx.beatOffset;
  for (const child of children) {
    const childCtx = { ...ctx, beatOffset: isSequence ? cursor : ctx.beatOffset };
    if (child.kind === "span") {
      const beat = childCtx.beatOffset + (child.offset ?? 0);
      const bpm = child.bpm ?? ctx.bpm;
      const ts = child.timeSignature ?? ctx.timeSignature;
      const dur = child.duration ? durationBeats2(child.duration, ts) : 0;
      if (child.name) {
        out.push({ name: child.name, beat, durationBeats: dur, timeSignature: ts, bpm, cue: child.cue });
      }
      if (child.children) {
        walkChildren(child.children, { beatOffset: beat, bpm, timeSignature: ts }, out, false);
      }
    } else if (child.kind === "sequence") {
      const seqBeat = childCtx.beatOffset + (child.offset ?? 0);
      const bpm = child.bpm ?? ctx.bpm;
      const ts = child.timeSignature ?? ctx.timeSignature;
      if (child.children) {
        walkChildren(child.children, { beatOffset: seqBeat, bpm, timeSignature: ts }, out, true);
      }
    }
    if (isSequence) {
      cursor += childDuration2(child, ctx.timeSignature);
    }
  }
}

// src/dsongl/slug.ts
function toSlug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function songSlug(song2) {
  const parts = [song2.title];
  if (song2.artist) parts.push(song2.artist);
  return toSlug(parts.join("-"));
}

// src/stretch-markers.ts
function beatsToStretchMarkers(beats, options) {
  if (beats.length < 2) return [];
  const { bpm } = options;
  const beatLen = 60 / bpm;
  const sourceAnchor = options.sourceAnchor ?? beats[0].time;
  const itemAnchor = options.itemAnchor ?? 0;
  const stride = options.stride ?? 1;
  const markers = [];
  for (let i = 0; i < beats.length; i += stride) {
    const sourcePos = beats[i].time;
    const beatNum = i;
    const itemPos = itemAnchor + beatNum * beatLen;
    markers.push({
      beat: beatNum,
      itemPosition: itemPos,
      sourcePosition: sourcePos
    });
  }
  return markers;
}
function formatStretchMarkers(markers, itemStartSource, itemStartProject) {
  const maxPairsPerLine = 34;
  const pairs = markers.map((m) => {
    const src = m.sourcePosition - itemStartSource;
    const item = m.itemPosition - itemStartProject;
    return `${item.toFixed(9)} ${src.toFixed(9)}`;
  });
  const lines = [];
  for (let i = 0; i < pairs.length; i += maxPairsPerLine) {
    const chunk = pairs.slice(i, i + maxPairsPerLine);
    lines.push(`SM ${chunk.join(" + ")}`);
  }
  return lines;
}

// src/build-rpp.ts
import { accessSync, constants } from "fs";
function findAudioBin() {
  const root2 = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const release = resolve(root2, "target", "release", "clickbait-audio");
  const debug = resolve(root2, "target", "debug", "clickbait-audio");
  try {
    accessSync(release, constants.X_OK);
    return release;
  } catch {
  }
  try {
    accessSync(debug, constants.X_OK);
    return debug;
  } catch {
  }
  throw new Error(`clickbait-audio not found. Run: cargo build --release -p clickbait-audio`);
}
var audioBin = findAudioBin();
function audioDuration(path) {
  const out = execSync(`"${audioBin}" duration "${path}"`, { encoding: "utf8" }).trim();
  const dur = parseFloat(out);
  if (isNaN(dur)) throw new Error(`Could not determine duration of ${path}`);
  return dur;
}
function fmtPos(n) {
  return n.toFixed(12);
}
function fmtBpm(n) {
  return n.toFixed(10);
}
function fmt(n) {
  return parseFloat(n.toFixed(6)).toString();
}
function rppStr(s) {
  return /[\s"{}]/.test(s) ? `"${s}"` : s;
}
function newGuid() {
  const raw = crypto.randomUUID().toUpperCase().replace(/-/g, "");
  return `{${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}}`;
}
function patternNum(beats) {
  let v = 0;
  for (let i = 0; i < beats - 1; i++) v = v << 2 | 2;
  return v << 2 | 1;
}
function patternStr(beats) {
  return "A" + "B".repeat(beats - 1);
}
function timesigFlags(beats) {
  return 262144 + beats;
}
function beatToSeconds(beat, tempoMap) {
  let seconds = 0;
  let prevBeat = 0;
  let prevBpm = tempoMap[0]?.bpm ?? 120;
  for (const tp of tempoMap) {
    if (tp.beat > beat) break;
    seconds += (tp.beat - prevBeat) / prevBpm * 60;
    prevBeat = tp.beat;
    prevBpm = tp.bpm;
  }
  seconds += (beat - prevBeat) / prevBpm * 60;
  return seconds;
}
function buildRpp(song2, opts) {
  const beatsPerBar = song2.timeSignature[0];
  const barSeconds = 60 / song2.bpm * beatsPerBar;
  const titleSlugName = song2.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
  const titleFile = `${opts.cueDir}/${titleSlugName}.wav`;
  const titleDur = audioDuration(titleFile);
  const slugBars = Math.max(4, Math.ceil(titleDur / barSeconds) + 1);
  const slugBeats2 = slugBars * beatsPerBar;
  const { events, paddingBeats } = linearize(song2, { withPadding: true, minPaddingBeats: slugBeats2 });
  const rawSections = extractSections(song2);
  const sections2 = rawSections.map((s) => ({ ...s, beat: s.beat + paddingBeats }));
  const tempoMap = [];
  const timesigMap = [];
  for (const e of events) {
    if (e.type === "tempo") {
      tempoMap.push({ beat: e.beat, bpm: Number(e.value) });
    } else if (e.type === "timesig") {
      const [num, den] = e.value.split("/").map(Number);
      timesigMap.push({ beat: e.beat, num, den });
    }
  }
  const masterBpm = tempoMap[0]?.bpm ?? song2.bpm;
  const masterTs = song2.timeSignature;
  const allChanges = [];
  for (const tp of tempoMap) allChanges.push({ beat: tp.beat, bpm: tp.bpm });
  for (const ts of timesigMap) allChanges.push({ beat: ts.beat, num: ts.num });
  allChanges.sort((a, b) => a.beat - b.beat);
  const tempoPoints = [];
  let currentBpm = masterBpm;
  let currentTs = masterTs[0];
  const byBeat = /* @__PURE__ */ new Map();
  for (const c of allChanges) {
    const existing = byBeat.get(c.beat) ?? { bpm: currentBpm, num: currentTs };
    if (c.bpm !== void 0) existing.bpm = c.bpm;
    if (c.num !== void 0) existing.num = c.num;
    byBeat.set(c.beat, existing);
    if (c.bpm !== void 0) currentBpm = c.bpm;
    if (c.num !== void 0) currentTs = c.num;
  }
  if (!byBeat.has(0)) {
    byBeat.set(0, { bpm: masterBpm, num: masterTs[0] });
  }
  let lastBpm = null;
  let lastTs = null;
  for (const [beat, { bpm, num }] of [...byBeat.entries()].sort((a, b) => a[0] - b[0])) {
    if (bpm !== lastBpm || num !== lastTs) {
      const sec = beatToSeconds(beat, tempoMap);
      const flags = timesigFlags(num);
      const pNum = patternNum(num);
      const pStr = patternStr(num);
      tempoPoints.push(
        `PT ${fmtPos(sec)} ${fmtBpm(bpm)} 1 ${flags} 0 1 0 "" 0 ${pNum} 0 ${pStr}`
      );
      lastBpm = bpm;
      lastTs = num;
    }
  }
  const regionLines = [];
  let regionId = 1;
  const slug2 = songSlug(song2);
  {
    const slugEndSec = beatToSeconds(slugBeats2, tempoMap);
    regionLines.push(
      `MARKER ${regionId} ${fmt(0)} ${rppStr(slug2)} 1 0 1 B ${newGuid()} 0 1`
    );
    regionLines.push(
      `MARKER ${regionId} ${fmt(slugEndSec)} "" 1`
    );
    regionId++;
  }
  for (const sec of sections2) {
    const startSec = beatToSeconds(sec.beat, tempoMap);
    const endSec = beatToSeconds(sec.beat + sec.durationBeats, tempoMap);
    regionLines.push(
      `MARKER ${regionId} ${fmt(startSec)} ${rppStr(sec.name)} 1 0 1 B ${newGuid()} 0 1`
    );
    regionLines.push(
      `MARKER ${regionId} ${fmt(endSec)} "" 1`
    );
    regionId++;
  }
  const trackItems = [];
  const cueNames2 = /* @__PURE__ */ new Set();
  cueNames2.add(song2.title);
  trackItems.push({ position: 0, length: titleDur, file: titleFile });
  let cueTrackFreeAfter = titleDur;
  for (const sec of sections2) {
    if (!sec.cue) continue;
    const beatsPerBar2 = sec.timeSignature[0];
    const cueBeat = sec.beat - beatsPerBar2 * 2;
    if (cueBeat < 0) continue;
    const cueSec = beatToSeconds(cueBeat, tempoMap);
    if (cueSec < cueTrackFreeAfter) continue;
    const cueSlug = sec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
    const file = `${opts.cueDir}/${cueSlug}.wav`;
    const dur = audioDuration(file);
    cueNames2.add(sec.name);
    trackItems.push({ position: cueSec, length: dur, file });
    cueTrackFreeAfter = cueSec + dur;
  }
  for (const e of events) {
    if (e.type === "cue") {
      const slug3 = e.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
      const file = `${opts.cueDir}/${slug3}.wav`;
      cueNames2.add(e.value);
      trackItems.push({ position: e.seconds, length: audioDuration(file), file });
    }
  }
  for (const sec of sections2.filter((s) => s.cue)) {
    const beatsPerBar2 = sec.timeSignature[0];
    const barStartBeat = sec.beat - beatsPerBar2;
    if (barStartBeat < 0) continue;
    for (let i = 0; i < beatsPerBar2; i++) {
      const beatPos = barStartBeat + i;
      const beatSec = beatToSeconds(beatPos, tempoMap);
      const file = `${opts.countDir}/${i + 1}.wav`;
      trackItems.push({ position: beatSec, length: audioDuration(file), file });
    }
  }
  const tempoEnvLines = [
    `EGUID ${newGuid()}`,
    "ACT 1 -1",
    "VIS 1 0 1",
    "LANEHEIGHT 0 0",
    "ARM 0",
    "DEFSHAPE 1 -1 -1",
    ...tempoPoints
  ].map((l) => "  " + l).join("\n");
  const rppLines = [];
  rppLines.push(`<REAPER_PROJECT 0.1 "7.65/macOS-arm64" 0 0`);
  rppLines.push(`  RIPPLE 0 0`);
  rppLines.push(`  AUTOXFADE 129`);
  rppLines.push(`  SAMPLERATE 44100 0 0`);
  rppLines.push(`  TEMPO ${fmt(masterBpm)} ${masterTs[0]} ${masterTs[1]} 0`);
  rppLines.push(`  PLAYRATE 1 0 0.25 4`);
  rppLines.push(`  TIMELOCKMODE 1`);
  rppLines.push(`  TEMPOENVLOCKMODE 1`);
  rppLines.push(`  ITEMMIX 1`);
  rppLines.push(`  LOOP 0`);
  rppLines.push(`  <METRONOME 6 2`);
  rppLines.push(`    VOL 0.25 0.125`);
  rppLines.push(`    BEATLEN 4`);
  rppLines.push(`    FREQ 1760 880 1`);
  rppLines.push(`    SAMPLES "" "" "" ""`);
  rppLines.push(`    PATTERN 0 ${patternNum(masterTs[0])}`);
  rppLines.push(`    PATTERNSTR ${patternStr(masterTs[0])}`);
  rppLines.push(`    MULT 1`);
  rppLines.push(`  >`);
  rppLines.push(`  <TEMPOENVEX`);
  rppLines.push(tempoEnvLines);
  rppLines.push(`  >`);
  rppLines.push(`  RULERHEIGHT 86 86`);
  rppLines.push(`  RULERLANE 1 4 "" 0 -1`);
  rppLines.push(`  RULERLANE 2 8 "" 0 -1`);
  for (const line of regionLines) {
    rppLines.push(`  ${line}`);
  }
  const clickItemContent = buildClickItem(song2, sections2, tempoMap, opts);
  rppLines.push(buildTrack("Click", 1, clickItemContent, {
    beat: -1,
    playoffs: "0 1",
    nchan: 2,
    mainsend: "1 0"
  }));
  rppLines.push(buildTrack("Cues & Counts", 0.8, buildWaveItems(trackItems), { beat: -1 }));
  const lastSection = sections2[sections2.length - 1];
  const projectEndSec = lastSection ? beatToSeconds(lastSection.beat + lastSection.durationBeats, tempoMap) : 0;
  const audioByTrack = /* @__PURE__ */ new Map();
  for (const e of events) {
    if (e.type === "audio") {
      const list = audioByTrack.get(e.value) ?? [];
      list.push(e);
      audioByTrack.set(e.value, list);
    }
  }
  const defaultSoffs = song2.preRollSeconds ?? 0;
  if (defaultSoffs > 0 && audioByTrack.size > 0) {
    let applied = 0;
    for (const evs of audioByTrack.values()) {
      for (const e of evs) if (e.soffs === void 0) applied++;
    }
    if (applied > 0) {
      console.error(`Applying preRollSeconds=${defaultSoffs}s as soffs to ${applied} audio item${applied === 1 ? "" : "s"}`);
    }
  }
  for (const [trackName, audioEvents] of audioByTrack) {
    const items = buildAudioFileItems(audioEvents, tempoMap, 1, projectEndSec, defaultSoffs);
    rppLines.push(buildTrack(trackName, 1, items, { beat: -1 }));
  }
  rppLines.push(`>`);
  return {
    rpp: rppLines.join("\n"),
    cueWavsNeeded: [...cueNames2],
    slugBeats: slugBeats2
  };
}
function buildClickItem(song2, sections2, tempoMap, opts) {
  const masterTs = song2.timeSignature;
  const masterBpm = tempoMap[0]?.bpm ?? song2.bpm;
  const lastSection = sections2[sections2.length - 1];
  const totalSeconds = lastSection ? beatToSeconds(lastSection.beat + lastSection.durationBeats, tempoMap) : 0;
  const accentFile = `${opts.clickDir}/accent.wav`;
  const beatFile = `${opts.clickDir}/beat.wav`;
  const lines = [];
  lines.push(`    <ITEM`);
  lines.push(`      POSITION 0`);
  lines.push(`      SNAPOFFS 0`);
  lines.push(`      LENGTH ${fmt(totalSeconds)}`);
  lines.push(`      LOOP 1`);
  lines.push(`      ALLTAKES 0`);
  lines.push(`      FADEIN 1 0 0 1 0 0 0`);
  lines.push(`      FADEOUT 1 0 0 1 0 0 0`);
  lines.push(`      MUTE 0 0`);
  lines.push(`      NAME "Click source"`);
  lines.push(`      VOLPAN 1 0 1 -1`);
  lines.push(`      SOFFS 0`);
  lines.push(`      PLAYRATE 1 1 0 -1 0 0.0025`);
  lines.push(`      CHANMODE 0`);
  lines.push(`      GUID ${newGuid()}`);
  lines.push(`      <SOURCE CLICK`);
  lines.push(`        AUTO 1 0`);
  lines.push(`        BPM ${fmt(masterBpm)}`);
  lines.push(`        BPI ${masterTs[0]} ${masterTs[1]}`);
  lines.push(`        VOL 0.5 0.25`);
  lines.push(`        BEATLEN 4`);
  lines.push(`        FREQ 1760 880 1`);
  lines.push(`        SAMPLES ${rppStr(accentFile)} ${rppStr(beatFile)} "" ""`);
  lines.push(`        SPLIGNORE 0 0`);
  lines.push(`        SPLDEF 2 660 "" 0 ""`);
  lines.push(`        SPLDEF 3 440 "" 0 ""`);
  lines.push(`        PATTERN 0 ${patternNum(masterTs[0])}`);
  lines.push(`        PATTERNSTR ${patternStr(masterTs[0])}`);
  lines.push(`        MULT 1`);
  lines.push(`      >`);
  lines.push(`    >`);
  return lines.join("\n");
}
function buildTrack(name, volume, itemContent, trackOpts) {
  const lines = [];
  lines.push(`  <TRACK ${newGuid()}`);
  lines.push(`    NAME ${rppStr(name)}`);
  if (trackOpts?.beat !== void 0) lines.push(`    BEAT ${trackOpts.beat}`);
  lines.push(`    VOLPAN ${fmt(volume)} 0 -1 -1 1`);
  lines.push(`    MUTESOLO 0 0 0`);
  lines.push(`    IPHASE 0`);
  if (trackOpts?.playoffs) lines.push(`    PLAYOFFS ${trackOpts.playoffs}`);
  lines.push(`    ISBUS 0 0`);
  lines.push(`    BUSCOMP 0 0 0 0 0`);
  lines.push(`    SHOWINMIX 1 0.6667 0.5 1 0.5 0 0 0`);
  lines.push(`    REC 0 0 1 0 0 0 0 0`);
  if (trackOpts?.nchan) lines.push(`    NCHAN ${trackOpts.nchan}`);
  lines.push(`    TRACKID ${newGuid()}`);
  if (trackOpts?.mainsend) lines.push(`    MAINSEND ${trackOpts.mainsend}`);
  lines.push(itemContent);
  lines.push(`  >`);
  return lines.join("\n");
}
function buildWaveItems(items) {
  const lines = [];
  for (const item of items) {
    lines.push(`    <ITEM`);
    lines.push(`      POSITION ${fmtPos(item.position)}`);
    lines.push(`      LENGTH ${fmtPos(item.length)}`);
    lines.push(`      MUTE 0 0`);
    lines.push(`      FADEIN 1 0 0 1 0 0 0`);
    lines.push(`      FADEOUT 1 0 0 1 0 0 0`);
    lines.push(`      VOLPAN 1 0 1 -1`);
    lines.push(`      SOFFS 0`);
    lines.push(`      PLAYRATE 1 1 0 -1 0 0.0025`);
    lines.push(`      CHANMODE 0`);
    lines.push(`      GUID ${newGuid()}`);
    lines.push(`      <SOURCE WAVE`);
    lines.push(`        FILE ${rppStr(item.file)}`);
    lines.push(`      >`);
    lines.push(`    >`);
  }
  return lines.join("\n");
}
function sourceType(file) {
  const ext = file.toLowerCase().split(".").pop();
  if (ext === "mp3") return "MP3";
  return "WAVE";
}
function buildAudioFileItems(audioEvents, tempoMap, groupId, projectEndSec, defaultSoffs) {
  const lines = [];
  for (const e of audioEvents) {
    const position = e.seconds;
    const soffs = e.soffs ?? defaultSoffs;
    const absFile = resolve(e.file);
    const srcType = sourceType(absFile);
    const totalDur = audioDuration(absFile);
    let length = totalDur - soffs;
    let smLines = [];
    if (e.beatsFile) {
      const bpm = tempoMap[0]?.bpm ?? 120;
      const beatsData = JSON.parse(readFileSync(e.beatsFile, "utf8"));
      const beats = beatsData.beats.filter((b) => b.time >= soffs);
      const markers = beatsToStretchMarkers(beats, {
        bpm,
        sourceAnchor: beats[0]?.time ?? soffs,
        itemAnchor: 0,
        stride: e.smStride
      });
      if (markers.length > 0) {
        smLines = formatStretchMarkers(markers, 0, 0);
        length = markers[markers.length - 1].itemPosition;
      }
    }
    if (projectEndSec !== void 0) {
      const maxLength = projectEndSec - position;
      if (maxLength > 0 && length > maxLength) {
        length = maxLength;
      }
    }
    lines.push(`    <ITEM`);
    lines.push(`      POSITION ${fmtPos(position)}`);
    lines.push(`      LENGTH ${fmtPos(length)}`);
    lines.push(`      LOOP 1`);
    lines.push(`      ALLTAKES 0`);
    lines.push(`      FADEIN 1 0 0 1 0 0 0`);
    lines.push(`      FADEOUT 1 0 0 1 0 0 0`);
    lines.push(`      MUTE 0 0`);
    if (groupId !== void 0) lines.push(`      GROUP ${groupId}`);
    lines.push(`      VOLPAN 1 0 1 -1`);
    lines.push(`      SOFFS ${fmtPos(soffs)}`);
    lines.push(`      PLAYRATE 1 1 0 -1 0 0.0025`);
    lines.push(`      CHANMODE 0`);
    lines.push(`      GUID ${newGuid()}`);
    for (const sm of smLines) {
      lines.push(`      ${sm}`);
    }
    lines.push(`      <SOURCE ${srcType}`);
    lines.push(`        FILE ${rppStr(absFile)} 1`);
    lines.push(`      >`);
    lines.push(`    >`);
  }
  return lines.join("\n");
}

// src/teleprompter/export.ts
function exportSongPayload(song2, opts = {}) {
  const { events } = linearize(song2, { withPadding: true, minPaddingBeats: opts.minPaddingBeats ?? 0 });
  const rawSections = extractSections(song2);
  const shift = opts.minPaddingBeats ?? 0;
  const sections2 = rawSections.map((s) => ({ ...s, beat: s.beat + shift }));
  const tempoMap = buildTempoMap(events);
  const exportedSections = sections2.map((sec, i) => {
    const nextBeat = i < sections2.length - 1 ? sections2[i + 1].beat : sec.beat + sec.durationBeats;
    const lyrics = [];
    const chords = [];
    for (const ev of events) {
      if (ev.beat < sec.beat || ev.beat >= nextBeat) continue;
      if (ev.type === "lyric") {
        lyrics.push({
          text: ev.value,
          beat: ev.beat,
          seconds: ev.seconds,
          tag: ev.tag
        });
      } else if (ev.type === "chord") {
        chords.push({
          chord: ev.value,
          beat: ev.beat,
          seconds: ev.seconds
        });
      }
    }
    return {
      name: sec.name,
      beat: sec.beat,
      seconds: beatsToSeconds(sec.beat, tempoMap),
      durationBeats: sec.durationBeats,
      durationSeconds: beatsToSeconds(sec.beat + sec.durationBeats, tempoMap) - beatsToSeconds(sec.beat, tempoMap),
      lyrics,
      chords
    };
  });
  const tempoPoints = tempoMap.map((t) => ({
    beat: t.beat,
    seconds: beatsToSeconds(t.beat, tempoMap),
    bpm: t.bpm
  }));
  return {
    title: song2.title,
    artist: song2.artist,
    key: song2.key,
    bpm: song2.bpm,
    slug: songSlug(song2),
    tempoMap: tempoPoints,
    sections: exportedSections
  };
}
function buildTempoMap(events) {
  return events.filter((e) => e.type === "tempo").map((e) => ({ beat: e.beat, bpm: Number(e.value) })).sort((a, b) => a.beat - b.beat);
}
function beatsToSeconds(beat, tempoMap) {
  let seconds = 0;
  let prevBeat = 0;
  let bpm = tempoMap[0]?.bpm ?? 120;
  for (const entry of tempoMap) {
    if (entry.beat >= beat) break;
    if (entry.beat > prevBeat) {
      seconds += (entry.beat - prevBeat) / bpm * 60;
      prevBeat = entry.beat;
    }
    bpm = entry.bpm;
  }
  seconds += (beat - prevBeat) / bpm * 60;
  return seconds;
}

// src/generate.ts
function checkBundleFreshness() {
  const selfPath = new URL(import.meta.url).pathname;
  if (!selfPath.includes("/bin/")) return;
  const repoRoot = resolve2(dirname2(selfPath), "..");
  const srcDir = resolve2(repoRoot, "src");
  if (!existsSync(srcDir)) return;
  const bundleMtime = statSync(selfPath).mtimeMs;
  let newestSrc = 0;
  const walk2 = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = resolve2(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk2(p);
      else if (p.endsWith(".ts")) newestSrc = Math.max(newestSrc, s.mtimeMs);
    }
  };
  walk2(srcDir);
  if (newestSrc > bundleMtime) {
    const ageMinutes = Math.round((newestSrc - bundleMtime) / 6e4);
    console.error(
      `
\u26A0 Bundle is ${ageMinutes}m older than src/. Rebuild with: node scripts/build.mjs
`
    );
  }
}
checkBundleFreshness();
var songPath = process.argv[2];
if (!songPath) {
  console.error("Usage: npx tsx src/generate.ts <song-file.ts> [output-dir]");
  process.exit(1);
}
var outDir = process.argv[3] ?? "/tmp/clickbait-output";
var cueDir = resolve2(outDir, "cues");
var assetsDir = resolve2(dirname2(new URL(import.meta.url).pathname), "..", "assets");
var countDir = resolve2(assetsDir, "counts");
var clickDir = resolve2(assetsDir, "clicks");
var songModule = await import(resolve2(songPath));
var song = songModule.default;
console.log(`Song: ${song.title} (${song.bpm} BPM, ${song.timeSignature.join("/")}${song.key ? `, ${song.key}` : ""})`);
mkdirSync(cueDir, { recursive: true });
var root = resolve2(dirname2(new URL(import.meta.url).pathname), "..");
var audioBin2 = existsSync(resolve2(root, "target", "release", "clickbait-audio")) ? resolve2(root, "target", "release", "clickbait-audio") : resolve2(root, "target", "debug", "clickbait-audio");
if (!existsSync(audioBin2)) {
  console.error(`Build the Rust binary first: cargo build --release`);
  process.exit(1);
}
function generateWav(text, wavPath) {
  if (existsSync(wavPath)) {
    console.log(`  "${text}" \u2192 ${wavPath.split("/").pop()} (cached)`);
    return;
  }
  console.log(`  "${text}" \u2192 ${wavPath.split("/").pop()}`);
  execSync2(`${audioBin2} speak "${text}" -o "${wavPath}"`, { stdio: "pipe" });
}
var sections = extractSections(song);
console.log(`
Sections: ${sections.map((s) => s.name).join(" \u2192 ")}`);
var allEvents = linearize(song);
var autoCueNames = sections.filter((s) => s.cue).map((s) => s.name);
var manualCueNames = allEvents.filter((e) => e.type === "cue").map((e) => e.value);
var cueNames = [.../* @__PURE__ */ new Set([song.title, ...autoCueNames, ...manualCueNames])];
var maxBeatsPerBar = Math.max(...sections.map((s) => s.timeSignature[0]), song.timeSignature[0]);
var countNames = Array.from({ length: maxBeatsPerBar }, (_, i) => String(i + 1));
console.log(`
Generating ${cueNames.length} cue WAVs + ${countNames.length} count WAVs...`);
for (const name of cueNames) {
  const slug2 = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
  generateWav(name, resolve2(cueDir, `${slug2}.wav`));
}
for (const num of countNames) {
  generateWav(num, resolve2(cueDir, `${num}.wav`));
}
console.log(`
Building RPP...`);
var { rpp, cueWavsNeeded, slugBeats } = buildRpp(song, {
  cueDir,
  countDir: cueDir,
  // counts are now generated alongside cues
  clickDir
});
var slug = songSlug(song);
var rppPath = resolve2(outDir, `${slug}.rpp`);
writeFileSync(rppPath, rpp);
var payload = exportSongPayload(song, { minPaddingBeats: slugBeats });
var jsonPath = resolve2(outDir, `${slug}.json`);
writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
console.log(`
Written: ${rppPath}`);
console.log(`Teleprompter: ${jsonPath}`);
console.log(`Cue WAVs: ${cueDir}/`);
console.log(`
Open in REAPER and hit play!`);
console.log(`Teleprompter: npx tsx scripts/teleprompter.ts --songs-dir ${outDir}`);
