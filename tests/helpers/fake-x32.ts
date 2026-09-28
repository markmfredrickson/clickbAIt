/**
 * An in-memory X32, just enough of one to test a driver against.
 *
 * It holds values by X32 address, answers a query (an address with no
 * arguments) with the current value, and sends changes to every client that
 * has sent `/xremote` in the last 10 seconds. Timing uses `Date.now()`, so
 * vitest's fake timers drive the subscription timeout.
 *
 * `echoToSender` is the one behaviour we don't know for the real board.
 * Companion's X32 module says the X32 does NOT send a change back to the
 * socket that made it; the @djodjonx simulator does. The driver has to work
 * either way, so the fake can do both.
 */

import { decodeMessage, encode, asFloat, type OscMessage } from "../../src/core/osc.js";
import type { OscTransport } from "../../src/mixer/transport.js";

const XREMOTE_TTL_MS = 10_000;

/** One message a client sent, with its OSC type tags (e.g. "f", "i"). */
export interface Received extends OscMessage {
  tags: string;
}

interface Client {
  deliver: (buf: Buffer) => void;
  listeners: ((buf: Buffer) => void)[];
  xremoteUntil: number;
  closed: boolean;
}

/** Read the type-tag string ("f", "is", ...) out of an encoded message. */
function typeTags(buf: Buffer): string {
  const addrEnd = buf.indexOf(0);
  const tagStart = (addrEnd + 4) & ~3;
  if (buf[tagStart] !== 0x2c /* "," */) return "";
  return buf.toString("ascii", tagStart + 1, buf.indexOf(0, tagStart));
}

export class FakeX32 {
  /** Current values by X32 address: 0..1 floats for faders, 0/1 ints for `on`. */
  readonly state: Map<string, number>;
  /** Every message any driver client sent, in order. */
  readonly received: Received[] = [];
  private readonly clients: Client[] = [];
  private readonly echoToSender: boolean;

  constructor(opts: { echoToSender?: boolean; initial?: Record<string, number> } = {}) {
    this.echoToSender = opts.echoToSender ?? false;
    this.state = new Map(Object.entries(opts.initial ?? {}));
  }

  /** A new client connection, as a driver would see it. */
  connect(): OscTransport {
    const client: Client = {
      listeners: [],
      xremoteUntil: 0,
      closed: false,
      // Deliver asynchronously, like a socket would.
      deliver: (buf) => queueMicrotask(() => {
        if (!client.closed) for (const l of client.listeners) l(buf);
      }),
    };
    this.clients.push(client);
    return {
      send: (buf) => {
        // A closed dgram socket throws on send; so does this.
        if (client.closed) throw new Error("send on a closed connection");
        this.handle(client, buf);
      },
      onMessage: (cb) => {
        client.listeners.push(cb);
      },
      close: () => {
        client.closed = true;
      },
    };
  }

  /** Someone else changes a value: a hand on the board, or another app. */
  changeFromElsewhere(address: string, value: number): void {
    this.state.set(address, value);
    this.broadcast(address, value, null);
  }

  /** Messages the driver sent to one address, in order. */
  sentTo(address: string): Received[] {
    return this.received.filter((m) => m.address === address);
  }

  private handle(from: Client, buf: Buffer): void {
    const msg = decodeMessage(buf);
    if (!msg) return;
    this.received.push({ ...msg, tags: typeTags(buf) });

    if (msg.address === "/xremote") {
      from.xremoteUntil = Date.now() + XREMOTE_TTL_MS;
      return;
    }
    if (msg.args.length === 0) {
      // A query. The board ignores addresses it doesn't hold.
      const v = this.state.get(msg.address);
      if (v !== undefined) from.deliver(this.encodeValue(msg.address, v));
      return;
    }
    const v = msg.args[0];
    if (typeof v !== "number") return;
    this.state.set(msg.address, v);
    this.broadcast(msg.address, v, from);
  }

  private broadcast(address: string, value: number, from: Client | null): void {
    const now = Date.now();
    for (const c of this.clients) {
      if (c.xremoteUntil <= now) continue;
      if (c === from && !this.echoToSender) continue;
      c.deliver(this.encodeValue(address, value));
    }
  }

  private encodeValue(address: string, value: number): Buffer {
    return encode(address, [address.endsWith("/on") ? value : asFloat(value)]);
  }
}

/** Let queued deliveries (microtasks) and the driver's reactions to them run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
