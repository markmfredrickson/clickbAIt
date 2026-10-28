import { describe, it, expect } from "vitest";
import { parseDisplayOptions, displayQuery } from "../../src/teleprompter/display-options.js";

describe("parseDisplayOptions", () => {
  it("reads the role a screen's player has, for the notes they see", () => {
    expect(parseDisplayOptions("?role=Guitar").role).toBe("guitar");
    expect(displayQuery({ role: "guitar" })).toBe("?role=guitar");
  });

  it("reads the offset, scroll mode and theme", () => {
    expect(parseDisplayOptions("?offset=1.5&scroll=manual&theme=light")).toEqual({
      offset: 1.5,
      scroll: "manual",
      theme: "light",
    });
  });

  it("reads the note size, the staff lines' spacing in px", () => {
    expect(parseDisplayOptions("?staff=12").staff).toBe(12);
    expect(displayQuery({ staff: 12 })).toBe("?staff=12");
    expect(parseDisplayOptions("?staff=1").staff).toBeUndefined();
  });

  it("ignores values it can't use, and the layout's options", () => {
    expect(parseDisplayOptions("?offset=x&scroll=fast&theme=blue&panes=2&view=lyrics&lyrics=2")).toEqual({});
  });
});

describe("displayQuery", () => {
  it("writes the options in a fixed order", () => {
    expect(displayQuery({ theme: "light", scroll: "manual", offset: 1 })).toBe("?offset=1&scroll=manual&theme=light");
  });

  it("is empty when there's nothing to say", () => {
    expect(displayQuery({})).toBe("");
  });

  it("reads back as the same options", () => {
    const options = { offset: 2, theme: "light" as const };
    expect(parseDisplayOptions(displayQuery(options))).toEqual(options);
  });
});
