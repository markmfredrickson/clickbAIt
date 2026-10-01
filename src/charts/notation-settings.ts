/**
 * alphaTab settings for drawing one bar of a chart, shared by the browser
 * (client/notation.ts) and the bundle builder's pre-render (notation-svg.ts),
 * so a staff looks the same wherever it's drawn: the notes only, without the
 * score's titles, tempo, markers, text or dynamics, inked in `color`
 * ("#rrggbb"), close-padded so a chart's bars sit near each other.
 */
export function barSettings(bar: number, color: string, fontDirectory?: string): Record<string, unknown> {
  return {
    core: { useWorkers: false, enableLazyLoading: false, engine: "svg", ...(fontDirectory ? { fontDirectory } : {}) },
    display: {
      startBar: bar,
      barCount: 1,
      layoutMode: "horizontal",
      staveProfile: "score",
      scale: 1.1,
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
