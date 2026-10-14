import { describe, it, expect } from "vitest";
import { parseSplit, frameSrc, withSplitAt } from "../../src/teleprompter/split-options.js";

// /split tiles one-view prompter pages in iframes:
//   /split?view=drums&view=lyrics&at=60&drums=1.4
// `at` gives where each divider sits, as a percent of the screen.

/** The dividers of a split that must parse. */
const at = (query: string) => {
  const s = parseSplit(query);
  if ("error" in s) throw new Error(s.error);
  return s.at;
};

describe("parseSplit", () => {
  it("reads the views in order and where the divider sits", () => {
    expect(parseSplit("?view=drums&view=lyrics&at=60")).toEqual({ views: ["drums", "lyrics"], at: [60] });
  });

  it("splits evenly when the URL doesn't say", () => {
    expect(at("?view=drums&view=lyrics")).toEqual([50]);
    expect(at("?view=a&view=b&view=c")).toEqual([33.3, 66.7]);
  });

  it("keeps every frame at least a tenth of the screen", () => {
    expect(at("?view=a&view=b&at=95")).toEqual([90]);
    expect(at("?view=a&view=b&at=2")).toEqual([10]);
    // Out of order or crowded dividers fall back to an even split.
    expect(at("?view=a&view=b&view=c&at=70,40")).toEqual([33.3, 66.7]);
  });

  it("takes two to four views", () => {
    expect(parseSplit("?view=drums")).toHaveProperty("error");
    expect(parseSplit("?view=a&view=b&view=c&view=d&view=e")).toHaveProperty("error");
    expect(parseSplit("?view=a&view=b&view=c&view=d")).not.toHaveProperty("error");
  });
});

describe("frameSrc", () => {
  it("gives each frame its view and passes the other options through", () => {
    expect(frameSrc("lyrics", "?view=drums&view=lyrics&at=60&drums=1.4&theme=light")).toBe(
      "/prompt?view=lyrics&drums=1.4&theme=light",
    );
  });
});

describe("withSplitAt", () => {
  it("moves the dividers and leaves the views and options alone", () => {
    expect(withSplitAt("?view=drums&view=lyrics&at=60&theme=light", [45])).toBe(
      "?view=drums&view=lyrics&at=45&theme=light",
    );
    expect(withSplitAt("?view=drums&view=lyrics", [45])).toBe("?view=drums&view=lyrics&at=45");
  });
});
