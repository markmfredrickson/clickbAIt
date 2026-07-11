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
import type { Song } from "../core/dsongl/index.js";
import { linearize, type LinearEvent, type LinearizeResult } from "./linearize.js";
import { extractSections, type Section } from "./sections.js";
import { songSlug } from "../core/dsongl/index.js";
import { beatsToStretchMarkers, formatStretchMarkers, type Beat } from "./stretch-markers.js";
import { Curve } from "../core/curve.js";
import { hwoutField, recordTrackSpecs, type Rig, type Route } from "../rig.js";

import { accessSync, constants } from "fs";

/** Resolve the clickbait-audio binary: prefer release build, fall back to debug. */
function findAudioBin(): string {
  const root = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");
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
  /** Beats from the rendered timeline's start (project time 0) to the downbeat
   *  (beat 0) — the actual pre-song padding. Usually == slugBeats, but larger if
   *  a long count-in/pre-roll or a negative-offset cue forced more room. The
   *  rendered mix starts here, so a bundle needs this to align its audio clock. */
  paddingBeats: number;
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

// Beat↔seconds resolution lives in the Curve resolver (src/curve.ts). A tempo
// map is converted once via Curve.fromTempoMap and queried with curve.toTime.

export interface BuildOptions {
  /** Directory containing pre-generated cue WAVs named `<slug>.wav` */
  cueDir: string;
  /** Directory containing count WAVs named `1.wav`, `2.wav`, etc. */
  countDir: string;
  /** Directory containing click samples: accent.wav, beat.wav */
  clickDir: string;
  /** Rig routing + record-track layout (default.json). Optional — without it,
   *  no hardware routing is emitted and no record tracks are added. */
  rig?: Rig;
  /** Per-section stretch-marker stride, in SONG beats (pre-padding). Within a
   *  range, only every `stride`-th beat becomes a stretch marker (so a loose
   *  passage keeps its feel between downbeats). Outside all ranges, every beat. */
  strideRanges?: { startBeat: number; endBeat: number; stride: number }[];
  /** Seconds the stems play PAST the song end (natural decay, 1:1, no stretch)
   *  while the click halts at the end. For songs that end on a hit/abrupt stop. */
  ringOutSec?: number;
  /** Source position (seconds) for the leading stretch marker (item 0) of items
   *  that begin at the song start — the intro's single stretch segment when the
   *  first section uses `smStride: 0`. Default 0 (identity). Captures a
   *  hand-tuned loose-intro timing so regeneration reproduces it. */
  introLeadSource?: number;
  /** Verbatim intro stretch markers (itemPosition, sourcePosition seconds),
   *  captured from a hand-tuned REAPER intro. When present they REPLACE the
   *  generated leading markers on song-start items; the beat grid resumes after
   *  (the intro section must use smStride:0 so no generated intro markers remain). */
  introMarkers?: { itemPosition: number; sourcePosition: number }[];
  /** Per-beat source times for the recording, shared by every stem (they play
   *  the same recording). Supplied by the manifest path from the beat-map (see
   *  beatMapToBeats). When present it replaces reading each audio node's
   *  `beatsFile`; the `.ts` DSongL path omits it and still reads `beatsFile`. */
  recordingBeats?: { time: number }[];
  /** Attack offset (seconds INTO each cue WAV) to land on its beat, keyed by WAV
   *  basename (section-name slug, or the count number "2","3",…). For a section
   *  name it's the LAST syllable's onset (the name plays as a pickup resolving on
   *  the "1"); for a count number it's the digit's onset. Absent → a name falls
   *  back to its full duration, a number to 0 (starts on the beat). See cue-onset.ts. */
  cueOnsets?: Record<string, number>;
}

/** Track options (mainsend/hwout/mute/gain) for a generated track from a rig
 *  Route, or sensible defaults when no rig is configured. */
function routeOpts(route: Route | undefined, fallbackToMaster: boolean): {
  mainsend: string;
  hwout?: number;
  muted: boolean;
  gain: number;
} {
  if (!route) return { mainsend: fallbackToMaster ? "1 0" : "0 0", muted: false, gain: 1 };
  return {
    mainsend: route.master ? "1 0" : "0 0",
    hwout: route.hwout ? hwoutField(route.hwout) : undefined,
    muted: route.muted,
    gain: route.gain,
  };
}

export function buildRpp(song: Song, opts: BuildOptions): RppProject {
  // Slug = auto-inserted region at the top of the RPP holding the song-title
  // TTS announcement + the count-in bar. Kept as short as possible (title bars +
  // 1 count-in bar) so there isn't a long stretch of click before the downbeat;
  // floor of 2 (title bar + count-in), grows only if the title TTS is long.
  const beatsPerBar = song.timeSignature[0];
  const barSeconds = (60 / song.bpm) * beatsPerBar;
  const titleSlugName = song.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
  const titleFile = `${opts.cueDir}/${titleSlugName}.wav`;
  const titleDur = audioDuration(titleFile);
  const slugBars = Math.max(2, Math.ceil(titleDur / barSeconds) + 1);
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

  // Single resolver for every beat→seconds conversion below.
  const curve = Curve.fromTempoMap(tempoMap);

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
      const sec = curve.toTime(beat);
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
    const slugEndSec = curve.toTime(slugBeats);
    regionLines.push(
      `MARKER ${regionId} ${fmt(0)} ${rppStr(slug)} 1 0 1 B ${newGuid()} 0 1`
    );
    regionLines.push(
      `MARKER ${regionId} ${fmt(slugEndSec)} "" 1`
    );
    regionId++;
  }

  for (const sec of sections) {
    const startSec = curve.toTime(sec.beat);
    const endSec = curve.toTime(sec.beat + sec.durationBeats);
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

  // (Section names are no longer announced 2 bars ahead — the name now leads the
  // count-in bar as a pickup; see the count-in loop below.)

  // Manual cue() events (ad-hoc band notes, already padded). Onset-anchored like
  // the count-in: shift the WAV earlier by its attack so the word/hit SOUNDS on
  // the authored beat rather than starting there (and landing late).
  for (const e of events) {
    if (e.type === "cue") {
      const slug = e.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
      const file = `${opts.cueDir}/${slug}.wav`;
      cueNames.add(e.value);
      const onset = opts.cueOnsets?.[slug] ?? 0;
      trackItems.push({ position: Math.max(0, e.seconds - onset), length: audioDuration(file), file });
    }
  }

  // Count-in, one bar before each cued section, placed IN THAT BAR'S METER — the
  // PREVIOUS section's meter (the pulse the band is still feeling), NOT the new
  // section's. So a 4/4→3/4 change still counts "1 2 3 4" on the real beats
  // (counting the new meter would land the numbers on the wrong beats of the old
  // bar), and a larger new meter can't overflow a short old bar (e.g. a 2/4
  // pickup). The first section's count-in sits in the slug, in the song's default
  // meter. The section NAME leads the bar as a pickup resolving on beat 1, then
  // "2..N". Counts stay distinct per-beat WAVs.
  //
  // TODO (unresolved): odd/compound meters like 7/8 or 5/8. This counts one number
  // per beat-unit of the meter numerator, which is fine for x/4 but wrong-feeling
  // for compound 8ths — e.g. 7/8 usually groups (2+2+3) and would want "1 2 3" over
  // the groups, not seven evenly-spaced numbers. Changing INTO such a meter is also
  // unknown territory (see docs/count-in-meters.md). Handle with explicit count
  // cues for now.
  for (let idx = 0; idx < sections.length; idx++) {
    const sec = sections[idx];
    if (!sec.cue) continue;
    const beatsPerBar = (idx > 0 ? sections[idx - 1].timeSignature : song.timeSignature)[0];
    const barStartBeat = sec.beat - beatsPerBar;
    if (barStartBeat < 0) continue;

    // Beat 1: section name, last syllable resolving onto the beat.
    const nameSlug = sec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
    const nameFile = `${opts.cueDir}/${nameSlug}.wav`;
    const nameDur = audioDuration(nameFile);
    cueNames.add(sec.name);
    // Anchor the name so its last-syllable onset (not the file end) lands on the
    // beat — the name plays as a pickup and resolves ON the "1".
    const nameAnchor = opts.cueOnsets?.[nameSlug] ?? nameDur;
    trackItems.push({ position: Math.max(0, curve.toTime(barStartBeat) - nameAnchor), length: nameDur, file: nameFile });

    // Beats 2..N: count numbers, each digit's onset landing on its beat.
    for (let i = 1; i < beatsPerBar; i++) {
      const num = String(i + 1);
      const file = `${opts.countDir}/${num}.wav`;
      const numAnchor = opts.cueOnsets?.[num] ?? 0;
      trackItems.push({ position: Math.max(0, curve.toTime(barStartBeat + i) - numAnchor), length: audioDuration(file), file });
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
  if (opts.rig?.master?.hwout) {
    rppLines.push(`  MASTERHWOUT ${hwoutField(opts.rig.master.hwout)} 0 1 0 0 0 0 -1`);
  }
  // Project measure offset: relabel the bar grid so the song's downbeat reads
  // as Bar 1 and the slug/count-in falls on negative bars (timeline still
  // starts at 0:00). Cosmetic — REAPER bar numbers only; the teleprompter
  // aligns via OSC time through the curve, not bars. See docs/timing-frames.md.
  rppLines.push(`  PROJOFFS 0 ${-slugBars} 0`);
  rppLines.push(`  TEMPO ${fmt(masterBpm)} ${masterTs[0]} ${masterTs[1]} 0`);
  rppLines.push(`  PLAYRATE 1 0 0.25 4`);
  rppLines.push(`  TIMELOCKMODE 1`);
  rppLines.push(`  TEMPOENVLOCKMODE 1`);
  rppLines.push(`  ITEMMIX 1`);
  rppLines.push(`  LOOP 0`);

  // Render settings — 24-bit WAV, LUFS-I -15, normalize on. Output written next
  // to the .RPP named with the song slug (e.g. `<song>-<artist>.wav`),
  // so a rendered mix carries song/artist info on disk like the .RPP does. We
  // render WAV from REAPER because REAPER's Opus encoder produces files that
  // Safari/QuickTime can't play; ffmpeg post-encode handles Opus reliably.
  rppLines.push(`  RENDER_FILE ""`);
  rppLines.push(`  RENDER_PATTERN ${slug}`);
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
  const clickItemContent = buildClickItem(song, sections, tempoMap, curve, opts);
  const clickR = routeOpts(opts.rig?.generated?.click, true);
  rppLines.push(buildTrack("Click", clickR.gain, clickItemContent, {
    beat: -1, playoffs: "0 1", nchan: 2,
    mainsend: clickR.mainsend, hwout: clickR.hwout, muted: clickR.muted,
  }));

  // Cues & Counts track (BEAT -1 = time-based, so positions in seconds aren't reinterpreted as beats)
  const cuesR = routeOpts(opts.rig?.generated?.cues, true);
  rppLines.push(buildTrack("Cues & Counts", cuesR.gain, buildWaveItems(trackItems), {
    beat: -1, mainsend: cuesR.mainsend, hwout: cuesR.hwout, muted: cuesR.muted,
  }));

  // Audio tracks (stems, backing tracks, etc.)
  // Calculate project end time so audio items can be trimmed
  const lastSection = sections[sections.length - 1];
  const projectEndSec = lastSection
    ? curve.toTime(lastSection.beat + lastSection.durationBeats)
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
  // Stems default to unity — balance is set downstream (on the mixer), not
  // baked into the render. A rig stems Route can override gain/mute/send.
  const stemsR = routeOpts(opts.rig?.generated?.stems, true);
  const strideTimeRanges = (opts.strideRanges ?? []).map(r => ({
    tStart: curve.toTime(r.startBeat + paddingBeats),
    tEnd: curve.toTime(r.endBeat + paddingBeats),
    stride: r.stride,
  }));
  // Wrap the stems in a folder so the whole backing can be muted or ridden from
  // one place. The folder parent ("Stems") is a submix bus: its fader is the
  // group volume, its mute the group mute, and the children sum into it. REAPER
  // folder encoding (ISBUS): parent = "1 1", the last child closes the folder
  // with "2 -1"; regular children stay "0 0".
  const stemNames = [...audioByTrack.keys()];
  if (stemNames.length > 0) {
    // The mute lives on the folder PARENT, not the children — muting the parent
    // silences the whole group, so "ship muted" means the user unmutes one track
    // (Stems) to hear all the backing, not four. Individual stems stay unmuted.
    //
    // The parent sits -3 dB so the click/cues ride over the backing in the master
    // render (the bundle mix). Live is unaffected: the rig sends stems to hardware
    // via the CHILD tracks' HWOUT (at unity), not through this parent, and the
    // parent's master send is muted on stage. (Interim; per-part levels become
    // tweakable in the multitrack bundle.)
    const STEMS_FOLDER_GAIN = Math.pow(10, -3 / 20); // -3 dB ≈ 0.708
    rppLines.push(buildTrack("Stems", STEMS_FOLDER_GAIN, "", { mainsend: "1 0", isbus: "1 1", muted: stemsR.muted }));
    stemNames.forEach((trackName, i) => {
      const audioEvents = audioByTrack.get(trackName)!;
      const items = buildAudioFileItems(audioEvents, tempoMap, 1, projectEndSec, defaultSoffs, strideTimeRanges, opts.ringOutSec ?? 0, opts.introLeadSource ?? 0, opts.introMarkers, opts.recordingBeats);
      rppLines.push(buildTrack(trackName, stemsR.gain, items, {
        beat: -1, mainsend: stemsR.mainsend, hwout: stemsR.hwout,
        isbus: i === stemNames.length - 1 ? "2 -1" : "0 0",
      }));
    });
  }

  // Record tracks (band block + drum feeds) from the rig. Each records from a
  // card input and — when roundTrip — plays back out to the same channel, so
  // flipping the mixer to the card lets the band hear their own take on their
  // own channel (virtual soundcheck). Not sent to master.
  if (opts.rig) {
    for (const t of recordTrackSpecs(opts.rig)) {
      rppLines.push(buildTrack(t.name, 1, "", {
        recarm: t.arm, recinput: t.recInput, hwout: t.hwout,
        nchan: t.nchan, mainsend: "0 0",
      }));
    }
  }

  rppLines.push(`>`);

  return {
    rpp: rppLines.join("\n"),
    cueWavsNeeded: [...cueNames],
    slugBeats,
    paddingBeats,
  };
}

function buildClickItem(
  song: Song,
  sections: Section[],
  tempoMap: { beat: number; bpm: number }[],
  curve: Curve,
  opts: BuildOptions,
): string {
  const masterTs = song.timeSignature;
  const masterBpm = tempoMap[0]?.bpm ?? song.bpm;

  const lastSection = sections[sections.length - 1];
  const totalSeconds = lastSection
    ? curve.toTime(lastSection.beat + lastSection.durationBeats)
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
  /** MUTESOLO first field: true = muted. */
  muted?: boolean;
  /** Record-arm this track (REC field 1). */
  recarm?: boolean;
  /** Record-input channel (REC field 2). See rig.recInputField. */
  recinput?: number;
  /** Hardware output field (HWOUT). See rig.hwoutField. */
  hwout?: number;
  /** ISBUS folder field, "<folder-state> <indent-change>". Default "0 0"
   *  (regular track). Folder parent = "1 1"; the last child that closes the
   *  folder = "2 -1". */
  isbus?: string;
}

function buildTrack(name: string, volume: number, itemContent: string, trackOpts?: TrackOptions): string {
  const lines: string[] = [];
  lines.push(`  <TRACK ${newGuid()}`);
  lines.push(`    NAME ${rppStr(name)}`);
  if (trackOpts?.beat !== undefined) lines.push(`    BEAT ${trackOpts.beat}`);
  lines.push(`    VOLPAN ${fmt(volume)} 0 -1 -1 1`);
  lines.push(`    MUTESOLO ${trackOpts?.muted ? 1 : 0} 0 0`);
  lines.push(`    IPHASE 0`);
  if (trackOpts?.playoffs) lines.push(`    PLAYOFFS ${trackOpts.playoffs}`);
  lines.push(`    ISBUS ${trackOpts?.isbus ?? "0 0"}`);
  lines.push(`    BUSCOMP 0 0 0 0 0`);
  lines.push(`    SHOWINMIX 1 0.6667 0.5 1 0.5 0 0 0`);
  lines.push(`    REC ${trackOpts?.recarm ? 1 : 0} ${trackOpts?.recinput ?? 0} 1 0 0 0 0 0`);
  if (trackOpts?.nchan) lines.push(`    NCHAN ${trackOpts.nchan}`);
  lines.push(`    TRACKID ${newGuid()}`);
  if (trackOpts?.mainsend) lines.push(`    MAINSEND ${trackOpts.mainsend}`);
  if (trackOpts?.hwout !== undefined) lines.push(`    HWOUT ${trackOpts.hwout} 0 1 0 0 0 0 -1:U -1`);
  if (itemContent) lines.push(itemContent);
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
  strideRanges: { tStart: number; tEnd: number; stride: number }[] = [],
  ringOutSec = 0,
  introLeadSource = 0,
  introMarkers?: { itemPosition: number; sourcePosition: number }[],
  recordingBeats?: { time: number }[],
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
    if (e.sourceEnd !== undefined && !e.beatsFile && !recordingBeats) {
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
    } else if (recordingBeats || e.beatsFile) {
      const bpm = tempoMap[0]?.bpm ?? 120;
      // Manifest path supplies the recording's per-beat source times directly
      // (from the beat-map, shared across stems); the `.ts` path reads a
      // `beatsFile` sidecar. Either way: drop beats inside the soffs trim —
      // their source positions would be negative relative to the item — and,
      // for a clip (a source-time slice), drop beats past `sourceEnd` so its
      // stretch markers don't spill into the following source region (a repeated
      // slice would otherwise drag in the beats after it).
      const allBeats: Beat[] = recordingBeats ?? JSON.parse(readFileSync(e.beatsFile!, "utf8")).beats;
      // Quarter-beat tolerance on the clip window: the authored clip seconds are
      // rounded, so a boundary beat landing ~on soffs/sourceEnd can fall just
      // outside and get dropped — and with downbeat-only stride that loses a
      // whole bar. A quarter beat is far below the beat spacing, so it recovers
      // the boundary beat without ever grabbing the neighbour.
      const beatEps = e.sourceEnd !== undefined ? 0.25 * (60 / bpm) : 0;
      const beats: Beat[] = allBeats.filter(
        b => b.time >= soffs - beatEps && (e.sourceEnd === undefined || b.time <= e.sourceEnd + beatEps),
      );
      // If the first beat isn't at source 0, there's leading source audio
      // before the first beat (e.g. a quiet arpeggio or room noise) that
      // would otherwise be clipped — the first SM at (item 0, source
      // beats[0].time) treats source 0→beats[0].time as "before the item".
      // Fix: anchor the first-beat marker at an identity point (item=source=
      // beats[0].time) and shift the item earlier in project time by
      // beats[0].time, so source 0 now plays at item-time 0 at 1:1 rate and
      // the first beat still lands at the user-authored project position.
      const preRegion = soffs === 0 && beats.length > 0 ? beats[0].time : 0;
      let markers = beatsToStretchMarkers(beats, {
        bpm,
        sourceAnchor: beats[0]?.time ?? soffs,
        itemAnchor: preRegion,
        stride: e.smStride,
      });
      // Per-section stride: thin markers to every Nth beat inside a range so a
      // loose passage (e.g. a triplet solo) keeps its feel between downbeats.
      // A marker's absolute project time is position + beat*beatLen (the
      // preRegion shift cancels). Ranges arrive resolved to project time.
      if (strideRanges.length > 0 && markers.length > 0) {
        const beatLen = 60 / bpm;
        markers = markers.filter(m => {
          const absT = position + m.beat * beatLen;
          for (const r of strideRanges) {
            if (absT >= r.tStart - 1e-6 && absT < r.tEnd - 1e-6) {
              if (r.stride === 0) return false; // no stretch markers in this section — play 1:1
              const firstBeat = Math.round((r.tStart - position) / beatLen);
              return (m.beat - firstBeat) % r.stride === 0;
            }
          }
          return true;
        });
      }
      // Ring-out: drop stretch markers past the song end so the last marker
      // sits ON the end; the tail after it plays 1:1 (natural decay) while the
      // click halts at the end. Item length then extends ringOutSec beyond it.
      if (ringOutSec > 0 && projectEndSec !== undefined && markers.length > 0) {
        const beatLen = 60 / bpm;
        markers = markers.filter(m => position + m.beat * beatLen <= projectEndSec + 1e-6);
      }
      if (markers.length > 0) {
        if (introMarkers && introMarkers.length > 0) {
          // Verbatim hand-tuned intro markers (captured from REAPER) REPLACE the
          // generated leading markers. The intro section uses smStride:0 so no
          // generated markers remain in its span; these define the intro's
          // stretch, and the beat grid resumes at the drums entry. No preRegion
          // shift — the markers' item positions already place the audio.
          markers.unshift(
            ...introMarkers.map(m => ({ beat: -1, itemPosition: m.itemPosition, sourcePosition: m.sourcePosition })),
          );
        } else if (preRegion > 0) {
          // Prepend a leading SM at (item 0, source `introLeadSource`). Default
          // 0 = identity (pre-first-beat audio plays 1:1). A non-zero value
          // (hand-tuned loose intro, captured in the manifest) re-times the
          // segment from item 0 to the next marker.
          markers.unshift({ beat: -1, itemPosition: 0, sourcePosition: introLeadSource });
          // Move the item earlier in the project so the first beat still
          // lands at its authored position.
          position -= preRegion;
        }
        // REAPER reads SM source positions as file-absolute (not relative to
        // soffs), so pass 0 here regardless of the item's soffs value.
        smLines = formatStretchMarkers(markers, 0, 0);
        // Item length is a TIMELINE span: the last marker's grid position, plus
        // any source past that marker up to sourceEnd played 1:1 (a clip authored
        // a hair longer than its last downbeat — e.g. a half-beat ring on the
        // final hit), plus any global ring-out tail. NOT capped by sourceCap
        // (source-seconds axis) — when stretched, that min would clip the final
        // beat short. projectEndSec (below) bounds it to song end.
        const lastMarker = markers[markers.length - 1];
        const trailing = e.sourceEnd !== undefined ? Math.max(0, e.sourceEnd - lastMarker.sourcePosition) : 0;
        length = lastMarker.itemPosition + trailing + ringOutSec;
      }
    }

    // Trim to project end (+ ring-out) so REAPER stops playback cleanly
    if (projectEndSec !== undefined) {
      const maxLength = projectEndSec + ringOutSec - position;
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
