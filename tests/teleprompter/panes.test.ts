import { describe, it, expect } from "vitest";
import { panePages, panePageAt, pagesByHeight } from "../../src/teleprompter/panes.js";

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

// A page that fills its frame: rows of different heights, as many as fit.
describe("pagesByHeight", () => {
  const rows = [100, 100, 100, 250, 100, 100].map((height, i) => ({ start: i * 4, height }));

  it("fits as many rows as the height allows, starting each page on the last row of the one before", () => {
    expect(pagesByHeight(rows, 200).map((p) => [p.first, p.last])).toEqual([
      [0, 1],
      [1, 2],
      [3, 3],
      [4, 5],
    ]);
  });

  it("starts fresh when the repeated row and the next one won't fit together", () => {
    // Rows 2 and 3 make 350: page two starts on row 3, not on a lone repeat of row 2.
    expect(pagesByHeight(rows, 300).map((p) => [p.first, p.last])).toEqual([
      [0, 2],
      [3, 3],
      [4, 5],
    ]);
  });

  it("gives a row taller than the space a page to itself", () => {
    expect(pagesByHeight(rows, 200).find((p) => p.first === 3)).toEqual({ first: 3, last: 3, start: 12 });
  });

  it("is one page when everything fits", () => {
    expect(pagesByHeight(rows, 2000)).toEqual([{ first: 0, last: 5, start: 0 }]);
  });
});
