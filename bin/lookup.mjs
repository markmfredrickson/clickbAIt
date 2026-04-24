#!/usr/bin/env node

// src/lookup-cli.ts
import { config } from "dotenv";

// src/lookup/deezer.ts
async function searchTrack(title2, artist2) {
  const query = artist2 ? `track:"${title2}" artist:"${artist2}"` : `track:"${title2}"`;
  const searchUrl = `https://api.deezer.com/search?q=${encodeURIComponent(query)}`;
  const searchResp = await (await fetch(searchUrl)).json();
  const first = searchResp.data?.[0];
  if (!first) return null;
  const detailUrl = `https://api.deezer.com/track/${first.id}`;
  const detail = await (await fetch(detailUrl)).json();
  return {
    title: detail.title,
    artist: detail.artist.name,
    album: detail.album?.title,
    durationSec: detail.duration,
    bpm: detail.bpm > 0 ? detail.bpm : void 0
  };
}

// src/lookup/musicbrainz.ts
async function searchRecording(title2, artist2) {
  const query = artist2 ? `"${title2}" AND artist:"${artist2}"` : title2;
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&limit=10&fmt=json`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "clickbAIt/0.1.0 (https://github.com/clickbait)" }
  });
  const json = await resp.json();
  const recordings = json.recordings ?? [];
  if (recordings.length === 0) return null;
  const rec = recordings.find(
    (r) => !(r.disambiguation ?? "").toLowerCase().includes("live")
  ) ?? recordings[0];
  const artistName = rec["artist-credit"]?.[0]?.name;
  const album = rec["release-list"]?.[0]?.title;
  const duration = rec.length ? `${Math.floor(rec.length / 6e4)}:${String(
    Math.floor(rec.length / 1e3 % 60)
  ).padStart(2, "0")}` : void 0;
  return {
    title: rec.title,
    artist: artistName,
    album,
    mbid: rec.id,
    durationMs: rec.length,
    duration
  };
}

// src/lookup/genius.ts
import { load } from "cheerio";
async function searchLyrics(title2, artist2) {
  const token = process.env.GENIUS_API_TOKEN;
  if (!token) return null;
  const query = artist2 ? `${title2} ${artist2}` : title2;
  const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(query)}`;
  const searchResp = await (await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } })).json();
  const hit = searchResp.response?.hits?.[0]?.result;
  if (!hit) return null;
  const pageHtml = await (await fetch(hit.url)).text();
  const rawText = extractLyricsText(pageHtml);
  return {
    title: hit.title,
    artist: hit.primary_artist.name,
    rawText
  };
}
function extractLyricsText(html) {
  const $ = load(html);
  const parts = [];
  $("[data-lyrics-container]").each((_, container) => {
    $(container).find("br").replaceWith("\n");
    parts.push($(container).text());
  });
  let text = parts.join("\n");
  const lyricsIdx = text.indexOf("Lyrics");
  if (lyricsIdx >= 0) text = text.slice(lyricsIdx + "Lyrics".length);
  const readMoreIdx = text.indexOf("Read More");
  if (readMoreIdx >= 0) text = text.slice(readMoreIdx + "Read More".length);
  return stripHtmlTags(text).trim();
}
function stripHtmlTags(s) {
  let out = "";
  let inTag = false;
  for (const c of s) {
    if (c === "<") inTag = true;
    else if (c === ">" && inTag) inTag = false;
    else if (!inTag) out += c;
  }
  return out;
}

// src/lookup/index.ts
async function runLookup(title2, artist2) {
  const [dz, mb, ge] = await Promise.allSettled([
    searchTrack(title2, artist2),
    searchRecording(title2, artist2),
    searchLyrics(title2, artist2)
  ]);
  const errors = {};
  const unwrap = (r, key) => {
    if (r.status === "fulfilled") return r.value;
    errors[key] = r.reason instanceof Error ? r.reason.message : String(r.reason);
    return null;
  };
  return {
    deezer: unwrap(dz, "deezer"),
    musicbrainz: unwrap(mb, "musicbrainz"),
    genius: unwrap(ge, "genius"),
    errors
  };
}
function formatReport(r) {
  const out = [];
  if (r.errors.musicbrainz) {
    out.push(`MusicBrainz: error \u2014 ${r.errors.musicbrainz}`);
  } else if (r.musicbrainz) {
    const mb = r.musicbrainz;
    out.push(`MusicBrainz: ${mb.title} by ${mb.artist ?? "?"}`);
    if (mb.album) out.push(`  Album: ${mb.album}`);
    if (mb.duration) out.push(`  Duration: ${mb.duration}`);
  } else {
    out.push("MusicBrainz: not found");
  }
  if (r.errors.deezer) {
    out.push(`Deezer: error \u2014 ${r.errors.deezer}`);
  } else if (r.deezer) {
    const dz = r.deezer;
    out.push(`Deezer: ${dz.title} by ${dz.artist}`);
    if (dz.bpm !== void 0) out.push(`  BPM: ${dz.bpm}`);
    const mins = Math.floor(dz.durationSec / 60);
    const secs = dz.durationSec % 60;
    out.push(`  Duration: ${mins}:${String(secs).padStart(2, "0")}`);
  } else {
    out.push("Deezer: not found");
  }
  if (r.errors.genius) {
    out.push(`Genius: error \u2014 ${r.errors.genius}`);
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

// src/lookup-cli.ts
config({ quiet: true });
function parseArgs(argv) {
  const args = argv.slice(2);
  let title2;
  let artist2;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "-a" || args[i] === "--artist") && args[i + 1]) {
      artist2 = args[++i];
    } else if (!title2 && !args[i].startsWith("-")) {
      title2 = args[i];
    }
  }
  if (!title2) {
    console.error('usage: npx clickbait-lookup "<title>" [-a "<artist>"]');
    process.exit(1);
  }
  return { title: title2, artist: artist2 };
}
var { title, artist } = parseArgs(process.argv);
process.stderr.write(`Looking up: "${title}"${artist ? ` by ${artist}` : ""}...
`);
runLookup(title, artist).then((results) => {
  console.log(formatReport(results));
}).catch((err) => {
  console.error("lookup failed:", err);
  process.exit(1);
});
