import { describe, it, expect } from "vitest";
import { parseOscFloat, parseOscPacket, parseOscMessage, secondsToBeats, beatStrToBeats } from "../../src/teleprompter/relay.js";
import type { SongPayload } from "../../src/teleprompter/types.js";

/** Build a minimal OSC message with address and a single float arg. */
function buildOscMessage(address: string, value: number): Buffer {
  // Address: null-terminated, padded to 4 bytes
  const addrBuf = Buffer.from(address + "\0");
  const addrPadded = Buffer.alloc(Math.ceil(addrBuf.length / 4) * 4);
  addrBuf.copy(addrPadded);

  // Type tag: ",f\0" padded to 4 bytes
  const tagBuf = Buffer.alloc(4);
  tagBuf.write(",f\0");

  // Float: 32-bit big-endian
  const floatBuf = Buffer.alloc(4);
  floatBuf.writeFloatBE(value);

  return Buffer.concat([addrPadded, tagBuf, floatBuf]);
}

describe("parseOscFloat", () => {
  it("parses a /beat message with float value", () => {
    const msg = buildOscMessage("/beat", 42.5);
    const result = parseOscFloat(msg);
    expect(result).not.toBeNull();
    expect(result!.address).toBe("/beat");
    expect(result!.value).toBeCloseTo(42.5);
  });

  it("parses address with different path", () => {
    const msg = buildOscMessage("/position/bar", 7);
    const result = parseOscFloat(msg);
    expect(result).not.toBeNull();
    expect(result!.address).toBe("/position/bar");
    expect(result!.value).toBeCloseTo(7);
  });

  it("handles zero value", () => {
    const msg = buildOscMessage("/beat", 0);
    const result = parseOscFloat(msg);
    expect(result!.value).toBe(0);
  });

  it("handles negative value", () => {
    const msg = buildOscMessage("/beat", -4.5);
    const result = parseOscFloat(msg);
    expect(result!.value).toBeCloseTo(-4.5);
  });

  it("returns null for empty buffer", () => {
    expect(parseOscFloat(Buffer.alloc(0))).toBeNull();
  });

  it("returns null for non-float type tag", () => {
    // Build a message with ",s" type tag (string, not float)
    const addrBuf = Buffer.from("/beat\0\0\0"); // 8 bytes
    const tagBuf = Buffer.alloc(4);
    tagBuf.write(",s\0");
    const buf = Buffer.concat([addrBuf, tagBuf, Buffer.from("hello\0\0\0")]);
    expect(parseOscFloat(buf)).toBeNull();
  });
});

/** Build an OSC bundle containing multiple messages. */
function buildOscBundle(...messages: { address: string; value: number }[]): Buffer {
  const header = Buffer.from("#bundle\0"); // 8 bytes
  const timetag = Buffer.alloc(8); // 8 bytes of zeros (immediate)
  const parts = [header, timetag];

  for (const msg of messages) {
    const msgBuf = buildOscMessage(msg.address, msg.value);
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeInt32BE(msgBuf.length);
    parts.push(sizeBuf, msgBuf);
  }

  return Buffer.concat(parts);
}

describe("parseOscPacket", () => {
  it("parses a bare float message", () => {
    const msg = buildOscMessage("/time", 1.5);
    const results = parseOscPacket(msg);
    expect(results).toHaveLength(1);
    expect(results[0].address).toBe("/time");
    expect(results[0].type).toBe("float");
    if (results[0].type === "float") expect(results[0].value).toBeCloseTo(1.5);
  });

  it("unwraps a bundle with multiple float messages", () => {
    const bundle = buildOscBundle(
      { address: "/time", value: 2.5 },
      { address: "/play", value: 1.0 },
    );
    const results = parseOscPacket(bundle);
    expect(results).toHaveLength(2);
    expect(results[0].address).toBe("/time");
    expect(results[1].address).toBe("/play");
  });

  it("parses a string message in a bundle", () => {
    // Build a bundle with a string message: /lastregion/name ,s "Intro"
    const strAddr = Buffer.from("/lastregion/name\0\0\0\0"); // 20 bytes (padded)
    const strTag = Buffer.alloc(4);
    strTag.write(",s\0");
    const strVal = Buffer.from("Intro\0\0\0"); // 8 bytes (padded)
    const strMsg = Buffer.concat([strAddr, strTag, strVal]);

    const header = Buffer.from("#bundle\0");
    const timetag = Buffer.alloc(8);
    const size = Buffer.alloc(4);
    size.writeInt32BE(strMsg.length);
    const bundle = Buffer.concat([header, timetag, size, strMsg]);

    const results = parseOscPacket(bundle);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("string");
    if (results[0].type === "string") {
      expect(results[0].address).toBe("/lastregion/name");
      expect(results[0].value).toBe("Intro");
    }
  });

  it("parses mixed float and string messages in a bundle", () => {
    const floatMsg = buildOscMessage("/time", 3.0);
    const strAddr = Buffer.from("/beat/str\0\0\0"); // 12 bytes
    const strTag = Buffer.alloc(4);
    strTag.write(",s\0");
    const strVal = Buffer.from("1.1.00\0\0"); // 8 bytes
    const strMsg = Buffer.concat([strAddr, strTag, strVal]);

    const header = Buffer.from("#bundle\0");
    const timetag = Buffer.alloc(8);
    const size1 = Buffer.alloc(4);
    size1.writeInt32BE(floatMsg.length);
    const size2 = Buffer.alloc(4);
    size2.writeInt32BE(strMsg.length);

    const bundle = Buffer.concat([header, timetag, size1, floatMsg, size2, strMsg]);
    const results = parseOscPacket(bundle);
    expect(results).toHaveLength(2);
    expect(results[0].type).toBe("float");
    expect(results[0].address).toBe("/time");
    expect(results[1].type).toBe("string");
    expect(results[1].address).toBe("/beat/str");
  });
});

describe("secondsToBeats", () => {
  const simpleSong: SongPayload = {
    title: "Test",
    slug: "test",
    bpm: 120,
    tempoMap: [{ beat: 0, seconds: 0, bpm: 120 }],
    sections: [],
  };

  it("converts seconds to beats at constant tempo", () => {
    // 120 BPM = 2 beats/sec
    expect(secondsToBeats(0, simpleSong)).toBeCloseTo(0);
    expect(secondsToBeats(1, simpleSong)).toBeCloseTo(2);
    expect(secondsToBeats(4, simpleSong)).toBeCloseTo(8);
    expect(secondsToBeats(30, simpleSong)).toBeCloseTo(60);
  });

  const tempoChangeSong: SongPayload = {
    title: "Test",
    slug: "test",
    bpm: 120,
    tempoMap: [
      { beat: 0, seconds: 0, bpm: 120 },
      { beat: 8, seconds: 4, bpm: 60 },  // slows to 60 BPM at beat 8 (4 sec)
    ],
    sections: [],
  };

  it("handles tempo changes", () => {
    // First 4 seconds: 120 BPM → 8 beats
    expect(secondsToBeats(4, tempoChangeSong)).toBeCloseTo(8);
    // After tempo change: 60 BPM = 1 beat/sec
    // 4 sec + 2 sec at 60 BPM = 8 + 2 = 10 beats
    expect(secondsToBeats(6, tempoChangeSong)).toBeCloseTo(10);
  });

  it("handles empty tempo map", () => {
    const empty: SongPayload = { title: "T", slug: "t", bpm: 90, tempoMap: [], sections: [] };
    // Falls back to master BPM: 90 BPM = 1.5 beats/sec
    expect(secondsToBeats(2, empty)).toBeCloseTo(3);
  });
});

describe("beatStrToBeats", () => {
  // REAPER /beat/str "measure.beat.hundredths", PROJOFFS-aware (downbeat = m1).
  it("maps the downbeat (measure 1) to beat 0", () => {
    expect(beatStrToBeats("1.1.00", 4)).toBeCloseTo(0);
  });
  it("maps count-in (negative measures) to negative beats", () => {
    expect(beatStrToBeats("-3.1.13", 4)).toBeCloseTo(-15.87); // 4 bars before downbeat
    expect(beatStrToBeats("-1.1.00", 4)).toBeCloseTo(-8);
  });
  it("combines measure, beat, and hundredths", () => {
    expect(beatStrToBeats("5.2.50", 4)).toBeCloseTo(17.5); // (5-1)*4 + (2-1) + 0.5
  });
  it("honors odd meter", () => {
    expect(beatStrToBeats("2.1.00", 3)).toBeCloseTo(3); // (2-1)*3
  });

  describe("with a meter map (2/4 pickup)", () => {
    // Crowded House: a 2/4 pickup at measure 36, back to 4/4 at measure 37.
    // segments computed by build-lyrics-display.
    const meterMap = [
      { fromMeasure: 1, beatsPerBar: 4, beatsBefore: 0 },
      { fromMeasure: 36, beatsPerBar: 2, beatsBefore: 140 },
      { fromMeasure: 37, beatsPerBar: 4, beatsBefore: 142 },
    ];
    it("matches constant 4/4 before the meter change", () => {
      expect(beatStrToBeats("5.1.00", meterMap)).toBeCloseTo(16); // (5-1)*4
    });
    it("counts the 2/4 pickup as 2 beats, not 4", () => {
      expect(beatStrToBeats("36.1.00", meterMap)).toBeCloseTo(140); // start of pickup
      expect(beatStrToBeats("37.1.00", meterMap)).toBeCloseTo(142); // pickup added only 2
    });
    it("stays 2 beats lower than a constant-4 assumption after the pickup", () => {
      // measure 50 beat 1: correct 194, NOT (50-1)*4 = 196
      expect(beatStrToBeats("50.1.00", meterMap)).toBeCloseTo(194);
    });
    it("uses the first segment's meter for count-in measures", () => {
      expect(beatStrToBeats("-1.1.00", meterMap)).toBeCloseTo(-8); // (-1-1)*4
    });
  });
});
