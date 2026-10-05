/**
 * The card a display shows before a song: the song's notes for this screen
 * (setup reminders, banter) and a reminder of what each part plays: a
 * chart's repeated phrases, or a score's opening row. It shows while
 * the song sits at its start, and goes once playback moves into the lead-in
 * (the spoken title and count-in before the downbeat), so the count-in plays
 * with the panes up and the downbeat can be seen coming.
 *
 * Notes are written in a text file beside the manifest, under headings that
 * say who they're for:
 *
 *   [all]       everyone
 *   [guitar]    an instrument: the screens showing that part, or asking for
 *               it (?role=guitar)
 *   [banter]    what the singer says: screens showing the lyrics or the
 *               vocal part
 *
 * This module runs in the browser too; the build reads the file with it.
 */

import type { RowChannel } from "./rows.js";

export interface Note {
  /** Who it's for: "all", "banter", or an instrument, lowercase. */
  for: string;
  text: string;
}

/** Read a notes file: its headings and the text under each. */
export function parseNotes(text: string): { notes: Note[]; errors: string[] } {
  const notes: Note[] = [];
  const errors: string[] = [];
  // The heading being read; a bad one (no name) swallows its text, reported once.
  let current: { for: string; lines: string[] } | null = null;
  const close = () => {
    const body = current?.lines.join("\n").trim();
    if (current && current.for && body) notes.push({ for: current.for, text: body });
  };
  text.split(/\r?\n/).forEach((line, i) => {
    const heading = line.match(/^\s*\[(.*)\]\s*$/);
    if (heading) {
      close();
      const name = heading[1].trim().toLowerCase();
      if (!name) {
        errors.push(`line ${i + 1}: a heading needs a name, such as [guitar]`);
        current = { for: "", lines: [] };
        return;
      }
      current = { for: name, lines: [] };
      return;
    }
    if (current) current.lines.push(line);
    else if (line.trim()) errors.push(`line ${i + 1}: text before the first heading (start with one, such as "[all]")`);
  });
  close();
  return { notes, errors };
}

/**
 * The notes for a screen: those for everyone, for the parts it shows (and
 * the role it asks for), and the banter when it shows the lyrics or the vocal
 * part. In the file's order.
 */
export function notesFor(notes: readonly Note[], shown: readonly RowChannel[], role?: string): Note[] {
  const parts = new Set(
    shown.flatMap((c) => (c.kind === "figures" || c.kind === "score" ? [c.instrument.toLowerCase()] : [])),
  );
  if (role) parts.add(role.toLowerCase());
  const singer = shown.some((c) => c.kind === "lyrics") || parts.has("vocals");
  return notes.filter((n) => n.for === "all" || parts.has(n.for) || (n.for === "banter" && singer));
}

/** How far past the song's start the position can be and still be "at the start". */
const AT_START = 0.5;

/**
 * Whether the card shows at `beat` (null: no beat yet, as when a song has
 * just loaded): while the position is at the song's start, `startBeat` (the
 * lead-in's first beat, before the downbeat).
 */
export function cardShowing(beat: number | null, startBeat: number): boolean {
  return beat === null || beat < startBeat + AT_START;
}
