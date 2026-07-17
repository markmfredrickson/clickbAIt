/**
 * Pure decision logic for the teleprompter's highlight + auto-scroll.
 *
 * Imported into the bundled browser client so the "what's active now" rule lives
 * in ONE tested place instead of being re-scanned inline at every site (word
 * highlight, legacy line highlight, scroll targeting each had their own copy).
 */

/**
 * Index of the last item at or before `beat` — the active word / line / section
 * — or -1 if `beat` precedes them all. Items must be ascending in beat (words,
 * lines, and sections are emitted in song order). Scans newest-first, the exact
 * rule the client used inline everywhere.
 */
export function activeIndex<T>(
  items: readonly T[],
  beat: number,
  getBeat: (item: T) => number,
): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (beat >= getBeat(items[i])) return i;
  }
  return -1;
}
