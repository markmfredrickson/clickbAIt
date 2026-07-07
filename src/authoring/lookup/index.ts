/** Lookup orchestrator.
 *
 *  Runs all three providers in parallel via Promise.allSettled so one
 *  provider's failure doesn't sink the others. Output format is the same
 *  line-oriented text that the Rust version produced, preserving the
 *  `---lyrics-raw---` / `---end-lyrics-raw---` sentinels that
 *  `scripts/build-dsongl.mjs` parses. Despite the file extension
 *  `<slug>.lookup.json`, this has always been text, not JSON.
 */

import { searchTrack } from "./deezer.js";
import { searchRecording } from "./musicbrainz.js";
import { searchLyrics } from "./genius.js";
import type {
  DeezerResult,
  MusicBrainzResult,
  GeniusResult,
} from "./types.js";

export interface LookupResults {
  deezer: DeezerResult | null;
  musicbrainz: MusicBrainzResult | null;
  genius: GeniusResult | null;
  errors: {
    deezer?: string;
    musicbrainz?: string;
    genius?: string;
  };
}

export async function runLookup(
  title: string,
  artist?: string,
): Promise<LookupResults> {
  const [dz, mb, ge] = await Promise.allSettled([
    searchTrack(title, artist),
    searchRecording(title, artist),
    searchLyrics(title, artist),
  ]);

  const errors: LookupResults["errors"] = {};
  const unwrap = <T>(r: PromiseSettledResult<T>, key: keyof typeof errors) => {
    if (r.status === "fulfilled") return r.value;
    errors[key] = r.reason instanceof Error ? r.reason.message : String(r.reason);
    return null;
  };

  return {
    deezer: unwrap(dz, "deezer"),
    musicbrainz: unwrap(mb, "musicbrainz"),
    genius: unwrap(ge, "genius"),
    errors,
  };
}

/** Format lookup results as the line-oriented text the rest of the
 *  pipeline consumes. Exactly matches the Rust version's output shape so
 *  build-dsongl.mjs and other readers see no difference.
 *
 *  Does NOT include a "Looking up: …" header — CLI emits that to stderr
 *  only, matching the Rust version. */
export function formatReport(r: LookupResults): string {
  const out: string[] = [];

  // MusicBrainz block
  if (r.errors.musicbrainz) {
    out.push(`MusicBrainz: error — ${r.errors.musicbrainz}`);
  } else if (r.musicbrainz) {
    const mb = r.musicbrainz;
    out.push(`MusicBrainz: ${mb.title} by ${mb.artist ?? "?"}`);
    if (mb.album) out.push(`  Album: ${mb.album}`);
    if (mb.duration) out.push(`  Duration: ${mb.duration}`);
  } else {
    out.push("MusicBrainz: not found");
  }

  // Deezer block
  if (r.errors.deezer) {
    out.push(`Deezer: error — ${r.errors.deezer}`);
  } else if (r.deezer) {
    const dz = r.deezer;
    out.push(`Deezer: ${dz.title} by ${dz.artist}`);
    if (dz.bpm !== undefined) out.push(`  BPM: ${dz.bpm}`);
    const mins = Math.floor(dz.durationSec / 60);
    const secs = dz.durationSec % 60;
    out.push(`  Duration: ${mins}:${String(secs).padStart(2, "0")}`);
  } else {
    out.push("Deezer: not found");
  }

  // Genius block — raw lyric text between sentinels
  if (r.errors.genius) {
    out.push(`Genius: error — ${r.errors.genius}`);
  } else if (r.genius) {
    out.push(`Genius: ${r.genius.title} by ${r.genius.artist}`);
    out.push("  ---lyrics-raw---");
    out.push(r.genius.rawText);
    out.push("  ---end-lyrics-raw---");
  } else {
    out.push("Genius: not found (GENIUS_API_TOKEN may not be set)");
  }

  return out.join("\n");
}
