import { describe, it, expect } from "vitest";
import {
  LAYOUTS,
  channelChoices,
  einkSplash,
  paneChannel,
  parseLayout,
  promptFromSplit,
  withLayout,
} from "../../src/teleprompter/pane-layout.js";
import type { RowDocument } from "../../src/teleprompter/rows.js";

// A prompter page shows one pane, or two split by a divider:
//   /prompt?panes=2&split=vertical&view=chords&view=lyrics&at=60
// A vertical split has a vertical divider, so the panes sit side by side.

/** A layout that must parse. */
const layout = (query: string) => {
  const l = parseLayout(query);
  if ("error" in l) throw new Error(l.error);
  return l;
};

// The channels in an order that isn't the one they're offered in.
const DOC: RowDocument = {
  schema: "clickbait/rows@1",
  slug: "test-song",
  title: "Test Song",
  sections: [{ name: "Verse", start: 0, end: 4, bars: 1, beatsPerBar: 4 }],
  channels: [
    { id: "kit", kind: "figures", chart: "drums", instrument: "drums", source: "song.gp5", track: 3, rows: [] },
    { id: "chords", kind: "chords", rows: [] },
    { id: "rhythm-guitar", kind: "figures", chart: "tab", instrument: "guitar", source: "song.gp5", track: 1, rows: [] },
    { id: "lyrics", kind: "lyrics", rows: [] },
  ],
};

describe("parseLayout", () => {
  it("shows one pane with no divider", () => {
    expect(layout("?panes=1&view=lyrics")).toEqual({ panes: 1, split: "vertical", views: ["lyrics"], at: 50 });
  });

  it("splits two panes down the middle, side by side, when the URL doesn't say", () => {
    expect(layout("?panes=2&view=chords&view=lyrics")).toEqual({ panes: 2, split: "vertical", views: ["chords", "lyrics"], at: 50 });
  });

  it("reads a horizontal split, and takes anything else as vertical", () => {
    expect(layout("?panes=2&split=horizontal").split).toBe("horizontal");
    expect(layout("?panes=2&split=sideways").split).toBe("vertical");
  });

  it("keeps each pane at least a tenth of the screen", () => {
    expect(layout("?panes=2&at=60").at).toBe(60);
    expect(layout("?panes=2&at=95").at).toBe(90);
    expect(layout("?panes=2&at=2").at).toBe(10);
    expect(layout("?panes=2&at=wide").at).toBe(50);
  });

  it("leaves a pane without a view empty, for the reader to fill", () => {
    expect(layout("?panes=2").views).toEqual([null, null]);
    expect(layout("?panes=2&view=&view=lyrics").views).toEqual([null, "lyrics"]);
    expect(layout("").views).toEqual([null]);
  });

  it("shows one pane when the URL doesn't say how many", () => {
    expect(layout("?view=drums")).toEqual({ panes: 1, split: "vertical", views: ["drums"], at: 50 });
  });

  it("won't guess at a layout it can't show", () => {
    expect(parseLayout("?panes=3")).toHaveProperty("error");
    expect(parseLayout("?panes=two")).toHaveProperty("error");
    expect(parseLayout("?panes=1&view=chords&view=lyrics")).toHaveProperty("error");
  });
});

describe("withLayout", () => {
  it("flips the split and leaves the other options alone", () => {
    expect(withLayout("?panes=2&view=chords&view=lyrics&theme=light", { flip: true })).toBe(
      "?panes=2&split=horizontal&view=chords&view=lyrics&theme=light",
    );
    expect(withLayout("?panes=2&split=horizontal&view=chords&view=lyrics", { flip: true })).toBe(
      "?panes=2&split=vertical&view=chords&view=lyrics",
    );
  });

  it("swaps the panes, keeping the divider where it is", () => {
    expect(withLayout("?panes=2&split=vertical&view=chords&view=lyrics&at=30", { swap: true })).toBe(
      "?panes=2&split=vertical&view=lyrics&view=chords&at=30",
    );
    const once = withLayout("?panes=2&split=vertical&view=chords&view=lyrics", { swap: true });
    expect(withLayout(once, { swap: true })).toBe("?panes=2&split=vertical&view=chords&view=lyrics");
  });

  it("moves the divider", () => {
    expect(withLayout("?panes=2&split=vertical&view=chords&view=lyrics", { at: 62.34 })).toBe(
      "?panes=2&split=vertical&view=chords&view=lyrics&at=62.3",
    );
  });

  it("fills or changes one pane's channel, keeping the empty slot before it", () => {
    expect(withLayout("?panes=2&split=vertical", { pane: 1, view: "lyrics" })).toBe(
      "?panes=2&split=vertical&view=&view=lyrics",
    );
    expect(withLayout("?panes=2&split=vertical&view=&view=lyrics", { pane: 0, view: "kit" })).toBe(
      "?panes=2&split=vertical&view=kit&view=lyrics",
    );
  });

  it("reads back as the layout it wrote", () => {
    const q = withLayout("?panes=2&view=chords&theme=light", { pane: 1, view: "lyrics" });
    expect(layout(q)).toEqual({ panes: 2, split: "vertical", views: ["chords", "lyrics"], at: 50 });
    expect(new URLSearchParams(q).get("theme")).toBe("light");
  });
});

describe("the channels a pane can show", () => {
  it("offers the song's channels, lyrics and chords first, then its parts in order", () => {
    expect(channelChoices(DOC)).toEqual([
      { name: "lyrics", label: "Lyrics" },
      { name: "chords", label: "Chords" },
      { name: "kit", label: "Kit" },
      { name: "rhythm-guitar", label: "Rhythm guitar" },
    ]);
  });

  it("finds a pane's channel by id or by instrument", () => {
    expect(paneChannel(DOC, "kit")?.id).toBe("kit");
    expect(paneChannel(DOC, "guitar")?.id).toBe("rhythm-guitar");
  });

  it("finds nothing when the song lacks the channel, rather than showing another", () => {
    expect(paneChannel(DOC, "bass")).toBeNull();
  });
});

describe("the picker's layouts", () => {
  it("offers one pane and the two splits, each opening empty panes", () => {
    expect(LAYOUTS.map((l) => l.href)).toEqual([
      "/prompt?panes=1",
      "/prompt?panes=2&split=vertical",
      "/prompt?panes=2&split=horizontal",
    ]);
  });
});

describe("old split links", () => {
  it("open the same views side by side on the prompter page", () => {
    expect(promptFromSplit("?view=drums&view=lyrics&at=60&theme=light")).toBe(
      "/prompt?panes=2&split=vertical&view=drums&view=lyrics&at=60&theme=light",
    );
  });

  it("pass on every view they named, so a link with too many is refused, not cut short", () => {
    const href = promptFromSplit("?view=a&view=b&view=c");
    expect(href).toBe("/prompt?panes=2&split=vertical&view=a&view=b&view=c");
    expect(parseLayout(href.slice("/prompt".length))).toHaveProperty("error");
  });
});

describe("einkSplash", () => {
  it("links each of the song's channels to its own e-ink page, in the order they're offered", () => {
    const html = einkSplash(DOC);
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(["/eink?channel=lyrics", "/eink?channel=chords", "/eink?channel=kit", "/eink?channel=rhythm-guitar"]);
  });

  it("keeps the page's other options, such as which way it's turned, on every link", () => {
    const html = einkSplash(DOC, [], "rotate=left&font=40");
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links[0]).toBe("/eink?channel=lyrics&amp;rotate=left&amp;font=40");
  });

  it("waits for a song, and looks again by itself", () => {
    const html = einkSplash(null);
    expect(html).not.toContain("href=");
    expect(html).toContain('http-equiv="refresh"');
  });

  it("with no song playing, offers the set's channels by what carries across songs: lyrics, chords, then instruments", () => {
    const other: RowDocument = {
      ...DOC,
      slug: "other",
      channels: [
        { id: "guitar-nick", kind: "figures", chart: "tab", instrument: "guitar", source: "b.gp5", track: 0, rows: [] },
        { id: "bass", kind: "figures", chart: "tab", instrument: "bass", source: "b.gp5", track: 2, rows: [] },
        { id: "lyrics", kind: "lyrics", rows: [] },
      ],
    };
    const html = einkSplash(null, [DOC, other]);
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(["/eink?channel=lyrics", "/eink?channel=chords", "/eink?channel=drums", "/eink?channel=guitar", "/eink?channel=bass"]);
    expect(html).not.toContain('http-equiv="refresh"'); // a list to pick from, not a page that reloads under the finger
  });
});
