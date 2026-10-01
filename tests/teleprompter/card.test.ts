import { describe, it, expect } from "vitest";
import { parseNotes, notesFor, cardShowing } from "../../src/teleprompter/card.js";
import type { RowChannel } from "../../src/teleprompter/rows.js";

describe("parseNotes", () => {
  it("reads each heading's text, up to the next heading", () => {
    const { notes, errors } = parseNotes("[all]\nCount in 1-2-3-4\n\n[guitar]\nModeler: patch 123\nCapo 2\n\n[banter]\nA word about the song.\n");
    expect(errors).toEqual([]);
    expect(notes).toEqual([
      { for: "all", text: "Count in 1-2-3-4" },
      { for: "guitar", text: "Modeler: patch 123\nCapo 2" },
      { for: "banter", text: "A word about the song." },
    ]);
  });

  it("takes any instrument name as a heading, in any case", () => {
    expect(parseNotes("[Rhythm Guitar]\nx").notes).toEqual([{ for: "rhythm guitar", text: "x" }]);
  });

  it("rejects text before the first heading, and a heading it can't read", () => {
    expect(parseNotes("loose words\n[all]\nx").errors).toEqual(['line 1: text before the first heading (start with one, such as "[all]")']);
    expect(parseNotes("[all]\nx\n[]\ny").errors).toEqual(["line 3: a heading needs a name, such as [guitar]"]);
  });

  it("skips a heading with nothing under it", () => {
    expect(parseNotes("[all]\n\n[drums]\nSticks").notes).toEqual([{ for: "drums", text: "Sticks" }]);
  });
});

describe("notesFor", () => {
  const notes = [
    { for: "all", text: "everyone" },
    { for: "guitar", text: "patch 123" },
    { for: "drums", text: "sticks" },
    { for: "banter", text: "trivia" },
  ];
  const chart = (instrument: string) => ({ id: instrument, kind: "figures", chart: "tab", instrument, source: "s", track: 0, rows: [] }) as unknown as RowChannel;
  const lyrics = { id: "lyrics", kind: "lyrics", rows: [] } as RowChannel;

  it("gives a screen the notes for everyone and for the parts it shows", () => {
    expect(notesFor(notes, [chart("drums")]).map((n) => n.text)).toEqual(["everyone", "sticks"]);
  });

  it("gives the banter to a screen showing the lyrics or the vocal part", () => {
    expect(notesFor(notes, [lyrics]).map((n) => n.text)).toEqual(["everyone", "trivia"]);
    expect(notesFor(notes, [chart("vocals")]).map((n) => n.text)).toEqual(["everyone", "trivia"]);
  });

  it("gives a screen the notes for the role it asks for, whatever it shows", () => {
    expect(notesFor(notes, [lyrics], "guitar").map((n) => n.text)).toEqual(["everyone", "patch 123", "trivia"]);
  });
});

describe("cardShowing", () => {
  // The song's timeline starts 8 beats before the downbeat: the lead-in.
  it("shows while the song sits at its start, and until a beat arrives", () => {
    expect(cardShowing(null, -8)).toBe(true);
    expect(cardShowing(-8, -8)).toBe(true);
    expect(cardShowing(-7.6, -8)).toBe(true);
  });

  it("is gone once playback moves into the lead-in, so the count-in plays with the panes up", () => {
    expect(cardShowing(-7.4, -8)).toBe(false);
    expect(cardShowing(0, -8)).toBe(false);
    expect(cardShowing(100, -8)).toBe(false);
  });
});
