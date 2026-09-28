/**
 * Minimal OSC 1.0 codec — enough for talking to REAPER, and no more.
 *
 * The relay has always been receive-only: REAPER sends position and transport,
 * the relay fans it out over WebSocket. Driving REAPER back (transport, track
 * mute, loop, locate) needs the other direction, so this adds `encode` next to
 * the `decode` the debug dumper already needed.
 *
 * Types are int32 / float32 / string only. REAPER's OSC surface uses nothing
 * else, and a partial codec that is obviously partial beats one that looks
 * general but is untested on the rest.
 */

/** An OSC argument. Booleans are sent as REAPER expects them: 1.0 / 0.0 floats. */
export type OscArg = number | string | boolean;

/** A decoded OSC message. */
export interface OscMessage {
  address: string;
  args: (number | string)[];
}

/** Round up to the next 4-byte boundary (OSC pads everything to 4). */
function pad4(n: number): number {
  return (n + 3) & ~3;
}

/** A null-terminated, 4-byte-padded ASCII string. */
function encodeString(s: string): Buffer {
  const buf = Buffer.alloc(pad4(Buffer.byteLength(s, "ascii") + 1));
  buf.write(s, 0, "ascii");
  return buf;
}

/**
 * Encode one OSC message. Integers that are whole numbers go as int32 unless
 * they came in as a float-typed value — REAPER is lenient about int vs float on
 * most addresses, but `/action` wants an int and faders want a float, so the
 * caller controls it by passing `{ f: n }` or `{ i: n }` where it matters.
 */
export function encode(address: string, args: readonly OscArg[] = []): Buffer {
  if (!address.startsWith("/")) throw new Error(`OSC address must start with "/": ${address}`);

  const tags: string[] = [];
  const bodies: Buffer[] = [];

  for (const a of args) {
    if (typeof a === "boolean") {
      tags.push("f");
      const b = Buffer.alloc(4);
      b.writeFloatBE(a ? 1 : 0);
      bodies.push(b);
    } else if (typeof a === "string") {
      tags.push("s");
      bodies.push(encodeString(a));
    } else if (Number.isInteger(a)) {
      tags.push("i");
      const b = Buffer.alloc(4);
      b.writeInt32BE(a);
      bodies.push(b);
    } else {
      tags.push("f");
      const b = Buffer.alloc(4);
      b.writeFloatBE(a);
      bodies.push(b);
    }
  }

  return Buffer.concat([encodeString(address), encodeString("," + tags.join("")), ...bodies]);
}

/** Force a number to be sent as a float even when it's whole (faders, /time). */
export function asFloat(n: number): number {
  return Number.isInteger(n) ? n + Number.EPSILON : n;
}

/**
 * Decode one OSC message from `buf[offset..end)`. Returns null for anything
 * malformed rather than throwing — this parses bytes off a UDP socket, where
 * anything at all can arrive.
 */
export function decodeMessage(buf: Buffer, offset = 0, end = buf.length): OscMessage | null {
  const addrEnd = buf.indexOf(0, offset);
  if (addrEnd < 0 || addrEnd >= end) return null;
  const address = buf.toString("ascii", offset, addrEnd);
  if (!address.startsWith("/")) return null;

  let pos = pad4(addrEnd + 1);
  // A message with no type-tag string is legal in OSC 1.0 and means no args.
  if (pos >= end) return { address, args: [] };

  const tagEnd = buf.indexOf(0, pos);
  if (tagEnd < 0 || tagEnd >= end) return { address, args: [] };
  const tags = buf.toString("ascii", pos, tagEnd);
  if (!tags.startsWith(",")) return { address, args: [] };

  pos = pad4(tagEnd + 1);
  const args: (number | string)[] = [];
  for (const t of tags.slice(1)) {
    if (t === "i") {
      if (pos + 4 > end) return null;
      args.push(buf.readInt32BE(pos));
      pos += 4;
    } else if (t === "f") {
      if (pos + 4 > end) return null;
      args.push(buf.readFloatBE(pos));
      pos += 4;
    } else if (t === "s") {
      const strEnd = buf.indexOf(0, pos);
      if (strEnd < 0 || strEnd >= end) return null;
      args.push(buf.toString("ascii", pos, strEnd));
      pos = pad4(strEnd + 1);
    } else {
      // Unknown tag: we can't know its width, so stop rather than misread.
      break;
    }
  }
  return { address, args };
}

/**
 * Decode a datagram that may be a bare message or a `#bundle` of them.
 * Bundles are flattened; the timetag is ignored (REAPER sends immediate ones).
 */
export function decodePacket(buf: Buffer, offset = 0, end = buf.length): OscMessage[] {
  if (end - offset >= 8 && buf.toString("ascii", offset, offset + 7) === "#bundle") {
    const out: OscMessage[] = [];
    let pos = offset + 16; // 8 bytes "#bundle\0" + 8 bytes timetag
    while (pos + 4 <= end) {
      const size = buf.readInt32BE(pos);
      pos += 4;
      if (size <= 0 || pos + size > end) break;
      out.push(...decodePacket(buf, pos, pos + size));
      pos += size;
    }
    return out;
  }
  const msg = decodeMessage(buf, offset, end);
  return msg ? [msg] : [];
}
