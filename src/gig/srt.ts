/**
 * Line captions as SRT, to upload beside a video (YouTube and the like) rather
 * than burn in. Each lyric line shows from its first word until the next line
 * starts, or until a second after its last word if the next line is further
 * off, so nothing hangs on screen through an instrumental.
 */

export interface CaptionLine {
  text: string;
  /** Video seconds. */
  words: { start: number; end: number }[];
}

/** How long a line stays after its last word when nothing follows soon. */
const HOLD_S = 1;
/** The longest row YouTube shows comfortably. */
const ROW_CHARS = 42;

export function captionsSrt(lines: CaptionLine[]): string {
  const shown = lines.filter((l) => l.words.length > 0);
  return shown
    .map((l, i) => {
      const start = l.words[0].start;
      const clear = l.words[l.words.length - 1].end + HOLD_S;
      const end = i + 1 < shown.length ? Math.min(shown[i + 1].words[0].start, clear) : clear;
      return `${i + 1}\n${stamp(start)} --> ${stamp(end)}\n${rows(l.text).join("\n")}\n`;
    })
    .join("\n");
}

/** Words packed into rows of at most ROW_CHARS (a longer single word gets a row of its own). */
function rows(text: string): string[] {
  const out: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = out[out.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= ROW_CHARS) out[out.length - 1] = `${last} ${word}`;
    else out.push(word);
  }
  return out;
}

function stamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms / 60000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`;
}

/** A word sung far from the one before it in its line: almost always a misalignment. */
export interface Stranded {
  /** Line and word, counting from 1. */
  line: number;
  word: number;
  /** Seconds of silence before the word, from the previous word's end to its start. */
  gap: number;
  from: number;
  to: number;
}

const STRANDED_S = 4;

/** Every word more than STRANDED_S from the word before it in the same line. */
export function strandedWords(lines: CaptionLine[]): Stranded[] {
  const round = (s: number) => Math.round(s * 1000) / 1000;
  return lines.flatMap((l, i) =>
    l.words.flatMap((w, k) => {
      const prev = l.words[k - 1];
      if (!prev || w.start - prev.end <= STRANDED_S) return [];
      return [{ line: i + 1, word: k + 1, gap: round(w.start - prev.end), from: prev.end, to: w.start }];
    }),
  );
}
