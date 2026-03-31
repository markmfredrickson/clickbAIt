import { song, seq, span, bars, lyric, audio } from "../../src/dsongl/index.js";

export default song("When the Saints Go Marching In", 108,
  { artist: "Louis Armstrong", key: "Bb", timeSignature: [4, 4] },

  seq(
    // 4-bar intro: title cue + count-in (no audio here)
    span("Intro", bars(4)),

    // Chorus 1 — vocal call-and-response
    span("Chorus 1", bars(16), { cue: true }, [
      // Audio: 78rpm recording, skip first 40s of announcer/instrumental intro
      audio("78rpm Recording", "tests/fixtures/audio/saints-78rpm.mp3", { soffs: 40 }),

      // Call-and-response lyrics
      lyric("Now, when them saints", 0, "Lead"),
      lyric("Well, when the saints", 2, "Response"),
      lyric("Go marchin' in", 4, "Lead"),
      lyric("Go marching in", 6, "Response"),
      lyric("When the saints go a-marchin' in", 8, "Lead"),
      lyric("Saints go marching in", 12, "Response"),
      lyric("Oh, to be in that number, number yeah", 16, "Lead"),
      lyric("Brother Billy and brother Tyree", 24, "Lead"),
      lyric("They're gonna get together there", 28, "Lead"),

      // Chord changes (standard 16-bar form in Bb)
      // I - I - I - I | I - I - I - V | I - I - IV - IV | I - V - I - I
    ]),

    // Instrumental — solos (banjo, piano, drums)
    span("Instrumental", bars(20), { cue: true }, [
      lyric("Brother and his banjo", 0, "Armstrong spoken"),
      lyric("Marty Napoleon and brother Catlett", 8, "Armstrong spoken"),
      lyric("Good deal there", 16, "Armstrong spoken"),
      lyric("Brother Catlett backin' him up", 24, "Armstrong spoken"),
      lyric("Danny Barcelona coming in", 40, "Armstrong spoken"),
      lyric("Watch this part here comin' up", 56, "Armstrong spoken"),
    ]),

    // Chorus 2 — vocals return
    span("Chorus 2", bars(16), { cue: true }, [
      lyric("Oh, when the saints", 0, "Lead"),
      lyric("Oh, when the saints", 2, "Response"),
      lyric("Marching in", 4, "Lead"),
      lyric("Marching in", 6, "Response"),
      lyric("When the saints go marchin' in", 8, "Lead"),
      lyric("Saints go marchin' in", 12, "Response"),
      lyric("Oh, long to be in that number, yeah", 16, "Lead"),
      lyric("When the saints go marching in", 24, "Lead"),
    ]),
  ),
);
