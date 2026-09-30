import { describe, it, expect } from "vitest";
import { parseLab, writeLab } from "../../src/charts/lab.js";

describe("parseLab", () => {
  it("reads start, end and label, tab or space separated", () => {
    expect(parseLab("0.000\t2.5\tA:maj\n2.5   4.0   D:maj\n")).toEqual({
      segments: [
        { start: 0, end: 2.5, label: "A:maj", line: 1 },
        { start: 2.5, end: 4, label: "D:maj", line: 2 },
      ],
      errors: [],
    });
  });

  it("reads two-column time and label lines, each lasting until the next", () => {
    expect(parseLab("0 A\n2.5 D\n").segments).toEqual([
      { start: 0, end: 2.5, label: "A", line: 1 },
      { start: 2.5, end: Infinity, label: "D", line: 2 },
    ]);
  });

  it("skips blank lines and # comments, keeping line numbers", () => {
    expect(parseLab("# drafted from the sheet\n\n1 2 A\n").segments).toEqual([{ start: 1, end: 2, label: "A", line: 3 }]);
  });

  it("allows gaps between segments", () => {
    expect(parseLab("0 1 A\n3 4 D\n").errors).toEqual([]);
  });

  describe("errors", () => {
    const errors = (text: string) => parseLab(text).errors;

    it("names a line it can't read", () => {
      expect(errors("0 1 A\nabc D\n")).toEqual(['line 2: expected "start end label" or "time label"']);
    });

    it("rejects a segment that ends before it starts", () => {
      expect(errors("2 1 A\n")).toEqual(["line 1: ends (1) before it starts (2)"]);
    });

    it("rejects times out of order", () => {
      expect(errors("2 3 A\n1 2 D\n")).toEqual(["line 2: starts at 1, before the line above (2)"]);
    });

    it("rejects overlapping segments", () => {
      expect(errors("0 2 A\n1 3 D\n")).toEqual(["line 2: starts at 1, inside the segment above (0 to 2)"]);
    });
  });
});

describe("writeLab", () => {
  it("writes start, end and label, one segment per line, that read back the same", () => {
    const segments = [
      { start: 0.54, end: 3.78, label: "A:maj" },
      { start: 3.78, end: 7.0123, label: "D:maj7" },
    ];
    const text = writeLab(segments, { comment: "drafted from dirty-work.chords.txt" });
    expect(text).toBe("# drafted from dirty-work.chords.txt\n0.540\t3.780\tA:maj\n3.780\t7.012\tD:maj7\n");
    expect(parseLab(text).segments.map(({ start, end, label }) => ({ start, end, label }))).toEqual([
      { start: 0.54, end: 3.78, label: "A:maj" },
      { start: 3.78, end: 7.012, label: "D:maj7" },
    ]);
  });
});
