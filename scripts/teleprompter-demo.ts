/**
 * Demo launcher for clickbAIt: One Simple Track
 *
 * Starts the relay with When the Saints Go Marching In, then simulates
 * REAPER sending /time OSC messages — advancing through the song.
 */

import { createSocket } from "node:dgram";
import { startTeleprompter } from "../src/teleprompter/index.js";
import saints from "../songs/traditional/when-the-saints-go-marching-in.js";

const HTTP_PORT = 3000;
const OSC_PORT = 9001;
const BPM = 129;
const BEAT_INTERVAL_MS = (60 / BPM) * 1000; // ~465ms per beat

async function main() {
  await startTeleprompter({
    song: saints,
    httpPort: HTTP_PORT,
    oscPort: OSC_PORT,
  });

  console.log("  Simulating REAPER playback...\n");

  const client = createSocket("udp4");

  function sendOscFloat(address: string, value: number) {
    const addrBytes = Buffer.from(address + "\0");
    const addrPadded = Buffer.alloc(Math.ceil(addrBytes.length / 4) * 4);
    addrBytes.copy(addrPadded);
    const tag = Buffer.alloc(4);
    tag.write(",f\0");
    const val = Buffer.alloc(4);
    val.writeFloatBE(value);
    client.send(Buffer.concat([addrPadded, tag, val]), OSC_PORT, "127.0.0.1");
  }

  function sendTime(beat: number) {
    const seconds = (beat / BPM) * 60;
    sendOscFloat("/time", seconds);
  }

  // Song structure for When the Saints (matches the dsongl file)
  const totalBeats = 16 + 48 + 16 * 3; // Intro(16) + Instrumental(48) + 3 Verses(48)
  // = 112 beats

  let beat = 0;
  let loopCount = 0;

  const interval = setInterval(() => {
    // End after 2 play-throughs
    if (loopCount >= 2 && beat >= totalBeats) {
      clearInterval(interval);
      console.log("\n  Demo complete. Server still running — Ctrl+C to quit.\n");
      return;
    }

    if (beat >= totalBeats) {
      beat = 0;
      loopCount++;
      console.log("  >> song ended, restarting from top");
    }

    sendTime(beat);
    beat += 1;
  }, BEAT_INTERVAL_MS);
}

main().catch(console.error);
