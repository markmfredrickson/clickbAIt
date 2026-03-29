/**
 * Generate a REAPER project file from a Song tree.
 *
 * Produces:
 * - Tempo envelope from linearized tempo/timesig events
 * - Region markers for each section
 * - A "Cues & Counts" track with spoken section names (2 bars before)
 *   and beat numbers (1 bar before) each section
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import type { Song } from "./types.js";
import { linearize, type LinearEvent, type LinearizeResult } from "./linearize.js";
import { extractSections, type Section } from "./sections.js";

/** Read WAV duration in seconds by finding the actual 'data' chunk. */
function wavDuration(path: string): number {
  const buf = readFileSync(path);
  const sampleRate = buf.readUInt32LE(24);
  const channels = buf.readUInt16LE(22);
  const bitsPerSample = buf.readUInt16LE(34);
  const bytesPerSample = bitsPerSample / 8;
  // Walk RIFF chunks to find 'data'
  let offset = 12; // skip RIFF header + WAVE tag
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      return chunkSize / (channels * bytesPerSample) / sampleRate;
    }
    offset += 8 + chunkSize;
  }
  throw new Error(`No data chunk found in ${path}`);
}

export interface AudioItem {
  position: number;   // seconds
  length: number;     // seconds
  file: string;       // path to WAV
}

export interface RppProject {
  rpp: string;
  cueWavsNeeded: string[];  // unique cue values that need TTS WAVs
}


/** Format a position to REAPER's 12-decimal precision. */
function fmtPos(n: number): string { return n.toFixed(12); }

/** Format a BPM to REAPER's 10-decimal precision. */
function fmtBpm(n: number): string { return n.toFixed(10); }

/** Format a simple number. */
function fmt(n: number): string { return parseFloat(n.toFixed(6)).toString(); }

/** Quote a string for RPP. */
function rppStr(s: string): string {
  return /[\s"{}]/.test(s) ? `"${s}"` : s;
}

/** Generate a random REAPER-style GUID. */
function newGuid(): string {
  const raw = crypto.randomUUID().toUpperCase().replace(/-/g, "");
  return `{${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}}`;
}

/** Encode beats-per-bar as REAPER's metronome pattern number. */
function patternNum(beats: number): number {
  let v = 0;
  for (let i = 0; i < beats - 1; i++) v = (v << 2) | 2;
  return (v << 2) | 1;
}

/** Encode beats-per-bar as REAPER's pattern string. */
function patternStr(beats: number): string { return "A" + "B".repeat(beats - 1); }

/** REAPER's timesig flags encoding. */
function timesigFlags(beats: number): number { return 262144 + beats; }

/** Convert beat position to seconds using the tempo map. */
function beatToSeconds(beat: number, tempoMap: { beat: number; bpm: number }[]): number {
  let seconds = 0;
  let prevBeat = 0;
  let prevBpm = tempoMap[0]?.bpm ?? 120;

  for (const tp of tempoMap) {
    if (tp.beat > beat) break;
    seconds += ((tp.beat - prevBeat) / prevBpm) * 60;
    prevBeat = tp.beat;
    prevBpm = tp.bpm;
  }
  seconds += ((beat - prevBeat) / prevBpm) * 60;
  return seconds;
}

export interface BuildOptions {
  /** Directory containing pre-generated cue WAVs named `<slug>.wav` */
  cueDir: string;
  /** Directory containing count WAVs named `1.wav`, `2.wav`, etc. */
  countDir: string;
  /** Directory containing click samples: accent.wav, beat.wav */
  clickDir: string;
}

export function buildRpp(song: Song, opts: BuildOptions): RppProject {
  const { events, paddingBeats } = linearize(song, { withPadding: true });
  const rawSections = extractSections(song);
  // Apply the same padding shift to sections
  const sections = rawSections.map(s => ({ ...s, beat: s.beat + paddingBeats }));

  // Build tempo map from events
  const tempoMap: { beat: number; bpm: number }[] = [];
  const timesigMap: { beat: number; num: number; den: number }[] = [];

  for (const e of events) {
    if (e.type === "tempo") {
      tempoMap.push({ beat: e.beat, bpm: Number(e.value) });
    } else if (e.type === "timesig") {
      const [num, den] = e.value.split("/").map(Number);
      timesigMap.push({ beat: e.beat, num, den });
    }
  }

  const masterBpm = tempoMap[0]?.bpm ?? song.bpm;
  const masterTs = song.timeSignature;

  // --- Tempo envelope points ---
  const tempoPoints: string[] = [];
  let lastBpm: number | null = null;
  let lastTs: number | null = null;

  for (const tp of tempoMap) {
    const sec = beatToSeconds(tp.beat, tempoMap);
    const tsAtBeat = timesigMap.filter(t => t.beat <= tp.beat).pop();
    const beats = tsAtBeat?.num ?? masterTs[0];

    if (tp.bpm !== lastBpm || beats !== lastTs) {
      const flags = timesigFlags(beats);
      const pNum = patternNum(beats);
      const pStr = patternStr(beats);
      tempoPoints.push(
        `PT ${fmtPos(sec)} ${fmtBpm(tp.bpm)} 1 ${flags} 0 1 0 "" 0 ${pNum} 0 ${pStr}`
      );
      lastBpm = tp.bpm;
      lastTs = beats;
    }
  }

  // If no tempo points, add one at the start
  if (tempoPoints.length === 0) {
    const beats = masterTs[0];
    tempoPoints.push(
      `PT ${fmtPos(0)} ${fmtBpm(masterBpm)} 1 ${timesigFlags(beats)} 0 1 0 "" 0 ${patternNum(beats)} 0 ${patternStr(beats)}`
    );
  }

  // --- Region markers ---
  const regionLines: string[] = [];
  let regionId = 1;
  for (const sec of sections) {
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

  // --- Cue + count items (single track) ---
  const trackItems: AudioItem[] = [];
  const cueNames = new Set<string>();

  // Cues: use linearized cue events (already padded)
  for (const e of events) {
    if (e.type === "cue") {
      const slug = e.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
      const file = `${opts.cueDir}/${slug}.wav`;
      cueNames.add(e.value);
      trackItems.push({ position: e.seconds, length: wavDuration(file), file });
    }
  }

  // Counts: 1 bar before each section (sections already padded)
  for (const sec of sections) {
    const beatsPerBar = sec.timeSignature[0];
    const barStartBeat = sec.beat - beatsPerBar;
    if (barStartBeat < 0) continue;

    for (let i = 0; i < beatsPerBar; i++) {
      const beatPos = barStartBeat + i;
      const beatSec = beatToSeconds(beatPos, tempoMap);
      const file = `${opts.countDir}/${i + 1}.wav`;
      trackItems.push({ position: beatSec, length: wavDuration(file), file });
    }
  }

  // --- Build RPP ---
  const tempoEnvLines = [
    `EGUID ${newGuid()}`,
    "ACT 1 -1",
    "VIS 1 0 1",
    "LANEHEIGHT 0 0",
    "ARM 0",
    "DEFSHAPE 1 -1 -1",
    ...tempoPoints,
  ].map(l => "  " + l).join("\n");

  const rppLines: string[] = [];

  // Project header
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

  // Tempo envelope
  rppLines.push(`  <TEMPOENVEX`);
  rppLines.push(tempoEnvLines);
  rppLines.push(`  >`);

  // Ruler — show regions
  rppLines.push(`  RULERHEIGHT 86 86`);
  rppLines.push(`  RULERLANE 1 4 "" 0 -1`);
  rppLines.push(`  RULERLANE 2 8 "" 0 -1`);

  // Region markers
  for (const line of regionLines) {
    rppLines.push(`  ${line}`);
  }

  // Click track (SOURCE CLICK — follows tempo map automatically)
  const clickItemContent = buildClickItem(song, sections, tempoMap, opts);
  rppLines.push(buildTrack("Click", 1, clickItemContent, {
    beat: -1, playoffs: "0 1", nchan: 2, mainsend: "1 0",
  }));

  // Cues & Counts track (BEAT -1 = time-based, so positions in seconds aren't reinterpreted as beats)
  rppLines.push(buildTrack("Cues & Counts", 0.8, buildWaveItems(trackItems), { beat: -1 }));

  // Audio tracks (stems, backing tracks, etc.)
  const audioByTrack = new Map<string, typeof events>();
  for (const e of events) {
    if (e.type === "audio") {
      const list = audioByTrack.get(e.value) ?? [];
      list.push(e);
      audioByTrack.set(e.value, list);
    }
  }
  for (const [trackName, audioEvents] of audioByTrack) {
    const items = buildAudioFileItems(audioEvents, tempoMap);
    rppLines.push(buildTrack(trackName, 1, items, { beat: -1 }));
  }

  rppLines.push(`>`);

  return {
    rpp: rppLines.join("\n"),
    cueWavsNeeded: [...cueNames],
  };
}

function buildClickItem(
  song: Song,
  sections: Section[],
  tempoMap: { beat: number; bpm: number }[],
  opts: BuildOptions,
): string {
  const masterTs = song.timeSignature;
  const masterBpm = tempoMap[0]?.bpm ?? song.bpm;

  const lastSection = sections[sections.length - 1];
  const totalSeconds = lastSection
    ? beatToSeconds(lastSection.beat + lastSection.durationBeats, tempoMap)
    : 0;

  const accentFile = `${opts.clickDir}/accent.wav`;
  const beatFile = `${opts.clickDir}/beat.wav`;

  const lines: string[] = [];
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

interface TrackOptions {
  beat?: number;
  playoffs?: string;
  nchan?: number;
  mainsend?: string;
}

function buildTrack(name: string, volume: number, itemContent: string, trackOpts?: TrackOptions): string {
  const lines: string[] = [];
  lines.push(`  <TRACK ${newGuid()}`);
  lines.push(`    NAME ${rppStr(name)}`);
  if (trackOpts?.beat !== undefined) lines.push(`    BEAT ${trackOpts.beat}`);
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

function buildWaveItems(items: AudioItem[]): string {
  const lines: string[] = [];
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

/** Determine RPP source type from file extension. */
function sourceType(file: string): string {
  const ext = file.toLowerCase().split(".").pop();
  if (ext === "mp3") return "MP3";
  return "WAVE";
}

function buildAudioFileItems(
  audioEvents: LinearEvent[],
  tempoMap: { beat: number; bpm: number }[],
): string {
  const lines: string[] = [];
  for (const e of audioEvents) {
    const position = e.seconds;
    const soffs = e.soffs ?? 0;
    const absFile = resolve(e.file!);
    const srcType = sourceType(absFile);
    lines.push(`    <ITEM`);
    lines.push(`      POSITION ${fmtPos(position)}`);
    lines.push(`      LENGTH 0`);
    lines.push(`      LOOP 1`);
    lines.push(`      ALLTAKES 0`);
    lines.push(`      FADEIN 1 0 0 1 0 0 0`);
    lines.push(`      FADEOUT 1 0 0 1 0 0 0`);
    lines.push(`      MUTE 0 0`);
    lines.push(`      VOLPAN 1 0 1 -1`);
    lines.push(`      SOFFS ${fmtPos(soffs)}`);
    lines.push(`      PLAYRATE 1 1 0 -1 0 0.0025`);
    lines.push(`      CHANMODE 0`);
    lines.push(`      GUID ${newGuid()}`);
    lines.push(`      <SOURCE ${srcType}`);
    lines.push(`        FILE ${rppStr(absFile)} 1`);
    lines.push(`      >`);
    lines.push(`    >`);
  }
  return lines.join("\n");
}
