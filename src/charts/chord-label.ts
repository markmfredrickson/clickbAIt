/**
 * Chord labels: reading them, showing them, transposing them.
 *
 * Two spellings are accepted, each read strictly:
 *
 * - Harte labels, the music-research standard that chord detectors and
 *   `.lab` annotations use: `A:maj7`, `F#:min7`, `E:maj/3` (the bass is a
 *   degree above the root), `N` for no chord. A bare root means major.
 * - Plain chord names as a chart prints them: `Amaj7`, `F#m7`, `E/G#`, `N.C.`.
 *
 * `X` (a detector's "unknown") and anything else unreadable is an error, so it
 * gets fixed in the file instead of showing up on stage.
 */

const LETTERS = "CDEFGAB";
const NATURAL = [0, 2, 4, 5, 7, 9, 11];

interface Note {
  letter: number; // index into LETTERS
  acc: number; // sharps positive, flats negative
}

type Chord = { root: Note; suffix: string; bass?: Note } | "none";

/** Harte shorthand → the suffix a chart prints. */
const SHORTHANDS: Record<string, string> = {
  maj: "", min: "m", dim: "dim", aug: "aug",
  maj7: "maj7", min7: "m7", "7": "7", dim7: "dim7", hdim7: "m7b5", minmaj7: "m(maj7)",
  maj6: "6", min6: "m6", "9": "9", maj9: "maj9", min9: "m9",
  "11": "11", min11: "m11", "13": "13", maj13: "maj13", min13: "m13",
  sus2: "sus2", sus4: "sus4",
};
const SHORTHAND_FOR = Object.fromEntries(Object.entries(SHORTHANDS).map(([k, v]) => [v, k]));

/** Semitones above the root of each scale degree, major-scale based. */
const DEGREE_SEMITONES: Record<number, number> = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 14, 11: 17, 13: 21 };

const pc = (n: Note) => (((NATURAL[n.letter] + n.acc) % 12) + 12) % 12;
const noteName = (n: Note) => LETTERS[n.letter] + (n.acc > 0 ? "#".repeat(n.acc) : "b".repeat(-n.acc));

function parseNote(s: string): Note | null {
  const m = /^([A-G])([#b]*)$/.exec(s);
  if (!m) return null;
  const acc = [...m[2]].reduce((a, c) => a + (c === "#" ? 1 : -1), 0);
  return { letter: LETTERS.indexOf(m[1]), acc };
}

/** The note a Harte bass degree (`3`, `b7`) names above a root. */
function degreeNote(root: Note, degree: string): Note | null {
  const m = /^([#b]*)(\d+)$/.exec(degree);
  if (!m) return null;
  const n = Number(m[2]);
  const semis = DEGREE_SEMITONES[n];
  if (semis === undefined) return null;
  const shift = [...m[1]].reduce((a, c) => a + (c === "#" ? 1 : -1), 0);
  const letter = (root.letter + n - 1) % 7;
  const target = pc(root) + semis + shift;
  let acc = (((target - NATURAL[letter]) % 12) + 12) % 12;
  if (acc > 6) acc -= 12;
  return { letter, acc };
}

/** The Harte degree (`3`, `b7`) of a bass note above a root, or null. */
function noteDegree(root: Note, bass: Note): string | null {
  const steps = (bass.letter - root.letter + 7) % 7;
  const n = steps + 1;
  let diff = (((pc(bass) - pc(root) - DEGREE_SEMITONES[n]) % 12) + 12) % 12;
  if (diff > 6) diff -= 12;
  if (Math.abs(diff) > 2) return null;
  return (diff > 0 ? "#".repeat(diff) : "b".repeat(-diff)) + n;
}

const PLAIN_SUFFIX = /^(?:maj|min|m|M|dim|aug|sus|add|\+|°|ø|b|#|\d)*(?:\([^)]*\))?$/;

function parse(label: string): Chord {
  const s = label.trim();
  if (s === "N" || /^N\.?C\.?$/.test(s)) return "none";
  if (s === "X") throw new Error(`chord "X" is unknown; replace it with a chord or N`);

  const harte = /^([A-G][#b]*)(?::([A-Za-z0-9]+))?(?:\/([#b]*\d+))?$/.exec(s);
  if (harte && (s.includes(":") || harte[3] !== undefined || harte[2] === undefined)) {
    const root = parseNote(harte[1]);
    const suffix = harte[2] === undefined ? "" : SHORTHANDS[harte[2]];
    if (!root || suffix === undefined) throw new Error(`can't read chord "${label}"`);
    if (harte[3] === undefined) return { root, suffix };
    const bass = degreeNote(root, harte[3]);
    if (!bass) throw new Error(`can't read the bass degree in chord "${label}"`);
    return { root, suffix, bass };
  }

  const plain = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/.exec(s);
  if (plain && !s.includes(":")) {
    const root = parseNote(plain[1]);
    const bass = plain[3] === undefined ? undefined : parseNote(plain[3]);
    if (root && bass !== null && PLAIN_SUFFIX.test(plain[2])) {
      return bass ? { root, suffix: plain[2], bass } : { root, suffix: plain[2] };
    }
  }
  throw new Error(`can't read chord "${label}"`);
}

function show(chord: Chord): string {
  if (chord === "none") return "N.C.";
  return noteName(chord.root) + chord.suffix + (chord.bass ? "/" + noteName(chord.bass) : "");
}

/** A chord label, Harte or plain, as a chart shows it. Throws on anything unreadable. */
export function chordName(label: string): string {
  return show(parse(label));
}

/** Whether a key is spelled with flats: F major, any flat tonic, or D/G/C/F minor. */
function flatKey(key: string): boolean {
  const m = /^\s*([A-Ga-g])([#b]?)\s*(m(?:in(?:or)?)?)?/.exec(key);
  if (!m) throw new Error(`can't read key "${key}"`);
  const letter = m[1].toUpperCase();
  if (m[2] === "b") return true;
  if (m[2] === "#") return false;
  return m[3] ? "DGCF".includes(letter) : letter === "F";
}

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** A chord label moved by `steps` semitones, spelled for the target key. */
export function transposeChord(label: string, steps: number, key: string): string {
  const chord = parse(label);
  if (chord === "none") return show(chord);
  const names = flatKey(key) ? FLATS : SHARPS;
  const move = (n: Note) => parseNote(names[(((pc(n) + steps) % 12) + 12) % 12])!;
  return show({ root: move(chord.root), suffix: chord.suffix, ...(chord.bass ? { bass: move(chord.bass) } : {}) });
}

/**
 * A chord name as a Harte label, for writing `.lab` files. A name whose suffix
 * has no Harte shorthand, or whose bass isn't a plain degree, stays as written;
 * `chordName` reads it back either way.
 */
export function toHarte(name: string): string {
  const chord = parse(name);
  if (chord === "none") return "N";
  const shorthand = SHORTHAND_FOR[chord.suffix];
  if (shorthand === undefined) return name;
  const degree = chord.bass ? noteDegree(chord.root, chord.bass) : null;
  if (chord.bass && !degree) return name;
  return `${noteName(chord.root)}:${shorthand}${degree ? "/" + degree : ""}`;
}
