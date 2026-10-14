/** Genius API + page-scrape adapter.
 *
 *  Step 1: hit /search with the song query (requires GENIUS_API_TOKEN).
 *  Step 2: scrape the top hit's page HTML for lyrics. The Genius page
 *  renders lyrics inside elements tagged `[data-lyrics-container]`.
 *  Concatenate their text, convert `<br>` to newlines, strip obvious page
 *  chrome. Leave the rest to downstream section extraction — this stays
 *  dumb on purpose so Genius layout changes don't break our Rust-era
 *  expectations.
 */

import { load } from "cheerio";
import type { GeniusResult } from "./types.js";

interface SearchResponse {
  response: {
    hits: Array<{
      result: {
        title: string;
        url: string;
        primary_artist: { name: string };
      };
    }>;
  };
}

export async function searchLyrics(
  title: string,
  artist?: string,
): Promise<GeniusResult | null> {
  const token = process.env.GENIUS_API_TOKEN;
  if (!token) return null; // silently skip if no token

  const query = artist ? `${title} ${artist}` : title;
  const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(query)}`;

  const searchResp = (await (
    await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as SearchResponse;

  const hit = searchResp.response?.hits?.[0]?.result;
  if (!hit) return null;

  const pageHtml = await (await fetch(hit.url)).text();
  const rawText = extractLyricsText(pageHtml);

  return {
    title: hit.title,
    artist: hit.primary_artist.name,
    rawText,
  };
}

/** Scrape + minimal cleanup of the Genius lyric page.
 *
 *  Current pages open the first lyric container with a header element
 *  marked `data-exclude-from-selection` (contributor count, title, and an
 *  optional description). Dropping marked elements removes all of it. The
 *  description doesn't always end in "Read More", and without a line break
 *  before it, its text ran into the first section marker.
 *
 *  Older pages without the header get the text-sentinel cleanup carried
 *  over from the Rust version:
 *    1. "NN ContributorsTranslations…Lyrics" preamble. Sentinel: the
 *       literal word "Lyrics".
 *    2. An editorial annotation blurb ending with "Read More".
 *  Stray `<img src="…genius.com/avatars/…">` tags are stripped either way.
 */
export function extractLyricsText(html: string): string {
  const $ = load(html);
  const parts: string[] = [];

  const excluded = $("[data-lyrics-container] [data-exclude-from-selection]");
  const hasHeader = excluded.length > 0;
  excluded.remove();

  $("[data-lyrics-container]").each((_, container) => {
    // Replace <br> with newlines, then take the text.
    $(container).find("br").replaceWith("\n");
    parts.push($(container).text());
  });

  let text = parts.join("\n");

  if (!hasHeader) {
    const lyricsIdx = text.indexOf("Lyrics");
    if (lyricsIdx >= 0) text = text.slice(lyricsIdx + "Lyrics".length);

    const readMoreIdx = text.indexOf("Read More");
    if (readMoreIdx >= 0) text = text.slice(readMoreIdx + "Read More".length);
  }

  return stripHtmlTags(text).trim();
}

/** Remove any `<tag …>` fragments. Not a real HTML parser — just drops
 *  stray tags that leaked past cheerio (chiefly `<img>` embedded in text). */
function stripHtmlTags(s: string): string {
  let out = "";
  let inTag = false;
  for (const c of s) {
    if (c === "<") inTag = true;
    else if (c === ">" && inTag) inTag = false;
    else if (!inTag) out += c;
  }
  return out;
}
