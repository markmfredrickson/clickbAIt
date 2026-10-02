// Scene for <song>. A p5.js sketch in instance mode: call p5 functions on `p`
// (p.fill, p.circle, p.text, ...). Reference: https://p5js.org/reference/
//
// Draw only from `song.now()`, never from millis() or frameCount, so each
// frame is the same in the preview, the offline render and after a jump.
//
// Each frame, `const s = song.now()` gives:
//   s.f(stem, feature)        a stem's feature now, 0..1
//   s.f(stem, feature, beat)  the same at any beat, for looking ahead
//     stems:    vocals, drums, bass, other
//     features: loud    how loud the stem is
//               onset   a hit or new note starting (spiky)
//               bright  how bright the sound is (spectral centroid)
//               low     energy below 150 Hz (kick, bass)
//               mid     150 Hz to 2.5 kHz (snare body, voice)
//               high    above 2.5 kHz (hi-hat, cymbals, air)
//   s.t                       project time in seconds
//   s.beat                    song beat (0 = first downbeat; negative in the count-in)
//   s.phase                   how far through the current beat, 0..1
//   s.bar, s.beatInBar        bar within the section, beat within the bar (from 1)
//   s.measure                 bar of the song, as REAPER counts it
//   s.countIn                 true before the first downbeat
//   s.section                 { index, name, beat, progress } or null in the count-in;
//                             beat = beats into the section, progress = 0..1 through it
//   s.next                    { name, inBeats } for the next section, or null in the last
//
// Also on `song`: width, height, sections (each { name, start, end, bars, beatsPerBar }),
// and timeOf(beat), the project seconds of a beat, for cutting on beats.
//
// Preview while editing:  npm run visuals:preview -- <manifest> [--scene this-file]
// Render to video:        npm run visuals:render -- <manifest> [--scene this-file]

export default function scene(p, song) {
  p.setup = () => {
    p.createCanvas(song.width, song.height);
  };

  p.draw = () => {
    const s = song.now();
    p.background(0);
  };
}
