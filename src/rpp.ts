import type { Song } from "./dsongl/index.js";
import type { Section } from "./sections.js";

interface TimelineBar {
  beatStart: number;      // cumulative beat position (for internal use)
  secondsStart: number;   // cumulative seconds position (used in RPP output)
  beats: number;
  bpmMultiplier: number;
  sectionName?: string;
  sectionEndSeconds?: number;
  regionColor?: number;
}

/** Walk the song structure and produce a flat list of bars with beat and second positions. */
export function buildTimeline(song: Song): TimelineBar[] {
  const defaultBeats = song.defaultBeats ?? 4;
  const leadInBars = song.leadInBars ?? 0;
  const masterBpm = song.masterBpm;
  const timeline: TimelineBar[] = [];
  let beatCursor = 0;
  let secondsCursor = 0;

  function advanceBar(beats: number, bpmMultiplier: number): void {
    beatCursor += beats;
    secondsCursor += (beats / (masterBpm * bpmMultiplier)) * 60;
  }

  for (let i = 0; i < leadInBars; i++) {
    timeline.push({ beatStart: beatCursor, secondsStart: secondsCursor, beats: defaultBeats, bpmMultiplier: 1.0 });
    advanceBar(defaultBeats, 1.0);
  }

  for (const section of song.sections) {
    const sectionStartSeconds = secondsCursor;
    let firstBar = true;

    // Compute section end in seconds
    let scanBeats = beatCursor;
    let scanSeconds = secondsCursor;
    for (const bar of section.bars) {
      const beats = bar.beats ?? defaultBeats;
      const repeat = bar.repeat ?? 1;
      const mult = bar.bpmMultiplier ?? 1.0;
      scanBeats += beats * repeat;
      scanSeconds += (beats * repeat / (masterBpm * mult)) * 60;
    }
    const sectionEndSeconds = section.endBeat !== undefined
      ? sectionStartSeconds + (section.endBeat / (masterBpm * (section.bars[section.bars.length - 1].bpmMultiplier ?? 1.0))) * 60
      : scanSeconds;

    for (const bar of section.bars) {
      const beats = bar.beats ?? defaultBeats;
      const repeat = bar.repeat ?? 1;
      const bpmMultiplier = bar.bpmMultiplier ?? 1.0;

      for (let r = 0; r < repeat; r++) {
        timeline.push({
          beatStart: beatCursor,
          secondsStart: secondsCursor,
          beats,
          bpmMultiplier,
          ...(firstBar && r === 0
            ? { sectionName: section.name, sectionEndSeconds, regionColor: section.color ?? 1 }
            : {}),
        });
        advanceBar(beats, bpmMultiplier);
        firstBar = false;
      }
    }
  }

  return timeline;
}

/** Encode beats-per-bar as REAPER's metronome pattern number (10...01 in binary). */
export function patternNum(beats: number): number {
  let v = 0;
  for (let i = 0; i < beats - 1; i++) v = (v << 2) | 2;
  return (v << 2) | 1;
}

/** Encode beats-per-bar as REAPER's pattern string (A followed by n-1 Bs). */
export function patternStr(beats: number): string {
  return "A" + "B".repeat(beats - 1);
}

/** REAPER's timesig flags encoding: 262144 + beats-per-bar. */
export function timesigFlags(beats: number): number {
  return 262144 + beats;
}

/** Format a position to REAPER's 12-decimal precision. */
function fmtPos(n: number): string {
  return n.toFixed(12);
}

/** Format a BPM to REAPER's 10-decimal precision. */
function fmtBpm(n: number): string {
  return n.toFixed(10);
}

/** Format a simple number, dropping unnecessary decimals. */
function fmt(n: number): string {
  return parseFloat(n.toFixed(6)).toString();
}

/** Quote a string only if it contains spaces or special characters. */
function rppStr(s: string): string {
  return /[\s"{}]/.test(s) ? `"${s}"` : s;
}

/** Generate a random REAPER-style GUID string like {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}. */
function newGuid(): string {
  const raw = crypto.randomUUID().toUpperCase().replace(/-/g, "");
  return `{${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}}`;
}

export function generateRpp(song: Song): string {
  const timeline = buildTimeline(song);
  const masterBpm = song.masterBpm;
  const defaultBeats = song.defaultBeats ?? 4;

  // --- Tempo envelope points (positions in seconds) ---
  const tempoPoints: string[] = [];
  let lastMultiplier: number | null = null;
  let lastBeats: number | null = null;

  for (const bar of timeline) {
    if (bar.bpmMultiplier !== lastMultiplier || bar.beats !== lastBeats) {
      const effectiveBpm = masterBpm * bar.bpmMultiplier;
      const flags = timesigFlags(bar.beats);
      const pNum = patternNum(bar.beats);
      const pStr = patternStr(bar.beats);
      tempoPoints.push(
        `PT ${fmtPos(bar.secondsStart)} ${fmtBpm(effectiveBpm)} 1 ${flags} 0 1 0 "" 0 ${pNum} 0 ${pStr}`
      );
      lastMultiplier = bar.bpmMultiplier;
      lastBeats = bar.beats;
    }
  }

  // --- Region markers (positions in seconds) ---
  const markerLines: string[] = [];
  let regionId = 1;

  for (const bar of timeline) {
    if (bar.sectionName !== undefined && bar.sectionEndSeconds !== undefined) {
      const color = bar.regionColor ?? 1;
      markerLines.push(
        `MARKER ${regionId} ${fmt(bar.secondsStart)} ${rppStr(bar.sectionName)} ${color} 0 1 B ${newGuid()} 0 1`
      );
      markerLines.push(`MARKER ${regionId} ${fmt(bar.sectionEndSeconds)} "" ${color}`);
      regionId++;
    }
  }

  const tempoEnvLines = [
    `EGUID ${newGuid()}`,
    "ACT 1 -1",
    "VIS 1 0 1",
    "LANEHEIGHT 0 0",
    "ARM 0",
    "DEFSHAPE 1 -1 -1",
    ...tempoPoints,
  ].map((l) => "  " + l).join("\n");

  const lines = [
    `TEMPO ${fmt(masterBpm)} ${defaultBeats} 4 0`,
    `<TEMPOENVEX\n${tempoEnvLines}\n>`,
    ...markerLines,
  ];

  const inner = lines.map((l) => "  " + l).join("\n");
  return `<REAPER_PROJECT 0.1 "7.65/macOS-arm64" 0 0\n${inner}\n>`;
}
