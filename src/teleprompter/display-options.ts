/**
 * A display's options, carried in its URL so a setup is a link: open it on
 * another screen and it looks the same.
 *
 *   /prompt?channels=chords,lyrics&lyrics=2&lyrics.rows=6&chords.rows=2&offset=1&scroll=manual&theme=light
 *
 * `channels` lists what to show, in the order the panes stack. Each channel
 * takes its size under its own name, and its pane's rows as `<name>.rows`.
 * A page ignores what it can't use, and a URL that doesn't say leaves the
 * choice to the page (and what the screen remembers).
 *
 * The presets are the choices on the join page's picker.
 */

const MAX_ROWS = 50;

export interface DisplayOptions {
  channels?: string[];
  /** Size in rem, by channel name. */
  sizes: Record<string, number>;
  /** Rows a channel's pane shows, by channel name. */
  rows: Record<string, number>;
  /** Beats the reading position runs ahead of the music. */
  offset?: number;
  scroll?: "auto" | "manual";
  theme?: "dark" | "light";
  /** The player's part ("guitar"), for the notes on the card before a song. */
  role?: string;
}

export function parseDisplayOptions(query: string, sizedChannels: readonly string[]): DisplayOptions {
  const q = new URLSearchParams(query);
  const options: DisplayOptions = { sizes: {}, rows: {} };
  const channels = q.get("channels");
  if (channels !== null) options.channels = channels.split(",").map((c) => c.trim()).filter(Boolean);
  for (const channel of sizedChannels) {
    const size = Number(q.get(channel) ?? NaN);
    if (q.has(channel) && Number.isFinite(size) && size > 0) options.sizes[channel] = size;
    const rows = Number(q.get(channel + ".rows") ?? NaN);
    if (Number.isInteger(rows) && rows >= 1 && rows <= MAX_ROWS) options.rows[channel] = rows;
  }
  const offset = Number(q.get("offset") ?? NaN);
  if (q.has("offset") && Number.isFinite(offset)) options.offset = offset;
  const scroll = q.get("scroll");
  if (scroll === "auto" || scroll === "manual") options.scroll = scroll;
  const theme = q.get("theme");
  if (theme === "dark" || theme === "light") options.theme = theme;
  const role = q.get("role")?.trim().toLowerCase();
  if (role) options.role = role;
  return options;
}

/** The query string for `options` ("" when there's nothing to say), in a fixed order. */
export function displayQuery(options: DisplayOptions, sizedChannels: readonly string[]): string {
  const parts: string[] = [];
  if (options.channels) parts.push("channels=" + options.channels.map(encodeURIComponent).join(","));
  for (const channel of sizedChannels) {
    if (options.sizes[channel] !== undefined) parts.push(`${encodeURIComponent(channel)}=${options.sizes[channel]}`);
    if (options.rows[channel] !== undefined) parts.push(`${encodeURIComponent(channel)}.rows=${options.rows[channel]}`);
  }
  if (options.offset !== undefined) parts.push(`offset=${options.offset}`);
  if (options.scroll) parts.push(`scroll=${options.scroll}`);
  if (options.theme) parts.push(`theme=${options.theme}`);
  if (options.role) parts.push(`role=${encodeURIComponent(options.role)}`);
  return parts.length ? "?" + parts.join("&") : "";
}

export interface Preset {
  name: string;
  /** What it's for, under the name on the picker. */
  note: string;
  page: "prompt" | "eink";
  /** The query string, without the leading "?". */
  query?: string;
}

export const PRESETS: readonly Preset[] = [
  { name: "Lyrics", note: "Words, following the song", page: "prompt", query: "channels=lyrics" },
  { name: "Chords + lyrics", note: "The chord chart above the words", page: "prompt", query: "channels=chords,lyrics" },
  { name: "Chords only", note: "A chart, bar by bar", page: "prompt", query: "channels=chords" },
  { name: "Drums + lyrics", note: "Grooves above the words", page: "prompt", query: "channels=drums,lyrics" },
  { name: "E-ink lyrics", note: "Pages for an e-ink browser", page: "eink", query: "channels=lyrics" },
  { name: "E-ink chords + lyrics", note: "Chords above the words, on e-ink", page: "eink", query: "channels=chords,lyrics" },
  { name: "E-ink drums", note: "The drum chart, on e-ink", page: "eink", query: "channels=drums" },
  { name: "Custom", note: "Opens with the settings out", page: "prompt", query: "settings=open" },
];

export function presetHref(p: Preset): string {
  return "/" + p.page + (p.query ? "?" + p.query : "");
}
