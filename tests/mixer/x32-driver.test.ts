import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { X32Driver } from "../../src/mixer/x32-driver.js";
import { FakeX32, settle } from "../helpers/fake-x32.js";

const INTERVAL = 10;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function rig(opts: { echoToSender?: boolean; initial?: Record<string, number> } = {}) {
  const board = new FakeX32(opts);
  const driver = new X32Driver(board.connect(), { sendIntervalMs: INTERVAL });
  return { board, driver };
}

/** Advance fake time far enough for the send queue to drain. */
const drain = async () => {
  await vi.advanceTimersByTimeAsync(INTERVAL * 20);
  await settle();
};

describe("X32Driver — subscribe", () => {
  it("returns a fader's current value in dB", async () => {
    const { driver } = rig({ initial: { "/ch/05/mix/fader": 0.5 } });
    const value = driver.subscribe("ch.4.mix.lvl", () => {});
    await drain();
    await expect(value).resolves.toBeCloseTo(-10, 4);
  });

  it("returns a mute as the `on` boolean", async () => {
    const { driver } = rig({ initial: { "/ch/05/mix/on": 0, "/ch/06/mix/on": 1 } });
    const off = driver.subscribe("ch.4.mix.on", () => {});
    const on = driver.subscribe("ch.5.mix.on", () => {});
    await drain();
    await expect(off).resolves.toBe(false);
    await expect(on).resolves.toBe(true);
  });
});

describe("X32Driver — set", () => {
  it("sends a fader level as a float fader value", async () => {
    const { board, driver } = rig();
    driver.set("ch.4.mix.lvl", -10);
    await drain();
    const [m] = board.sentTo("/ch/05/mix/fader");
    expect(m.tags).toBe("f");
    expect(m.args[0]).toBeCloseTo(0.5, 6);
  });

  it("sends faders as floats even at whole values (0 and 1)", async () => {
    const { board, driver } = rig();
    driver.set("ch.0.mix.lvl", -90);
    driver.set("ch.1.mix.lvl", 10);
    await drain();
    expect(board.sentTo("/ch/01/mix/fader")[0].tags).toBe("f");
    expect(board.sentTo("/ch/02/mix/fader")[0].tags).toBe("f");
  });

  it("sends a mute as an int `on` value", async () => {
    const { board, driver } = rig();
    driver.set("ch.4.mix.on", false);
    driver.set("ch.5.mix.on", true);
    await drain();
    expect(board.sentTo("/ch/05/mix/on")[0]).toMatchObject({ tags: "i", args: [0] });
    expect(board.sentTo("/ch/06/mix/on")[0]).toMatchObject({ tags: "i", args: [1] });
  });

  it("rejects a value of the wrong type for the path", () => {
    const { driver } = rig();
    expect(() => driver.set("ch.4.mix.lvl", true)).toThrow(/ch\.4\.mix\.lvl/);
    expect(() => driver.set("ch.4.mix.on", -3)).toThrow(/ch\.4\.mix\.on/);
  });
});

describe("X32Driver — /xremote", () => {
  it("keeps receiving changes long past the board's 10 s subscription timeout", async () => {
    const { board, driver } = rig({ initial: { "/ch/01/mix/fader": 0.75 } });
    const seen: number[] = [];
    driver.subscribe("ch.0.mix.lvl", (v) => seen.push(v as number));
    await drain();

    await vi.advanceTimersByTimeAsync(30_000);
    board.changeFromElsewhere("/ch/01/mix/fader", 0.5);
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeCloseTo(-10, 4);
  });
});

describe.each([
  { echoToSender: false, label: "a board that skips the sender" },
  { echoToSender: true, label: "a board that echoes to the sender" },
])("X32Driver — change reporting, $label", ({ echoToSender }) => {
  it("reports a change made by someone else, in dB", async () => {
    const { board, driver } = rig({ echoToSender, initial: { "/ch/05/mix/fader": 0.75 } });
    const seen: number[] = [];
    await Promise.all([driver.subscribe("ch.4.mix.lvl", (v) => seen.push(v as number)), drain()]);

    board.changeFromElsewhere("/ch/05/mix/fader", 0.25);
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeCloseTo(-30, 4);
  });

  it("never reports our own write back as a change", async () => {
    const { driver } = rig({ echoToSender, initial: { "/ch/05/mix/fader": 0.75 } });
    const seen: unknown[] = [];
    await Promise.all([driver.subscribe("ch.4.mix.lvl", (v) => seen.push(v)), drain()]);

    driver.set("ch.4.mix.lvl", -5);
    await drain();
    expect(seen).toEqual([]);
  });

  it("still reports someone moving a fader back to the value we set", async () => {
    // Echo handling must not become "ignore anything equal to our last write".
    const { board, driver } = rig({ echoToSender, initial: { "/ch/05/mix/fader": 0.75 } });
    const seen: number[] = [];
    await Promise.all([driver.subscribe("ch.4.mix.lvl", (v) => seen.push(v as number)), drain()]);

    driver.set("ch.4.mix.lvl", -5);
    await drain();
    board.changeFromElsewhere("/ch/05/mix/fader", 0.5); // -10
    await settle();
    board.changeFromElsewhere("/ch/05/mix/fader", 0.625); // back to -5
    await settle();
    expect(seen.map((v) => Math.round(v))).toEqual([-10, -5]);
  });

  it("does not call a listener for a path it didn't subscribe to", async () => {
    const { board, driver } = rig({ echoToSender, initial: { "/ch/05/mix/fader": 0.75 } });
    const seen: unknown[] = [];
    await Promise.all([driver.subscribe("ch.4.mix.lvl", (v) => seen.push(v)), drain()]);

    board.changeFromElsewhere("/ch/06/mix/fader", 0.5);
    board.changeFromElsewhere("/ch/05/mix/pan", 0.1);
    await settle();
    expect(seen).toEqual([]);
  });
});

describe("X32Driver — pacing", () => {
  it("sends a single change at once, with no added delay", async () => {
    const { board, driver } = rig();
    driver.set("ch.0.mix.lvl", 0);
    await settle();
    expect(board.sentTo("/ch/01/mix/fader")).toHaveLength(1);
  });

  it("spreads a burst out instead of sending it all at once", async () => {
    const { board, driver } = rig();
    for (let ch = 0; ch < 5; ch++) driver.set(`ch.${ch}.mix.lvl`, -10);
    await settle();
    const faders = () => board.received.filter((m) => m.address.endsWith("/mix/fader"));
    expect(faders()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(faders()).toHaveLength(2);

    await drain();
    expect(faders()).toHaveLength(5);
  });

  it("sends only the latest value when a path is set again before it goes out", async () => {
    const { board, driver } = rig();
    driver.set("ch.0.mix.lvl", 0); // goes out at once
    driver.set("ch.1.mix.lvl", -30); // queued
    driver.set("ch.1.mix.lvl", -20); // replaces the queued value
    driver.set("ch.1.mix.lvl", -10); // and again
    await drain();
    const sent = board.sentTo("/ch/02/mix/fader");
    expect(sent).toHaveLength(1);
    expect(sent[0].args[0]).toBeCloseTo(0.5, 6);
  });
});

describe("X32Driver — ordering", () => {
  it("sends a replaced value after messages queued before it", async () => {
    // Fading into a mute is: mute, then restore the fader behind it. If a
    // glide already queued a fader value, the restore must still go out after
    // the mute, or the fader jumps up with the channel live.
    const { board, driver } = rig();
    driver.set("ch.9.mix.lvl", 0); // goes out at once
    driver.set("ch.0.mix.lvl", -40); // queued (a glide step)
    driver.set("ch.0.mix.on", false); // queued: the mute
    driver.set("ch.0.mix.lvl", 0); // the restore replaces the glide step
    await drain();
    const order = board.received
      .filter((m) => m.address.startsWith("/ch/01/"))
      .map((m) => m.address);
    expect(order).toEqual(["/ch/01/mix/on", "/ch/01/mix/fader"]);
  });
});

describe("X32Driver — close", () => {
  it("stops renewing /xremote and closes the transport", async () => {
    const { board, driver } = rig();
    driver.close();
    const before = board.sentTo("/xremote").length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(board.sentTo("/xremote")).toHaveLength(before);
  });
});
