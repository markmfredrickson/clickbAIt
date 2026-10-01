/**
 * alphaTab settings for drawing bars of a chart, shared by the browser
 * (client/notation.ts) and the bundle builder's pre-render (notation-svg.ts),
 * so a staff looks the same wherever it's drawn: the notes, and the lyrics
 * under them when the track has any (so a vocal score shows what's sung),
 * without the score's titles, tempo, markers, text or dynamics, inked in `color`
 * ("#rrggbb"), close-padded so a chart's bars sit near each other.
 *
 * The chart's kind picks the staff: `tab` is tab with the rhythm under it
 * (tab alone can't show rhythm), `staff` standard notation, `staff-tab` both,
 * and `drums` percussion notation.
 */

import type { ChartKind } from "../teleprompter/rows.js";

const PROFILE: Record<ChartKind, string> = { tab: "tab", staff: "score", "staff-tab": "scoreTab", drums: "score" };

export function chartSettings(
  chart: ChartKind,
  startBar: number,
  barCount: number,
  color: string,
  fontDirectory?: string,
): Record<string, unknown> {
  return {
    core: { useWorkers: false, enableLazyLoading: false, engine: "svg", ...(fontDirectory ? { fontDirectory } : {}) },
    display: {
      startBar,
      barCount,
      layoutMode: "horizontal",
      staveProfile: PROFILE[chart],
      // Size comes from the page (CSS zoom); alphaTab's own scale enlarges the
      // drawing but not its container, cutting off the right edge.
      scale: 1,
      // alphaTab's default is 35px all round; a chart wants its bars close together.
      padding: [4, 4],
      resources: {
        staffLineColor: color,
        barSeparatorColor: color,
        barNumberColor: color,
        mainGlyphColor: color,
        secondaryGlyphColor: color,
        scoreInfoColor: color,
      },
    },
    notation: {
      rhythmMode: chart === "tab" ? "showWithBars" : "hidden",
      elements: {
        scoreTitle: false, scoreSubTitle: false, scoreArtist: false, scoreAlbum: false,
        scoreWords: false, scoreMusic: false, scoreWordsAndMusic: false, scoreCopyright: false,
        guitarTuning: false, trackNames: false,
        effectTempo: false, effectMarker: false, effectText: false, effectDynamics: false,
      },
    },
    player: { enablePlayer: false },
  };
}

/**
 * Make `track`'s staves show what the chart's kind says, whatever the score
 * file chose: a file can set a guitar staff to tab only, and alphaTab
 * follows the file over the stave profile.
 */
export function showStaves(score: { tracks: { staves: { showTablature: boolean; showStandardNotation: boolean }[] }[] }, track: number, chart: ChartKind): void {
  for (const staff of score.tracks[track]?.staves ?? []) {
    staff.showTablature = chart === "tab" || chart === "staff-tab";
    staff.showStandardNotation = chart !== "tab";
  }
}

interface ModelNote {
  beat: { voice: { bar: { index: number } } };
  isTieDestination: boolean;
  tieOrigin: ModelNote | null;
  tieDestination: ModelNote | null;
  slideOrigin: ModelNote | null;
  slideTarget: ModelNote | null;
  isHammerPullOrigin: boolean;
  hammerPullOrigin: ModelNote | null;
  hammerPullDestination: ModelNote | null;
}

interface ModelScore {
  tracks: { staves: { bars: { voices: { beats: { notes: ModelNote[] }[] }[] }[] }[] }[];
}

/**
 * Cut the ties, slides and hammer-ons that cross into or out of a drawing of
 * bars `start`… (`count` of them): alphaTab can't draw one whose other end
 * isn't in the drawing. A chart shows bars out of context, so a note tied
 * over a drawing's edge is drawn as a plain note.
 */
export function detachRange(score: ModelScore, track: number, start: number, count: number): void {
  const first = start - 1;
  const last = start + count - 2;
  const outside = (n: ModelNote | null) => !!n && (n.beat.voice.bar.index < first || n.beat.voice.bar.index > last);
  for (const staff of score.tracks[track]?.staves ?? []) {
    for (const index of new Set([first, last])) {
      for (const voice of staff.bars[index]?.voices ?? []) {
        for (const beat of voice.beats) {
          for (const note of beat.notes) {
            if (outside(note.tieOrigin)) {
              note.tieOrigin = null;
              note.isTieDestination = false;
            }
            if (outside(note.tieDestination)) note.tieDestination = null;
            if (outside(note.slideOrigin)) note.slideOrigin = null;
            if (outside(note.slideTarget)) note.slideTarget = null;
            if (outside(note.hammerPullOrigin)) note.hammerPullOrigin = null;
            if (outside(note.hammerPullDestination)) {
              note.hammerPullDestination = null;
              note.isHammerPullOrigin = false;
            }
          }
        }
      }
    }
  }
}
