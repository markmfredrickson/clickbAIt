import type { Song } from "./types.js";

export function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function songSlug(song: Song): string {
  const parts = [song.title];
  if (song.artist) parts.push(song.artist);
  return toSlug(parts.join("-"));
}
