#!/usr/bin/env node
/**
 * audio-features: Extract BPM, key, and beat positions from an audio file.
 *
 * Tries `essentia-cli` (Rust binary) first, falls back to Deezer lookup.
 *
 * Usage:
 *   node scripts/audio-features.mjs <audio-file> [--title "Song" --artist "Artist"]
 *
 * JSON contract (stdout):
 *   {
 *     "bpm": 97,
 *     "key": "G",
 *     "scale": "major",
 *     "keyStrength": 0.82,
 *     "beats": [0.5, 1.12, 1.74, ...],
 *     "confidence": 3.2,
 *     "duration": 148.5,
 *     "source": "essentia-cli" | "deezer"
 *   }
 */

import { execFileSync, execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title:  { type: "string" },
    artist: { type: "string" },
  },
});

const audioFile = positionals[0];
if (!audioFile) {
  console.error("Usage: node scripts/audio-features.mjs <audio-file> [--title Song --artist Artist]");
  process.exit(1);
}

const absPath = resolve(audioFile);

// --- Try essentia-cli first ---

function tryEssentiaCli() {
  try {
    const out = execFileSync("essentia-cli", ["analyze", absPath], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
    });
    const result = JSON.parse(out.toString());
    result.source = "essentia-cli";
    return result;
  } catch {
    return null;
  }
}

// --- Fallback: Deezer lookup via Python ---

function tryDeezerLookup(title, artist) {
  if (!title) return null;
  try {
    const args = ["-m", "clickbait_py.lookup_cli", title];
    if (artist) args.push(artist);
    const out = execFileSync(
      resolve(__dirname, "../.venv/bin/python3"),
      args,
      { stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 }
    );
    // Parse BPM from the lookup output
    const text = out.toString();
    const bpmMatch = text.match(/BPM:\s*([\d.]+)/);
    const durationMatch = text.match(/Duration:\s*([\d:]+)/);
    if (!bpmMatch) return null;

    let duration = 0;
    if (durationMatch) {
      const parts = durationMatch[1].split(":");
      duration = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }

    return {
      bpm: Math.round(parseFloat(bpmMatch[1])),
      key: null,
      scale: null,
      keyStrength: null,
      beats: [],
      confidence: null,
      duration,
      source: "deezer",
    };
  } catch {
    return null;
  }
}

// --- Main ---

let result = tryEssentiaCli();

if (!result) {
  if (!values.title) {
    console.error("essentia-cli not found. Provide --title/--artist for Deezer fallback.");
    console.error("Install essentia-cli: https://github.com/TODO/essentia-cli");
    process.exit(1);
  }
  console.error("essentia-cli not found, falling back to Deezer lookup...");
  result = tryDeezerLookup(values.title, values.artist);
}

if (!result) {
  console.error("Could not extract audio features from any source.");
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
