/**
 * Generate a REAPER project file from a Song tree.
 *
 * Produces:
 * - Tempo envelope from linearized tempo/timesig events
 * - Region markers for each section
 * - A "Cues & Counts" track with spoken section names (2 bars before)
 *   and beat numbers (1 bar before) each section
 */

import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { readFileSync } from "fs";
import type { Song } from "./dsongl/index.js";
import { linearize, type LinearEvent, type LinearizeResult } from "./linearize.js";
import { extractSections, type Section } from "./sections.js";
import { songSlug } from "./dsongl/index.js";
import { beatsToStretchMarkers, formatStretchMarkers, type Beat } from "./stretch-markers.js";
import { beatToSeconds } from "./tempo.js";

import { accessSync, constants } from "fs";

/** Resolve the clickbait-audio binary: prefer release build, fall back to debug. */
function findAudioBin(): string {
  const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const release = resolve(root, "target", "release", "clickbait-audio");
  const debug = resolve(root, "target", "debug", "clickbait-audio");
  try { accessSync(release, constants.X_OK); return release; } catch {}
  try { accessSync(debug, constants.X_OK); return debug; } catch {}
  throw new Error(`clickbait-audio not found. Run: cargo build --release -p clickbait-audio`);
}
const audioBin = findAudioBin();

/** Get audio file duration in seconds (WAV, MP3, or any symphonia-supported format). */
function audioDuration(path: string): number {
  const out = execSync(`"${audioBin}" duration "${path}"`, { encoding: "utf8" }).trim();
  const dur = parseFloat(out);
  if (isNaN(dur)) throw new Error(`Could not determine duration of ${path}`);
  return dur;
}

export interface AudioItem {
  position: number;   // seconds
  length: number;     // seconds
  file: string;       // path to WAV
}

export interface RppProject {
  rpp: string;
  cueWavsNeeded: string[];  // unique cue values that need TTS WAVs
  /** Beats of slug padding prepended to the song. Pass this to exportSongPayload
   *  so the teleprompter's beat frame matches REAPER's. */
  slugBeats: number;
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

// beatToSeconds moved to src/tempo.ts (canonical home for beat↔seconds math).

export interface BuildOptions {
  /** Directory containing pre-generated cue WAVs named `<slug>.wav` */
  cueDir: string;
  /** Directory containing count WAVs named `1.wav`, `2.wav`, etc. */
  countDir: string;
  /** Directory containing click samples: accent.wav, beat.wav */
  clickDir: string;
}

export function buildRpp(song: Song, opts: BuildOptions): RppProject {
  // Slug = auto-inserted region at the top of the RPP holding the song-title
  // TTS announcement. Default 4 bars; grows if the title TTS is long.
  const beatsPerBar = song.timeSignature[0];
  const barSeconds = (60 / song.bpm) * beatsPerBar;
  const titleSlugName = song.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
  const titleFile = `${opts.cueDir}/${titleSlugName}.wav`;
  const titleDur = audioDuration(titleFile);
  const slugBars = Math.max(4, Math.ceil(titleDur / barSeconds) + 1);
  const slugBeats = slugBars * beatsPerBar;

  const { events, paddingBeats } = linearize(song, { withPadding: true, minPaddingBeats: slugBeats });
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
  // Merge tempo and timesig changes into a single sorted list of envelope points.
  // REAPER needs a tempo envelope point at every BPM or timesig change.
  const allChanges: { beat: number; bpm?: number; num?: number }[] = [];
  for (const tp of tempoMap) allChanges.push({ beat: tp.beat, bpm: tp.bpm });
  for (const ts of timesigMap) allChanges.push({ beat: ts.beat, num: ts.num });
  allChanges.sort((a, b) => a.beat - b.beat);

  const tempoPoints: string[] = [];
  let currentBpm = masterBpm;
  let currentTs = masterTs[0];

  // Dedupe by beat — merge bpm and timesig at the same beat
  const byBeat = new Map<number, { bpm: number; num: number }>();
  for (const c of allChanges) {
    const existing = byBeat.get(c.beat) ?? { bpm: currentBpm, num: currentTs };
    if (c.bpm !== undefined) existing.bpm = c.bpm;
    if (c.num !== undefined) existing.num = c.num;
    byBeat.set(c.beat, existing);
    if (c.bpm !== undefined) currentBpm = c.bpm;
    if (c.num !== undefined) currentTs = c.num;
  }

  // Ensure beat 0 is always present
  if (!byBeat.has(0)) {
    byBeat.set(0, { bpm: masterBpm, num: masterTs[0] });
  }

  let lastBpm: number | null = null;
  let lastTs: number | null = null;
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

  // --- Region markers ---
  const regionLines: string[] = [];
  let regionId = 1;
  const slug = songSlug(song);

  // Region #1: the slug — auto-inserted pre-song region holding the title TTS.
  // Named with the song slug so REAPER's /lastregion/name OSC message lets the
  // teleprompter identify the song on tab switch.
  {
    const slugEndSec = beatToSeconds(slugBeats, tempoMap);
    regionLines.push(
      `MARKER ${regionId} ${fmt(0)} ${rppStr(slug)} 1 0 1 B ${newGuid()} 0 1`
    );
    regionLines.push(
      `MARKER ${regionId} ${fmt(slugEndSec)} "" 1`
    );
    regionId++;
  }

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

  // Title cue at beat 0 (within the auto-slug region)
  cueNames.add(song.title);
  trackItems.push({ position: 0, length: titleDur, file: titleFile });

  // Track when the cue track is "free" (no overlapping items)
  let cueTrackFreeAfter = titleDur;

  // Auto-cues: sections with cue=true get a TTS announcement 2 bars before
  // Skipped if it would overlap with the title cue or a previous section cue
  for (const sec of sections) {
    if (!sec.cue) continue;
    const beatsPerBar = sec.timeSignature[0];
    const cueBeat = sec.beat - beatsPerBar * 2; // 2 bars before section
    if (cueBeat < 0) continue;
    const cueSec = beatToSeconds(cueBeat, tempoMap);
    if (cueSec < cueTrackFreeAfter) continue; // would overlap — skip
    const cueSlug = sec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
    const file = `${opts.cueDir}/${cueSlug}.wav`;
    const dur = audioDuration(file);
    cueNames.add(sec.name);
    trackItems.push({ position: cueSec, length: dur, file });
    cueTrackFreeAfter = cueSec + dur;
  }

  // Manual cue() events (ad-hoc band notes, already padded)
  for (const e of events) {
    if (e.type === "cue") {
      const slug = e.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
      const file = `${opts.cueDir}/${slug}.wav`;
      cueNames.add(e.value);
      trackItems.push({ position: e.seconds, length: audioDuration(file), file });
    }
  }

  // Counts: 1 bar before each cue section (sections already padded)
  for (const sec of sections.filter(s => s.cue)) {
    const beatsPerBar = sec.timeSignature[0];
    const barStartBeat = sec.beat - beatsPerBar;
    if (barStartBeat < 0) continue;

    for (let i = 0; i < beatsPerBar; i++) {
      const beatPos = barStartBeat + i;
      const beatSec = beatToSeconds(beatPos, tempoMap);
      const file = `${opts.countDir}/${i + 1}.wav`;
      trackItems.push({ position: beatSec, length: audioDuration(file), file });
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

  // Render settings — 24-bit WAV, LUFS-I -15, normalize on. Output written next
  // to the .RPP as `mix.wav` (RENDER_PATTERN=mix). We render WAV from REAPER
  // because REAPER's Opus encoder produces files that Safari/QuickTime can't
  // play; ffmpeg post-encode handles Opus reliably (see bin/render-bundle.mjs).
  rppLines.push(`  RENDER_FILE ""`);
  rppLines.push(`  RENDER_PATTERN mix`);
  rppLines.push(`  RENDER_FMT 0 2 44100`);
  rppLines.push(`  RENDER_1X 0`);
  rppLines.push(`  RENDER_RANGE 1 0 0 0 1000`);
  rppLines.push(`  RENDER_RESAMPLE 3 0 1`);
  rppLines.push(`  RENDER_ADDTOPROJ 0`);
  rppLines.push(`  RENDER_STEMS 0`);
  rppLines.push(`  RENDER_DITHER 0`);
  rppLines.push(`  RENDER_NORMALIZE 1 0.177828 1 0 0 1 1`);
  rppLines.push(`  RENDER_TRIM 0.000001 0.000001 0 0`);
  rppLines.push(`  <RENDER_CFG`);
  rppLines.push(`    ZXZhdxgAAQ==`);
  rppLines.push(`  >`);
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
  rppLines.push(buildTrack("Cues & Counts", 1, buildWaveItems(trackItems), { beat: -1 }));

  // Audio tracks (stems, backing tracks, etc.)
  // Calculate project end time so audio items can be trimmed
  const lastSection = sections[sections.length - 1];
  const projectEndSec = lastSection
    ? beatToSeconds(lastSection.beat + lastSection.durationBeats, tempoMap)
    : 0;

  const audioByTrack = new Map<string, typeof events>();
  for (const e of events) {
    if (e.type === "audio") {
      const list = audioByTrack.get(e.value) ?? [];
      list.push(e);
      audioByTrack.set(e.value, list);
    }
  }
  const defaultSoffs = song.preRollSeconds ?? 0;
  if (defaultSoffs > 0 && audioByTrack.size > 0) {
    let applied = 0;
    for (const evs of audioByTrack.values()) {
      for (const e of evs) if (e.soffs === undefined) applied++;
    }
    if (applied > 0) {
      console.error(`Applying preRollSeconds=${defaultSoffs}s as soffs to ${applied} audio item${applied === 1 ? "" : "s"}`);
    }
  }
  // Stems sit at -3dB so the click and cue tracks (at 0dB) cut through the mix.
  // 0.70794578438414 = 10^(-3/20).
  const stemVolume = 0.70794578438414;
  for (const [trackName, audioEvents] of audioByTrack) {
    const items = buildAudioFileItems(audioEvents, tempoMap, 1, projectEndSec, defaultSoffs);
    rppLines.push(buildTrack(trackName, stemVolume, items, { beat: -1 }));
  }

  rppLines.push(`>`);

  return {
    rpp: rppLines.join("\n"),
    cueWavsNeeded: [...cueNames],
    slugBeats,
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
  groupId: number | undefined,
  projectEndSec: number | undefined,
  defaultSoffs: number,
): string {
  const lines: string[] = [];
  for (let i = 0; i < audioEvents.length; i++) {
    const e = audioEvents[i];
    const next = audioEvents[i + 1];
    let position = e.seconds;
    const soffs = e.soffs ?? defaultSoffs;
    const absFile = resolve(e.file!);
    const srcType = sourceType(absFile);
    const totalDur = audioDuration(absFile);
    const sourceCap = e.sourceEnd !== undefined ? e.sourceEnd - soffs : totalDur - soffs;
    let length = sourceCap;

    // Load stretch markers from beats sidecar if available
    let smLines: string[] = [];
    if (e.sourceEnd !== undefined && !e.beatsFile) {
      // Rigid segment with two anchor SMs: REAPER applies one uniform stretch
      // across the segment, preserving feel between anchors but locking edges
      // to the click. Timeline length comes from the next item's position.
      const timelineLen = next ? next.seconds - position : sourceCap;
      smLines = formatStretchMarkers(
        [
          { beat: -1, itemPosition: 0, sourcePosition: soffs },
          { beat: -1, itemPosition: timelineLen, sourcePosition: e.sourceEnd },
        ],
        0,
        0,
      );
      length = timelineLen;
    } else if (e.beatsFile) {
      const bpm = tempoMap[0]?.bpm ?? 120;
      const beatsData = JSON.parse(readFileSync(e.beatsFile, "utf8"));
      // Drop beats that fall inside the soffs trim — their source positions
      // would be negative relative to the item and REAPER rejects those.
      const beats: Beat[] = (beatsData.beats as Beat[]).filter(b => b.time >= soffs);
      // If the first beat isn't at source 0, there's leading source audio
      // before the first beat (e.g. a quiet arpeggio or room noise) that
      // would otherwise be clipped — the first SM at (item 0, source
      // beats[0].time) treats source 0→beats[0].time as "before the item".
      // Fix: anchor the first-beat marker at an identity point (item=source=
      // beats[0].time) and shift the item earlier in project time by
      // beats[0].time, so source 0 now plays at item-time 0 at 1:1 rate and
      // the first beat still lands at the user-authored project position.
      const preRegion = soffs === 0 && beats.length > 0 ? beats[0].time : 0;
      const markers = beatsToStretchMarkers(beats, {
        bpm,
        sourceAnchor: beats[0]?.time ?? soffs,
        itemAnchor: preRegion,
        stride: e.smStride,
      });
      if (markers.length > 0) {
        if (preRegion > 0) {
          // Prepend identity SM at (item 0, source 0) so the pre-first-beat
          // audio plays 1:1 from the start of the item.
          markers.unshift({ beat: -1, itemPosition: 0, sourcePosition: 0 });
          // Move the item earlier in the project so the first beat still
          // lands at its authored position.
          position -= preRegion;
        }
        // REAPER reads SM source positions as file-absolute (not relative to
        // soffs), so pass 0 here regardless of the item's soffs value.
        smLines = formatStretchMarkers(markers, 0, 0);
        // Item length = last marker's grid position (stretched timeline)
        length = Math.min(markers[markers.length - 1].itemPosition, sourceCap);
      }
    }

    // Trim to project end so REAPER stops playback cleanly
    if (projectEndSec !== undefined) {
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
    if (groupId !== undefined) lines.push(`      GROUP ${groupId}`);
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
