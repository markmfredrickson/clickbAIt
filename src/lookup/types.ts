/** Deezer track detail (search + /track/{id} combined). */
export interface DeezerResult {
  title: string;
  artist: string;
  album?: string;
  durationSec: number;
  bpm?: number;
}

/** MusicBrainz recording (single best match). */
export interface MusicBrainzResult {
  title: string;
  artist?: string;
  album?: string;
  mbid: string;
  durationMs?: number;
  /** Pretty-printed "M:SS" duration for the human-readable report. */
  duration?: string;
}

/** Genius lyric scrape. `rawText` is the concatenated lyric-container text,
 *  `<br>`s replaced with newlines, and a small amount of page-chrome
 *  stripped (see genius.ts for details). Downstream Haiku / user does
 *  section extraction. */
export interface GeniusResult {
  title: string;
  artist: string;
  rawText: string;
}
