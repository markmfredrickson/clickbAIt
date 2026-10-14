/** Deezer API adapter.
 *
 *  Two-step fetch: search returns track IDs and basic info, then /track/{id}
 *  gives the full detail including BPM (which the search endpoint omits).
 *
 *  Search is plain text. Deezer's `track:"…" artist:"…"` syntax returns no
 *  results (seen 2026-10-14), so `pickTrack` filters the hits instead.
 *
 *  Public API (no auth required).
 */

import type { DeezerResult } from "./types.js";

export interface SearchHit {
  id: number;
  title: string;
  title_short?: string;
  title_version?: string;
  duration: number;
  artist: { name: string };
}

interface SearchResponse {
  data?: SearchHit[];
}

/** Lowercase, straighten apostrophes, drop punctuation and a leading "the". */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/'/g, "")
    .replace(/^\s*the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Version tags that still name the studio recording. Anything else ("Live
 *  at Reading", "Smart Sessions", "Devonshire Mix") is a different take. */
const STUDIO_VERSION = /^\W*(\d{4}\s+)?(remaster(ed)?|mono|stereo|single version|radio edit|album version)(\s+\d{4})?\W*$/i;

function isStudio(h: SearchHit): boolean {
  const version = h.title_version?.trim() ?? "";
  return version === "" || STUDIO_VERSION.test(version);
}

/** The first hit (Deezer orders by relevance) with the same title and artist
 *  whose version tag is empty or a remaster. Null when nothing matches
 *  exactly: a wrong recording's BPM is worse than none. */
export function pickTrack(
  hits: SearchHit[],
  title: string,
  artist?: string,
): SearchHit | null {
  const wantTitle = normalize(title);
  const wantArtist = artist ? normalize(artist) : undefined;
  return (
    hits.find(
      (h) =>
        normalize(h.title_short ?? h.title) === wantTitle &&
        (wantArtist === undefined || normalize(h.artist.name) === wantArtist) &&
        isStudio(h),
    ) ?? null
  );
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
  const query = artist ? `${artist} ${title}` : title;
  const searchUrl = `https://api.deezer.com/search?q=${encodeURIComponent(query)}`;

  const searchResp = (await (await fetch(searchUrl)).json()) as SearchResponse;
  const match = pickTrack(searchResp.data ?? [], title, artist);
  if (!match) return null;

  const detailUrl = `https://api.deezer.com/track/${match.id}`;
  const detail = (await (await fetch(detailUrl)).json()) as TrackDetail;

  return {
    title: detail.title,
    artist: detail.artist.name,
    album: detail.album?.title,
    durationSec: detail.duration,
    bpm: detail.bpm > 0 ? detail.bpm : undefined,
  };
}
