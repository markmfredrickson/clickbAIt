/**
 * Listen on a UDP port and dump any OSC messages received.
 * Handles both bare messages and OSC bundles.
 * Usage: npx tsx scripts/osc-debug.ts [port]
 */

import { createSocket } from "node:dgram";

const port = parseInt(process.argv[2] ?? "9000");
const udp = createSocket("udp4");

function parseMessage(buf: Buffer, offset: number, end: number): string {
  // Read null-terminated address
  const nullIdx = buf.indexOf(0, offset);
  if (nullIdx < 0 || nullIdx >= end) return `[unparseable at ${offset}]`;
  const address = buf.toString("ascii", offset, nullIdx);

  // Skip to type tags (next 4-byte boundary)
  let pos = Math.ceil((nullIdx + 1) / 4) * 4;
  const tagNull = buf.indexOf(0, pos);
  if (tagNull < 0 || tagNull >= end) return `${address} (no tags)`;
  const tags = buf.toString("ascii", pos, tagNull);

  pos = Math.ceil((tagNull + 1) / 4) * 4;
  const args: string[] = [];
  for (const t of tags.slice(1)) {
    if (t === "f" && pos + 4 <= end) {
      args.push(buf.readFloatBE(pos).toFixed(4));
      pos += 4;
    } else if (t === "i" && pos + 4 <= end) {
      args.push(String(buf.readInt32BE(pos)));
      pos += 4;
    } else if (t === "s") {
      const sNull = buf.indexOf(0, pos);
      args.push(`"${buf.toString("utf8", pos, sNull)}"`);
      pos = Math.ceil((sNull + 1) / 4) * 4;
    } else if (t === "T") {
      args.push("TRUE");
    } else if (t === "F") {
      args.push("FALSE");
    } else {
      args.push(`[${t}?]`);
    }
  }

  return `${address} ${tags} ${args.join(" ")}`;
}

function parsePacket(buf: Buffer, offset: number, end: number): string[] {
  const results: string[] = [];

  // Check for bundle
  if (buf.toString("ascii", offset, offset + 7) === "#bundle") {
    // Skip "#bundle\0" (8 bytes) + timetag (8 bytes) = 16 bytes
    let pos = offset + 16;
    while (pos + 4 <= end) {
      const size = buf.readInt32BE(pos);
      pos += 4;
      if (size <= 0 || pos + size > end) break;
      // Recursively parse (could be nested bundle)
      results.push(...parsePacket(buf, pos, pos + size));
      pos += size;
    }
  } else {
    results.push(parseMessage(buf, offset, end));
  }

  return results;
}

udp.on("message", (msg, rinfo) => {
  const messages = parsePacket(msg, 0, msg.length);
  for (const m of messages) {
    console.log(`${m}`);
  }
});

udp.bind(port, () => {
  console.log(`Listening for OSC on UDP port ${port}... (Ctrl+C to quit)\n`);
});
