/**
 * Demo launcher for clickbAIt: One Simple Track
 *
 * Starts the relay with Valerie, then simulates REAPER sending
 * /beat OSC messages — advancing through the song with occasional
 * loops back to earlier sections at irregular intervals.
 */

import { createSocket } from "node:dgram";
import { startTeleprompter } from "../src/teleprompter/index.js";
import valerie from "../songs/amy-winehouse/valerie.js";

const HTTP_PORT = 3000;
const OSC_PORT = 9000;
const BPM = 148;
const BEAT_INTERVAL_MS = (60 / BPM) * 1000; // ~405ms per beat

async function main() {
  // Start the server
  await startTeleprompter({
    song: valerie,
    httpPort: HTTP_PORT,
    oscPort: OSC_PORT,
  });

  console.log("  Simulating REAPER playback...\n");

  // UDP client to send OSC to ourselves
  const client = createSocket("udp4");

  function sendOscFloat(address: string, value: number) {
    // Pad address to 4-byte boundary
    const addrBytes = Buffer.from(address + "\0");
    const addrPadded = Buffer.alloc(Math.ceil(addrBytes.length / 4) * 4);
    addrBytes.copy(addrPadded);
    // Type tag ",f" padded to 4 bytes
    const tag = Buffer.alloc(4);
    tag.write(",f\0");
    // Float: 32-bit big-endian
    const val = Buffer.alloc(4);
    val.writeFloatBE(value);
    client.send(Buffer.concat([addrPadded, tag, val]), OSC_PORT, "127.0.0.1");
  }

  function sendTime(beat: number) {
    // Convert beat to seconds (like REAPER would send via /time)
    const seconds = (beat / BPM) * 60;
    sendOscFloat("/time", seconds);
  }

  // Song structure for Valerie (beat positions of sections)
  const sections = [
    { name: "Intro", beat: 0, duration: 16 },
    { name: "Verse 1", beat: 16, duration: 32 },
    { name: "Pre-Chorus 1", beat: 48, duration: 16 },
    { name: "Chorus 1", beat: 64, duration: 32 },
    { name: "Verse 2", beat: 96, duration: 32 },
    { name: "Pre-Chorus 2", beat: 128, duration: 16 },
    { name: "Chorus 2", beat: 144, duration: 32 },
    { name: "Verse 3", beat: 176, duration: 32 },
    { name: "Pre-Chorus 3", beat: 208, duration: 16 },
    { name: "Chorus 3 (Outro)", beat: 224, duration: 48 },
  ];

  const totalBeats = 272; // end of song

  let beat = 0;
  let loopCount = 0;

  // Irregular loop points — jump back after reaching these beats
  const loopTriggers = [
    { at: 80, to: 64, label: "looping back to Chorus 1" },
    { at: 160, to: 96, label: "looping back to Verse 2" },
    { at: 240, to: 0, label: "looping back to the top" },
  ];
  let nextLoopIdx = 0;

  const interval = setInterval(() => {
    // Check for loop trigger
    if (nextLoopIdx < loopTriggers.length) {
      const trigger = loopTriggers[nextLoopIdx];
      if (beat >= trigger.at) {
        console.log(`  >> ${trigger.label} (beat ${trigger.at} → ${trigger.to})`);
        beat = trigger.to;
        nextLoopIdx++;
        loopCount++;
      }
    }

    // End after 3 loops through various sections
    if (loopCount >= 3 && beat >= totalBeats) {
      clearInterval(interval);
      console.log("\n  Demo complete. Server still running — Ctrl+C to quit.\n");
      return;
    }

    // Wrap around if we go past the end
    if (beat >= totalBeats) {
      beat = 0;
      loopCount++;
      console.log("  >> song ended, restarting from top");
    }

    sendTime(beat);

    // Add some jitter: occasionally advance by 0.5 or 1.5 beats
    const jitter = Math.random();
    if (jitter < 0.1) {
      beat += 0.5; // half beat
    } else if (jitter < 0.2) {
      beat += 1.5; // beat and a half
    } else {
      beat += 1;   // normal beat
    }
  }, BEAT_INTERVAL_MS);
}

main().catch(console.error);
