/**
 * Picking the next song from the prompter, as pure functions of the set list.
 *
 * Anyone on the band's wifi can drive this, so a request off the socket is
 * parsed into one of three shapes or dropped. "Next" is the one-tap path;
 * "prev" and a jump by name are there for when the set changes on the fly.
 *
 * REAPER holds the set as project tabs in set-list order, but its tab bar can
 * carry extra tabs in front (an untitled project, say), and it never says which
 * project is showing after a switch. So a switch is aimed at a tab, REAPER is
 * nudged into naming the song it landed on, and the answer is checked: a wrong
 * song tells us the offset, silence suggests one extra tab, and one retry is
 * all we try before saying so.
 */

export type SongIntent = { to: "next" } | { to: "prev" } | { to: "song"; slug: string };

export function parseSongIntent(raw: unknown): SongIntent | null {
  if (!raw || typeof raw !== "object") return null;
  const { to, slug } = raw as { to?: unknown; slug?: unknown };
  if (to === "next" || to === "prev") return { to };
  if (to === "song" && typeof slug === "string" && slug) return { to, slug };
  return null;
}

/** The set-list index to go to, or why not. */
export function targetSong(
  setlist: string[],
  current: string | undefined,
  intent: SongIntent,
): { index: number } | { reject: string } {
  if (intent.to === "song") {
    const index = setlist.indexOf(intent.slug);
    return index >= 0 ? { index } : { reject: `${intent.slug} is not in the set list` };
  }
  if (current === undefined) return intent.to === "next" ? { index: 0 } : { reject: "no song is showing yet" };
  const at = setlist.indexOf(current);
  if (at < 0) return { reject: `${current} is not in the set list` };
  const index = intent.to === "next" ? at + 1 : at - 1;
  if (index < 0) return { reject: "already at the first song" };
  if (index >= setlist.length) return { reject: "already at the last song" };
  return { index };
}

/** One try at reaching set-list song `target`: the 1-based tab, assuming `offset` extra tabs in front. */
export interface SwitchAttempt {
  target: number;
  tab: number;
  offset: number;
  retried: boolean;
}

export function firstAttempt(target: number, offset: number): SwitchAttempt {
  return { target, tab: target + 1 + offset, offset, retried: false };
}

/** What to do once REAPER has named the song in the tab (`null` if it said nothing). */
export function afterReport(
  a: SwitchAttempt,
  reported: string | null,
  setlist: string[],
): { done: true; offset: number } | { retry: SwitchAttempt } | { error: string } {
  if (reported === setlist[a.target]) return { done: true, offset: a.offset };
  if (a.retried) {
    return { error: `tab ${a.tab} holds ${reported ?? "no song"}, not ${setlist[a.target]}` };
  }
  let offset: number;
  if (reported === null) {
    offset = a.offset + 1;
  } else {
    const at = setlist.indexOf(reported);
    if (at < 0) return { error: `tab ${a.tab} holds ${reported}, which is not in the set list` };
    offset = a.tab - (at + 1);
  }
  return { retry: { target: a.target, tab: a.target + 1 + offset, offset, retried: true } };
}
