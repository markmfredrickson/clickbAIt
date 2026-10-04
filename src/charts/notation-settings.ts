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
 * follows the file over the stave profile. A drum chart drops the key
 * signature, which a drum staff has no use for but some files carry.
 */
export function showStaves(
  score: { tracks: { staves: { showTablature: boolean; showStandardNotation: boolean; bars: { keySignature: number }[] }[] }[] },
  track: number,
  chart: ChartKind,
): void {
  for (const staff of score.tracks[track]?.staves ?? []) {
    staff.showTablature = chart === "tab" || chart === "staff-tab";
    staff.showStandardNotation = chart !== "tab";
    // 0 is alphaTab's KeySignature.C: no sharps or flats.
    if (chart === "drums") for (const bar of staff.bars) bar.keySignature = 0;
  }
}

interface ModelBeat {
  voice: { bar: { index: number } };
  notes: ModelNote[];
  isEffectSlurOrigin: boolean;
  effectSlurOrigin: ModelBeat | null;
  effectSlurDestination: ModelBeat | null;
}

interface ModelNote {
  beat: ModelBeat;
  isTieDestination: boolean;
  tieOrigin: ModelNote | null;
  tieDestination: ModelNote | null;
  slideOrigin: ModelNote | null;
  slideTarget: ModelNote | null;
  isHammerPullOrigin: boolean;
  hammerPullOrigin: ModelNote | null;
  hammerPullDestination: ModelNote | null;
  isEffectSlurOrigin: boolean;
  effectSlurOrigin: ModelNote | null;
  effectSlurDestination: ModelNote | null;
}

interface ModelScore {
  tracks: { staves: { bars: { voices: { beats: ModelBeat[] }[] }[] }[] }[];
}

/**
 * Cut the ties, slides, hammer-ons and the slurs over them that cross into or
 * out of a drawing of bars `start`… (`count` of them): alphaTab can't draw one
 * whose other end isn't in the drawing. A chart shows bars out of context, so
 * a note tied over a drawing's edge is drawn as a plain note. Every bar of the
 * drawing is checked, since a chain of hammer-ons can reach past several.
 */
export function detachRange(score: ModelScore, track: number, start: number, count: number): void {
  const first = start - 1;
  const last = start + count - 2;
  const outsideBar = (index: number) => index < first || index > last;
  const outside = (n: ModelNote | null) => !!n && outsideBar(n.beat.voice.bar.index);
  const outsideBeat = (b: ModelBeat | null) => !!b && outsideBar(b.voice.bar.index);
  for (const staff of score.tracks[track]?.staves ?? []) {
    for (const bar of staff.bars.slice(first, last + 1)) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          if (outsideBeat(beat.effectSlurOrigin)) beat.effectSlurOrigin = null;
          if (outsideBeat(beat.effectSlurDestination)) {
            beat.effectSlurDestination = null;
            beat.isEffectSlurOrigin = false;
          }
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
            if (outside(note.effectSlurOrigin)) note.effectSlurOrigin = null;
            if (outside(note.effectSlurDestination)) {
              note.effectSlurDestination = null;
              note.isEffectSlurOrigin = false;
            }
          }
        }
      }
    }
  }
}
