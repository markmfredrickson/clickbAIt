/** MusicBrainz API adapter.
 *
 *  Prefers non-"live" recordings via the `disambiguation` field since the
 *  original Rust impl found Deezer BPMs weren't useful for live cuts.
 *
 *  Requires a descriptive User-Agent per MB policy.
 */

import type { MusicBrainzResult } from "./types.js";

interface Recording {
  id: string;
  title: string;
  length?: number;
  "artist-credit"?: Array<{ name: string }>;
  "release-list"?: Array<{ title: string }>;
  disambiguation?: string;
}

interface SearchResponse {
  recordings?: Recording[];
}

export async function searchRecording(
  title: string,
  artist?: string,
): Promise<MusicBrainzResult | null> {
  const query = artist
    ? `"${title}" AND artist:"${artist}"`
    : title;
  const url =
    `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}` +
    `&limit=10&fmt=json`;

  const resp = await fetch(url, {
    headers: { "User-Agent": "clickbAIt/0.1.0 (https://github.com/clickbait)" },
  });
  const json = (await resp.json()) as SearchResponse;
  const recordings = json.recordings ?? [];
  if (recordings.length === 0) return null;

  const rec =
    recordings.find(
      (r) => !(r.disambiguation ?? "").toLowerCase().includes("live"),
    ) ?? recordings[0];

  const artistName = rec["artist-credit"]?.[0]?.name;
  const album = rec["release-list"]?.[0]?.title;
  const duration = rec.length
    ? `${Math.floor(rec.length / 60000)}:${String(
        Math.floor((rec.length / 1000) % 60),
      ).padStart(2, "0")}`
    : undefined;

  return {
    title: rec.title,
    artist: artistName,
    album,
    mbid: rec.id,
    durationMs: rec.length,
    duration,
  };
}
