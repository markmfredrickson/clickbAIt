/**
 * Fire one OSC message at REAPER and watch what comes back.
 *
 * The relay has only ever listened. Before building the return leg we need to
 * know which of REAPER's control surface actually responds to messages FROM a
 * device — transport and track mute are documented, but locating to a region
 * is not, and that one decides whether song selection needs a ReaScript.
 *
 * REAPER setup (Preferences > Control/OSC/web > your clickbait device):
 *   - "Local listen port" is what this sends TO (8000 in clickbait.ReaperOSC).
 *   - The pattern config is deliberately minimal, so a probe that does nothing
 *     may mean the PATTERN is absent rather than the feature. Check the config
 *     before concluding REAPER can't do it.
 *   - Track mute needs DEVICE_TRACK_COUNT above 0.
 *
 * Usage:
 *   npx tsx scripts/osc-probe.ts <probe> [args]      # a named probe
 *   npx tsx scripts/osc-probe.ts raw /addr 1 2.5 str # anything at all
 *   npx tsx scripts/osc-probe.ts --list
 *
 * Options: --host <ip> (default 127.0.0.1), --port <n> (default 8000),
 *          --listen <n> (default 9000, 0 to skip), --wait <ms> (default 1500)
 */

import { createSocket } from "node:dgram";
import { encode, decodePacket, asFloat, type OscArg } from "../src/core/osc.js";

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const positional = argv.filter((a, i) =>
  !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));

const host = flag("host", "127.0.0.1");
const port = parseInt(flag("port", "8000"));
const listenPort = parseInt(flag("listen", "9000"));
const waitMs = parseInt(flag("wait", "1500"));

/** Named probes: what to send, and what it would tell us. */
const PROBES: Record<string, { build: (a: string[]) => [string, OscArg[]]; asks: string }> = {
  play:   { build: () => ["/play", [asFloat(1)]],  asks: "Does transport start?" },
  stop:   { build: () => ["/stop", [asFloat(1)]],  asks: "Does transport stop?" },
  pause:  { build: () => ["/pause", [asFloat(1)]], asks: "Does transport pause?" },

  repeat: {
    build: (a) => ["/repeat", [asFloat(a[0] === "off" ? 0 : 1)]],
    asks: "Does the repeat/loop toggle flip? (start/stop loop)",
  },

  mute: {
    // mute <trackNumber> [on|off]
    build: (a) => [`/track/${a[0] ?? 1}/mute`, [asFloat(a[1] === "off" ? 0 : 1)]],
    asks: "Does that track mute? (needs DEVICE_TRACK_COUNT > 0)",
  },

  // THE open question. If either of these moves the playhead, song selection in
  // a one-project show file is pure OSC and needs no ReaScript.
  region: {
    build: (a) => [`/region/${a[0] ?? 1}`, [asFloat(1)]],
    asks: "THE open one: does the playhead jump to that region?",
  },
  regionsel: {
    build: (a) => ["/region/select", [parseInt(a[0] ?? "1")]],
    asks: "Alternate region-select spelling — does the playhead jump?",
  },
  time: {
    build: (a) => ["/time", [asFloat(parseFloat(a[0] ?? "0"))]],
    asks: "Is /time settable, i.e. can we seek to a position directly?",
  },

  // The universal fallback: any action by command ID. 1068 = Transport: Toggle
  // repeat, a harmless, visible confirmation that /action works at all.
  action: {
    build: (a) => ["/action", [parseInt(a[0] ?? "1068")]],
    asks: "Does /action fire a command by ID? (the escape hatch for everything)",
  },

  raw: {
    build: (a) => [
      a[0],
      a.slice(1).map((x) => (/^-?\d+$/.test(x) ? parseInt(x) : /^-?[\d.]+$/.test(x) ? parseFloat(x) : x)),
    ],
    asks: "Whatever you typed.",
  },
};

if (positional.length === 0 || positional[0] === "--list" || argv.includes("--list")) {
  console.log("Probes:\n");
  for (const [name, p] of Object.entries(PROBES)) {
    console.log(`  ${name.padEnd(10)} ${p.asks}`);
  }
  console.log(`
Suggested order — each answers one question:

  1. npx tsx scripts/osc-probe.ts action 1068     # does /action work at all?
  2. npx tsx scripts/osc-probe.ts play            # transport
     npx tsx scripts/osc-probe.ts stop
  3. npx tsx scripts/osc-probe.ts repeat on       # loop start/stop
  4. npx tsx scripts/osc-probe.ts mute 1 on       # needs DEVICE_TRACK_COUNT > 0
  5. npx tsx scripts/osc-probe.ts region 2        # <- the one that matters
     npx tsx scripts/osc-probe.ts regionsel 2
     npx tsx scripts/osc-probe.ts time 30

If 5 moves the playhead, song selection in a show file is plain OSC.
If none of them do, it needs a ReaScript bound to a command ID, fired by /action.`);
  process.exit(0);
}

const probe = PROBES[positional[0]];
if (!probe) {
  console.error(`Unknown probe "${positional[0]}". Try --list.`);
  process.exit(1);
}

const [address, args] = probe.build(positional.slice(1));
if (!address) {
  console.error("raw needs an address, e.g. raw /play 1");
  process.exit(1);
}

const send = createSocket("udp4");
const listener = listenPort > 0 ? createSocket("udp4") : null;
let heard = 0;

function finish(): void {
  if (heard === 0) {
    console.log(
      listener
        ? "\nNothing heard back. That means REAPER sent no feedback — which is NOT proof\n" +
          "the command was ignored. Watch REAPER itself, and check the pattern config."
        : "\n(not listening)",
    );
  }
  send.close();
  listener?.close();
  process.exit(0);
}

if (listener) {
  listener.on("message", (buf) => {
    for (const m of decodePacket(buf)) {
      heard++;
      const shown = m.args.map((a) => (typeof a === "number" ? +a.toFixed(4) : JSON.stringify(a)));
      console.log(`  <- ${m.address} ${shown.join(" ")}`);
    }
  });
  listener.bind(listenPort, () => run());
} else {
  run();
}

function run(): void {
  const buf = encode(address, args);
  console.log(`${probe.asks}\n  -> ${host}:${port}  ${address} ${args.join(" ")}  (${buf.length} bytes)`);
  if (listener) console.log(`  listening on ${listenPort} for ${waitMs}ms…`);
  send.send(buf, port, host, (err) => {
    if (err) {
      console.error("send failed:", err.message);
      process.exit(1);
    }
    setTimeout(finish, listener ? waitMs : 100);
  });
}
