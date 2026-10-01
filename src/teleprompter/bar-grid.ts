/**
 * The grid a bar of chords is drawn on: a column per beat when every chord
 * falls on one, eighths or sixteenths only when a chord needs them, so a bar
 * stays as narrow as its chords allow. A chord's `at` is where it falls in
 * the bar, 0 to 1; `starts` are 1-based columns.
 */
export function barGrid(bar: { beats: number; chords: readonly { at: number }[] }): { columns: number; starts: number[] } {
  const beats = Math.max(1, Math.round(bar.beats));
  const fits = (per: number) => bar.chords.every((c) => Math.abs(c.at * beats * per - Math.round(c.at * beats * per)) < 1e-6);
  const per = [1, 2].find(fits) ?? 4;
  return { columns: beats * per, starts: bar.chords.map((c) => Math.round(c.at * beats * per) + 1) };
}
