import { describe, it, expect } from "vitest";
import { parseRate } from "../src/gig/media.js";

describe("parseRate", () => {
  it("reads ffprobe's frame rate, a fraction with whatever trails it", () => {
    expect(parseRate("30000/1001,\n")).toBeCloseTo(29.97, 2);
    expect(parseRate("30/1")).toBe(30);
  });

  it("refuses anything it can't read, rather than guessing", () => {
    expect(() => parseRate("")).toThrow();
    expect(() => parseRate("30000/")).toThrow();
    expect(() => parseRate("0/0")).toThrow();
  });
});
