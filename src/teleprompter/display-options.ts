/**
 * A display's options, carried in its URL so a setup is a link: open it on
 * another screen and it looks the same.
 *
 *   /prompt?panes=2&split=vertical&view=drums&view=lyrics&offset=1&scroll=manual&theme=light&staff=12
 *
 * The panes and what they show are the layout's (pane-layout.ts); these are
 * the rest. A page ignores what it can't use, and a URL that doesn't say
 * leaves the choice to the page.
 */

import { parseStaffPx } from "./flow.js";

export interface DisplayOptions {
  /** Beats the reading position runs ahead of the music. */
  offset?: number;
  scroll?: "auto" | "manual";
  theme?: "dark" | "light";
  /** The player's part ("guitar"), for the notes on the card before a song. */
  role?: string;
  /** The note size: the distance between staff lines, in CSS px (see flow.ts). */
  staff?: number;
}

export function parseDisplayOptions(query: string): DisplayOptions {
  const q = new URLSearchParams(query);
  const options: DisplayOptions = {};
  const offset = Number(q.get("offset") ?? NaN);
  if (q.has("offset") && Number.isFinite(offset)) options.offset = offset;
  const scroll = q.get("scroll");
  if (scroll === "auto" || scroll === "manual") options.scroll = scroll;
  const theme = q.get("theme");
  if (theme === "dark" || theme === "light") options.theme = theme;
  const role = q.get("role")?.trim().toLowerCase();
  if (role) options.role = role;
  const staff = parseStaffPx(q.get("staff"));
  if (staff !== null) options.staff = staff;
  return options;
}

/** The query string for `options` ("" when there's nothing to say), in a fixed order. */
export function displayQuery(options: DisplayOptions): string {
  const parts: string[] = [];
  if (options.offset !== undefined) parts.push(`offset=${options.offset}`);
  if (options.scroll) parts.push(`scroll=${options.scroll}`);
  if (options.theme) parts.push(`theme=${options.theme}`);
  if (options.role) parts.push(`role=${encodeURIComponent(options.role)}`);
  if (options.staff !== undefined) parts.push(`staff=${options.staff}`);
  return parts.length ? "?" + parts.join("&") : "";
}
