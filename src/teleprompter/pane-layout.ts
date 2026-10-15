/**
 * How a prompter page lays out its panes, carried in its URL so a setup is a
 * link:
 *
 *   /prompt?panes=2&split=vertical&view=chords&view=lyrics&at=60
 *
 * A page shows one pane, or two split by a divider. A vertical split has a
 * vertical divider, so the panes sit side by side; a horizontal one stacks
 * them. `view` fills the panes in order, each a channel id or an instrument,
 * and a pane without one is empty until the reader picks its channel. `at` is
 * where the divider sits, as a percent of the screen. The layout is the
 * reader's choice, never the screen's shape.
 *
 * Every other option (offset, theme, ...) is display-options.ts's, and
 * changing the layout leaves them alone.
 */

import { channelName, resolveChannels, type RowChannel, type RowDocument } from "./rows.js";

export type Split = "vertical" | "horizontal";

export interface PaneLayout {
  panes: 1 | 2;
  split: Split;
  /** Each pane's channel, or null where the reader hasn't picked one. */
  views: (string | null)[];
  /** The divider's place, in percent along the split. */
  at: number;
}

/** No pane narrower than this, in percent. */
const MIN_SHARE = 10;
const LAYOUT_KEYS = ["panes", "split", "view", "at"];

export function parseLayout(query: string): PaneLayout | { error: string } {
  const q = new URLSearchParams(query);
  const raw = q.get("panes");
  const panes = raw === null ? 1 : raw === "1" ? 1 : raw === "2" ? 2 : null;
  if (panes === null) return { error: `a page shows one pane or two, not "${raw}"` };
  const named = q.getAll("view").map((v) => v.trim() || null);
  if (named.length > panes) {
    return { error: `this link names ${named.length} views for ${panes === 1 ? "one pane" : "two panes"}` };
  }
  const views = Array.from({ length: panes }, (_, i) => named[i] ?? null);
  const split: Split = q.get("split") === "horizontal" ? "horizontal" : "vertical";
  const at = Number(q.get("at") ?? NaN);
  return {
    panes,
    split,
    views,
    at: Number.isFinite(at) ? Math.min(100 - MIN_SHARE, Math.max(MIN_SHARE, at)) : 50,
  };
}

export type LayoutChange = { flip: true } | { swap: true } | { at: number } | { pane: number; view: string };

/**
 * The query with the layout changed and every other option as it was. The
 * layout is written first, in a fixed order; a two-pane page always says
 * its split, and the divider is left out while it's in the middle.
 */
export function withLayout(query: string, change: LayoutChange): string {
  const parsed = parseLayout(query);
  if ("error" in parsed) return query;
  const l: PaneLayout = { ...parsed, views: parsed.views.slice() };
  if ("flip" in change) l.split = l.split === "vertical" ? "horizontal" : "vertical";
  else if ("swap" in change) l.views.reverse();
  else if ("at" in change) l.at = Math.round(Math.min(100 - MIN_SHARE, Math.max(MIN_SHARE, change.at)) * 10) / 10;
  else if (change.pane >= 0 && change.pane < l.panes) l.views[change.pane] = change.view;
  return layoutQuery(l, query);
}

/** The query for a layout, then the options in `rest` that aren't the layout's. */
export function layoutQuery(l: PaneLayout, rest = ""): string {
  const parts = ["panes=" + l.panes];
  if (l.panes === 2) parts.push("split=" + l.split);
  // Empty panes before a named one keep their place; trailing ones go.
  const views = l.views.slice();
  while (views.length && views[views.length - 1] === null) views.pop();
  for (const v of views) parts.push("view=" + (v === null ? "" : encodeURIComponent(v)));
  if (l.panes === 2 && l.at !== 50) parts.push("at=" + l.at);
  for (const [k, v] of new URLSearchParams(rest)) {
    if (!LAYOUT_KEYS.includes(k)) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return "?" + parts.join("&");
}

/** What a pane can show of this song: lyrics and chords first, then its parts in order. */
export function channelChoices(doc: RowDocument): { name: string; label: string }[] {
  const rank = (c: RowChannel) => (c.kind === "lyrics" ? 0 : c.kind === "chords" ? 1 : 2);
  return doc.channels
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => ({ name: c.id, label: channelName(c) }));
}

/** The channel a pane names (an id or an instrument), or null when the song has none. */
export function paneChannel(doc: RowDocument, name: string): RowChannel | null {
  const id = resolveChannels(doc, [name])[0];
  return doc.channels.find((c) => c.id === id) ?? null;
}

/** The picker's choices: a layout each, opening with its panes empty. */
export const LAYOUTS: readonly { name: string; note: string; href: string }[] = [
  { name: "One pane", note: "One channel, the whole screen", href: "/prompt?panes=1" },
  { name: "Side by side", note: "Two channels, split down the middle", href: "/prompt?panes=2&split=vertical" },
  { name: "Stacked", note: "Two channels, one above the other", href: "/prompt?panes=2&split=horizontal" },
];

/**
 * Where an old /split link goes: its views side by side on the prompter
 * page. Every view goes along, so a link with more than two is refused
 * there rather than cut short.
 */
export function promptFromSplit(query: string): string {
  const q = new URLSearchParams(query);
  const parts = ["panes=2", "split=vertical"];
  for (const v of q.getAll("view")) parts.push("view=" + encodeURIComponent(v));
  for (const [k, v] of q) if (k !== "view") parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return "/prompt?" + parts.join("&");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The e-ink page that comes before a channel is picked: a link per channel of
 * the song playing now. An e-ink page shows one channel. With no song yet, it
 * reloads itself until there is one.
 */
export function einkSplash(doc: RowDocument | null): string {
  const body = doc
    ? `<h1>${escapeHtml(doc.title)}</h1>
  <p>Pick what this screen shows.</p>
  <ul>
${channelChoices(doc).map((c) => `    <li><a href="/eink?channel=${encodeURIComponent(c.name)}">${escapeHtml(c.label)}</a></li>`).join("\n")}
  </ul>`
    : `<h1>Waiting for a song…</h1>
  <p>The channels to pick from appear once a song loads.</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
${doc ? "" : `  <meta http-equiv="refresh" content="10">\n`}  <title>E-ink — clickbAIt</title>
  <style>
    body { background: #fff; color: #000; font-family: Georgia, serif; margin: 0; padding: 2rem; }
    h1 { font-size: 2rem; margin: 0 0 0.5rem; }
    p { font-size: 1.2rem; margin: 0 0 1.5rem; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { margin: 0 0 1rem; }
    a { display: block; padding: 1.2rem 1.5rem; border: 3px solid #000; border-radius: 10px;
        color: #000; font-size: 1.8rem; font-weight: bold; text-decoration: none; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}
