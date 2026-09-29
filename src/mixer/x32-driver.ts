/**
 * MixerDriver for a Behringer X32 / Midas M32, straight over OSC.
 *
 * Three jobs beyond translating paths (x32-paths.ts) and dB (x32-taper.ts):
 *
 * - Subscription. The board sends every change to clients that have sent
 *   `/xremote` in the last 10 seconds; we renew every 5, as Companion does.
 * - Echo. We keep the last value we know for each address and report an
 *   incoming value only when it differs. Our own write, echoed or not, never
 *   differs from what we just recorded, so it is never reported, while someone
 *   moving the fader back to our value still is.
 * - Pacing. The X32 drops messages when sent a burst, so sends go out one per
 *   `sendIntervalMs`, and a newer value for an address replaces an unsent one.
 *   A jump in the song then costs one message per parameter, however many
 *   intermediate values the show passed through. The replacement goes to the
 *   back of the queue, so a value always goes out after anything set before
 *   it: fading into a mute (mute, then restore the fader) depends on that.
 */

import { asFloat, decodePacket, encode } from "../core/osc.js";
import type { MixerDriver, MixerPath, MixerValue } from "./driver.js";
import type { OscTransport } from "./transport.js";
import { toX32, fromX32, type ParamKind } from "./x32-paths.js";
import { dbToFader, faderToDb } from "./x32-taper.js";

export interface X32DriverOptions {
  /** Minimum gap between sends. The X32's real limit is unmeasured. */
  sendIntervalMs?: number;
  /** How often to renew `/xremote` (the board drops us after 10 s). */
  renewMs?: number;
}

// Two fader values closer than half of one of the X32's 1024 steps are the
// same value, which covers float32 rounding and a board that quantizes.
const FADER_TOLERANCE = 0.5 / 1023;

function toValue(kind: ParamKind, raw: number): MixerValue {
  return kind === "level" ? faderToDb(raw) : raw !== 0;
}

function same(kind: ParamKind, a: number, b: number): boolean {
  return kind === "level" ? Math.abs(a - b) <= FADER_TOLERANCE : a === b;
}

export class X32Driver implements MixerDriver {
  private readonly transport: OscTransport;
  private readonly sendIntervalMs: number;
  /** Last value we know for each address, as the X32 carries it. */
  private readonly known = new Map<string, number>();
  private readonly listeners = new Map<string, ((v: MixerValue) => void)[]>();
  private readonly pending = new Map<string, { resolve: (v: MixerValue) => void; reject: (e: Error) => void }[]>();
  /** Unsent messages, keyed so a newer one replaces an older one. */
  private readonly queue = new Map<string, Buffer>();
  private lastSentAt = -Infinity;
  private sendTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly renewTimer: ReturnType<typeof setInterval>;

  constructor(transport: OscTransport, opts: X32DriverOptions = {}) {
    this.transport = transport;
    this.sendIntervalMs = opts.sendIntervalMs ?? 5;
    transport.onMessage((buf) => this.receive(buf));
    const xremote = encode("/xremote");
    transport.send(xremote);
    this.renewTimer = setInterval(() => transport.send(xremote), opts.renewMs ?? 5_000);
  }

  subscribe(path: MixerPath, listener: (value: MixerValue) => void): Promise<MixerValue> {
    const { address } = toX32(path);
    this.listeners.set(address, [...(this.listeners.get(address) ?? []), listener]);
    return new Promise((resolve, reject) => {
      this.pending.set(address, [...(this.pending.get(address) ?? []), { resolve, reject }]);
      // An address with no arguments is a query; the board replies with the value.
      this.enqueue(`?${address}`, encode(address));
    });
  }

  set(path: MixerPath, value: MixerValue): void {
    const { address, kind } = toX32(path);
    let raw: number;
    if (kind === "level") {
      if (typeof value !== "number") throw new Error(`${path} takes a dB number, got ${value}`);
      raw = dbToFader(value);
    } else {
      if (typeof value !== "boolean") throw new Error(`${path} takes a boolean, got ${value}`);
      raw = value ? 1 : 0;
    }
    this.known.set(address, raw);
    this.enqueue(address, encode(address, [kind === "level" ? asFloat(raw) : raw]));
  }

  close(): void {
    clearInterval(this.renewTimer);
    clearTimeout(this.sendTimer);
    this.queue.clear();
    for (const waiters of this.pending.values()) {
      for (const w of waiters) w.reject(new Error("mixer driver closed"));
    }
    this.pending.clear();
    this.transport.close();
  }

  private receive(buf: Buffer): void {
    for (const msg of decodePacket(buf)) {
      const param = fromX32(msg.address);
      const raw = msg.args[0];
      if (!param || typeof raw !== "number") continue;
      const value = toValue(param.kind, raw);

      // A reply to our own query is the starting value, not a change.
      const waiters = this.pending.get(msg.address);
      this.pending.delete(msg.address);
      const prev = this.known.get(msg.address);
      this.known.set(msg.address, raw);
      if (waiters) {
        for (const w of waiters) w.resolve(value);
        continue;
      }
      if (prev !== undefined && same(param.kind, prev, raw)) continue;
      for (const l of this.listeners.get(msg.address) ?? []) l(value);
    }
  }

  private enqueue(key: string, buf: Buffer): void {
    this.queue.delete(key); // re-insert at the back: order follows the latest set
    this.queue.set(key, buf);
    this.pump();
  }

  private pump(): void {
    if (this.sendTimer !== undefined || this.queue.size === 0) return;
    const wait = this.lastSentAt + this.sendIntervalMs - Date.now();
    if (wait > 0) {
      this.sendTimer = setTimeout(() => {
        this.sendTimer = undefined;
        this.pump();
      }, wait);
      return;
    }
    const [key, buf] = this.queue.entries().next().value!;
    this.queue.delete(key);
    this.transport.send(buf);
    this.lastSentAt = Date.now();
    this.pump();
  }
}
