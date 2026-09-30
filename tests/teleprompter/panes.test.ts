import { describe, it, expect } from "vitest";
import { panePages, panePageAt } from "../../src/teleprompter/panes.js";

// Rows starting every 4 beats: 0, 4, 8, ...
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ start: i * 4 }));

describe("panePages", () => {
  it("ends each page on the row the next page starts with", () => {
    expect(panePages(rows(7), 3)).toEqual([
      { first: 0, last: 2, start: 0 },
      { first: 2, last: 4, start: 8 },
      { first: 4, last: 6, start: 16 },
    ]);
  });

  it("lets the last page run short, and never makes a page of only the carried-over row", () => {
    expect(panePages(rows(4), 3)).toEqual([
      { first: 0, last: 2, start: 0 },
      { first: 2, last: 3, start: 8 },
    ]);
    expect(panePages(rows(3), 2)).toEqual([
      { first: 0, last: 1, start: 0 },
      { first: 1, last: 2, start: 4 },
    ]);
  });

  it("gives a one-row pane a page per row", () => {
    expect(panePages(rows(3), 1)).toEqual([
      { first: 0, last: 0, start: 0 },
      { first: 1, last: 1, start: 4 },
      { first: 2, last: 2, start: 8 },
    ]);
  });

  it("is one page when everything fits, and none when there are no rows", () => {
    expect(panePages(rows(2), 6)).toEqual([{ first: 0, last: 1, start: 0 }]);
    expect(panePages([], 6)).toEqual([]);
  });
});

describe("panePageAt", () => {
  const pages = panePages(rows(7), 3);

  it("turns as a page's bottom row starts, so that row is on top", () => {
    expect(panePageAt(pages, 7.9)).toBe(0);
    expect(panePageAt(pages, 8)).toBe(1);
  });

  it("stays on the last page to the end, where its bottom row is lit", () => {
    expect(panePageAt(pages, 24)).toBe(2);
    expect(panePageAt(pages, 100)).toBe(2);
  });

  it("shows the first page before anything starts", () => {
    expect(panePageAt(pages, -8)).toBe(0);
  });
});
