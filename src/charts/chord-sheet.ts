/**
 * A chord sheet: chord names written over the lyrics they're played on, the
 * way a songbook or a guitar tab site prints them, with `[Section]` headers.
 *
 *   [Verse]
 *   F#m7          Bm7
 *   words of the first line
 *
 * A sheet only drafts a song's chord file (see authoring/chords-draft-cli.ts):
 * where a chord name sits over the lyrics is rough at best, so the placement
 * is coarse and a person nudges the result against the recording.
 *
 * Placing a chord on the song's beat grid:
 *
 * - A chord over a word goes in the bar where that word is sung, from the
 *   lyric alignment, or in the next bar if the word comes in the bar's last
 *   beat (singers anticipate). A chord over a space belongs to the next word.
 *   The chords sung in one bar split it evenly.
 * - A chord with no word under it (past the end of the line, or on a line of
 *   chords alone) plays half a bar after the chord before it, in the meter
 *   where that chord falls.
 * - A line of chords alone that follows a `[Section]` header starts on that
 *   section's first beat. The header must name one of the song's sections;
 *   the second `[Intro]` is the song's second Intro.
 * - Bar lines (`| E | C#m D |`) on a line of chords alone give each bar
 *   explicitly, starting on the next bar; its chords split the bar evenly.
 *
 * The sheet's lyrics are matched word by word against the song's sung words,
 * ignoring case, punctuation and line breaks. Anything that doesn't line up
 * is an error, as is a chord that would land at or before the one before it.
 */

import type { SongSection } from "./bar-map.js";

export type SheetLine =
  | { kind: "header"; line: number; name: string }
  /** Chords alone. `bars` is present when the line has bar lines. */
  | { kind: "instrumental"; line: number; chords: string[]; bars?: string[][] }
  /** A lyric line, with the chords written over it by column. The chords'
   *  own line is the one above, `line - 1`. */
  | { kind: "lyric"; line: number; text: string; chords: { chord: string; col: number }[]; barLines?: true };

export interface PlacedChord {
  chord: string;
  beat: number;
  /** 1-based line of the sheet the chord is written on. */
  line: number;
  /** Index into the song's words of the word the chord is over, if any. */
  word?: number;
}

const CHORD =
  /^(?:[A-G][b#]?(?:maj|min|m|M|dim|aug|sus|add|\+|°|ø|b|#|\d)*(?:\([^)]*\))?(?:\/[A-G][b#]?)?|N\.?C\.?)$/;
const HEADER = /^\s*\[(.+)\]\s*$/;

/** Chord names on a line and their columns; bar lines are separators. */
function chordTokens(line: string): { chord: string; col: number }[] {
  return [...line.matchAll(/[^\s|]+/g)].map((m) => ({ chord: m[0], col: m.index! }));
}

function isChordLine(line: string): boolean {
  const tokens = chordTokens(line);
  return tokens.length > 0 && tokens.every((t) => CHORD.test(t.chord));
}

export function parseChordSheet(text: string): SheetLine[] {
  const lines = text.split(/\r?\n/);
  const out: SheetLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = i + 1;
    if (raw.trim() === "") continue;
    const header = HEADER.exec(raw);
    if (header) {
      out.push({ kind: "header", line, name: header[1].trim() });
      continue;
    }
    if (!isChordLine(raw)) {
      out.push({ kind: "lyric", line, text: raw, chords: [] });
      continue;
    }
    const next = lines[i + 1];
    const overLyrics = next !== undefined && next.trim() !== "" && !HEADER.test(next) && !isChordLine(next);
    const hasBarLines = raw.includes("|");
    if (overLyrics) {
      out.push({ kind: "lyric", line: line + 1, text: next, chords: chordTokens(raw), ...(hasBarLines ? { barLines: true as const } : {}) });
      i++;
      continue;
    }
    const chords = chordTokens(raw).map((t) => t.chord);
    const bars = raw
      .split("|")
      .map((seg) => seg.trim().split(/\s+/).filter(Boolean))
      .filter((bar) => bar.length > 0);
    out.push({ kind: "instrumental", line, chords, ...(hasBarLines ? { bars } : {}) });
  }
  return out;
}

/** What a word is compared on: letters only, lowercase. */
const norm = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "");

const fmt = (beat: number) => String(Math.round(beat * 1000) / 1000);

export function placeChords(
  text: string,
  song: { sections: readonly SongSection[]; words: readonly { text: string; startBeat: number }[] },
): { chords: PlacedChord[]; errors: string[] } {
  const { sections, words } = song;
  const errors: string[] = [];
  const chords: PlacedChord[] = [];

  const sectionAt = (beat: number) => {
    let found = sections[0];
    for (const s of sections) if (s.startBeat <= beat + 1e-9) found = s;
    return found;
  };
  const beatsPerBar = (beat: number) => sectionAt(beat)?.beatsPerBar ?? 4;
  const barStart = (beat: number) => {
    const s = sectionAt(beat);
    if (!s) return beat;
    return s.startBeat + Math.floor((beat - s.startBeat) / s.beatsPerBar + 1e-9) * s.beatsPerBar;
  };

  // Where the next chord with no word under it goes; null until something
  // places it (a section header or an earlier chord).
  let cursor: number | null = null;
  const put = (chord: string, beat: number, line: number, word?: number) => {
    const prev = chords[chords.length - 1];
    if (prev && beat <= prev.beat + 1e-9) {
      errors.push(`line ${line}: "${chord}" lands at beat ${fmt(beat)}, not after "${prev.chord}" (line ${prev.line}, beat ${fmt(prev.beat)})`);
    }
    chords.push(word === undefined ? { chord, beat, line } : { chord, beat, line, word });
    cursor = beat + beatsPerBar(beat) / 2;
  };

  // Chords sung in the same bar wait here until the bar is complete, then
  // split it evenly.
  let open: { start: number; chords: { chord: string; line: number; word: number }[] } | null = null;
  const closeBar = () => {
    if (!open) return;
    const { start, chords: inBar } = open;
    const length = beatsPerBar(start);
    inBar.forEach((c, k) => put(c.chord, start + (k * length) / inBar.length, c.line, c.word));
    open = null;
  };
  /** The bar a word's chord goes in: where it's sung, or the next bar if it's sung in the last beat. */
  const barFor = (beat: number) => {
    const start = barStart(beat);
    const length = beatsPerBar(beat);
    return length > 1 && beat - start >= length - 1 - 1e-9 ? start + length : start;
  };

  const headerCounts = new Map<string, number>();
  let header: { name: string; line: number; occurrence: number } | null = null;
  // An instrumental line right after a header starts at that header's section.
  let afterHeader = false;
  // After a placement error, the rest of the block has nothing to go on.
  let lost = false;

  let wordIndex = 0;
  let wordsOff = false; // stop comparing after the first mismatch

  for (const el of parseChordSheet(text)) {
    if (el.kind === "header") {
      const occurrence = (headerCounts.get(el.name) ?? 0) + 1;
      headerCounts.set(el.name, occurrence);
      header = { name: el.name, line: el.line, occurrence };
      afterHeader = true;
      lost = false;
      continue;
    }

    if (el.kind === "instrumental") {
      closeBar();
      if (afterHeader && header) {
        const named = sections.filter((s) => s.name === header!.name);
        const section = named.find((s) => s.occurrence === header!.occurrence);
        if (section) {
          cursor = section.startBeat;
        } else {
          errors.push(
            named.length === 0
              ? `line ${header.line}: no section "${header.name}" (the song has ${[...new Set(sections.map((s) => s.name))].join(", ")})`
              : `line ${header.line}: the song has only ${named.length} "${header.name}" section${named.length > 1 ? "s" : ""}`,
          );
          lost = true;
        }
      } else if (cursor === null && !lost) {
        errors.push(`line ${el.line}: chords with no lyrics under them need a [Section] header first`);
        lost = true;
      }
      afterHeader = false;
      if (lost || cursor === null) continue;

      if (el.bars) {
        // Bar lines start a new bar.
        let start: number = barStart(cursor!);
        if (cursor! > start + 1e-9) start += beatsPerBar(start);
        for (const bar of el.bars) {
          const length = beatsPerBar(start);
          const at = start;
          bar.forEach((chord, k) => put(chord, at + (k * length) / bar.length, el.line));
          start += length;
          cursor = start;
        }
      } else {
        for (const chord of el.chords) put(chord, cursor!, el.line);
      }
      continue;
    }

    // A lyric line: match its words, then place its chords on them.
    afterHeader = false;
    lost = false;
    const chordLine = el.line - 1;
    if (el.barLines) errors.push(`line ${chordLine}: bar lines only work on a line of chords with no lyrics under it`);
    const spans = [...el.text.matchAll(/[a-z']+/gi)]
      .map((m) => ({ text: m[0], end: m.index! + m[0].length }))
      .filter((s) => norm(s.text) !== "");
    const base = wordIndex;
    spans.forEach((span, j) => {
      if (wordsOff) return;
      const sung = words[base + j];
      if (!sung) {
        errors.push(`line ${el.line}: the sheet's lyrics go on after the song's last sung word`);
        wordsOff = true;
      } else if (norm(sung.text) !== norm(span.text)) {
        errors.push(`line ${el.line}: the sheet has "${span.text}" where the song sings "${sung.text}" (word ${base + j + 1})`);
        wordsOff = true;
      }
    });
    for (const { chord, col } of el.chords) {
      const j = spans.findIndex((s) => s.end > col);
      const word = j >= 0 ? base + j : -1;
      if (word >= 0 && word < words.length) {
        const bar = barFor(words[word].startBeat);
        if (open && open.start === bar) {
          open.chords.push({ chord, line: chordLine, word });
          continue;
        }
        closeBar();
        const prev = chords[chords.length - 1];
        if (prev && prev.beat >= bar - 1e-9) {
          errors.push(`line ${chordLine}: "${chord}" is sung in the bar at beat ${fmt(bar)}, but "${prev.chord}" (line ${prev.line}) is already at beat ${fmt(prev.beat)}`);
          break; // the rest of the line would only repeat it

        }
        open = { start: bar, chords: [{ chord, line: chordLine, word }] };
      } else {
        closeBar();
        if (cursor !== null) put(chord, cursor, chordLine);
        else errors.push(`line ${chordLine}: "${chord}" has no word under it and no chord before it`);
      }
    }
    wordIndex += spans.length;
  }
  closeBar();

  if (!wordsOff && wordIndex < words.length) {
    errors.push(`the sheet's lyrics stop after word ${wordIndex} of the song's ${words.length}`);
  }
  return { chords, errors };
}
