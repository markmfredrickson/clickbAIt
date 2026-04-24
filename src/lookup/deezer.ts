/** Deezer API adapter.
 *
 *  Two-step fetch: search returns track IDs and basic info, then /track/{id}
 *  gives the full detail including BPM (which the search endpoint omits).
 *
 *  Public API (no auth required).
 */

import type { DeezerResult } from "./types.js";

interface SearchResponse {
  data: Array<{
    id: number;
    title: string;
    duration: number;
    artist: { name: string };
  }>;
}

interface TrackDetail {
  title: string;
  duration: number;
  bpm: number;
  artist: { name: string };
  album?: { title: string };
}

export async function searchTrack(
  title: string,
  artist?: string,
): Promise<DeezerResult | null> {
  const query = artist
    ? `track:"${title}" artist:"${artist}"`
    : `track:"${title}"`;
  const searchUrl = `https://api.deezer.com/search?q=${encodeURIComponent(query)}`;

  const searchResp = (await (await fetch(searchUrl)).json()) as SearchResponse;
  const first = searchResp.data?.[0];
  if (!first) return null;

  const detailUrl = `https://api.deezer.com/track/${first.id}`;
  const detail = (await (await fetch(detailUrl)).json()) as TrackDetail;

  return {
    title: detail.title,
    artist: detail.artist.name,
    album: detail.album?.title,
    durationSec: detail.duration,
    bpm: detail.bpm > 0 ? detail.bpm : undefined,
  };
}
