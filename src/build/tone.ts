/**
 * Pitch/prep-tone synthesis for cold vocal opens — a sustained note or chord the
 * singer can grab before entering, generated (not spoken) so it's reproducible.
 * Pure TS: summed sine partials into a 16-bit mono PCM WAV. No Piper, no Python.
 */

const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Note name ("F#3", "Bb4", "A4") → frequency in Hz. A4 = 440. */
export function noteToFreq(note: string): number {
  const m = note.trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!m) throw new Error(`bad note name: ${note}`);
  let semis = SEMITONE[m[1].toUpperCase()];
  if (m[2] === "#") semis += 1;
  else if (m[2] === "b") semis -= 1;
  const octave = parseInt(m[3], 10);
  const midi = semis + (octave + 1) * 12; // MIDI: C-1 = 0, C4 = 60, A4 = 69
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 16-bit PCM mono WAV (Buffer) of the given notes sounded together, with a short
 *  fade in/out so it doesn't click. */
export function chordWav(notes: string[], seconds: number, sampleRate = 44100): Buffer {
  const n = Math.max(1, Math.round(seconds * sampleRate));
  const freqs = notes.map(noteToFreq);
  const fade = Math.min(Math.round(0.01 * sampleRate), Math.floor(n / 2)); // ~10ms
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const f of freqs) s += Math.sin((2 * Math.PI * f * i) / sampleRate);
    s /= freqs.length || 1; // average the voices
    let env = 1;
    if (i < fade) env = i / fade;
    else if (i >= n - fade) env = (n - 1 - i) / fade;
    const v = Math.max(-1, Math.min(1, s * env * 0.7)); // 0.7 headroom
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return wrapWav(pcm, sampleRate);
}

/** Wrap raw 16-bit mono PCM in a canonical 44-byte WAV header. */
function wrapWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2; // mono, 2 bytes/sample
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
