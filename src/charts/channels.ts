/**
 * The channels a song offers, and how a display's request resolves to them.
 *
 * A display asks for channels by name (`?channels=guitar,lyrics`). A name is
 * either a channel id (`lyrics`, `rhythm-guitar`) or an instrument, which
 * stands for every chart of that instrument. Names the song doesn't have are
 * reported back, so a typo shows up on screen instead of silently vanishing.
 */

import type { ChartSpec } from "../manifest.js";

export type ChannelKind = "sections" | "lyrics" | ChartSpec["kind"];

export interface ChannelInfo {
  id: string;
  kind: ChannelKind;
  /** Charts only: the instrument group the chart belongs to. */
  instrument?: string;
}

export function songChannels(song: { hasLyrics: boolean; charts: readonly ChartSpec[] }): ChannelInfo[] {
  return [
    { id: "sections", kind: "sections" },
    ...(song.hasLyrics ? [{ id: "lyrics", kind: "lyrics" as const }] : []),
    ...song.charts.map((c) => ({ id: c.id, kind: c.kind, instrument: c.instrument })),
  ];
}

/** What a display gets with no channel list: today's lyrics display. */
const DEFAULT_REQUEST = ["sections", "lyrics"];

export function resolveChannels(
  requested: readonly string[],
  available: readonly ChannelInfo[],
): { channels: string[]; unknown: string[] } {
  const names = requested.length > 0 ? requested : DEFAULT_REQUEST;
  const channels: string[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const byId = available.filter((c) => c.id === name);
    const matches = byId.length > 0 ? byId : available.filter((c) => c.instrument === name);
    if (matches.length === 0) {
      // The default names only what a song might have; an instrumental has no lyrics.
      if (requested.length > 0) unknown.push(name);
      continue;
    }
    for (const c of matches) if (!channels.includes(c.id)) channels.push(c.id);
  }
  return { channels, unknown };
}

/** `" guitar, lyrics,,"` → `["guitar", "lyrics"]`. */
export function parseChannelParam(param: string | null | undefined): string[] {
  return (param ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
