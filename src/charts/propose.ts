/**
 * A first draft of a chart's section links, from the score's own markers.
 *
 * Only exact matches become links: a section is linked when the score has a
 * marker on its first bar and the next marker (or the end of the score) comes
 * right after its last bar. Everything else goes on the decision list for a
 * person to settle. The proposer never guesses, never uses marker names to
 * match (they rarely agree with ours), and never writes the manifest; the
 * marker name rides along on each link so the reviewer can eyeball it.
 */

import { ordinal } from "../manifest.js";
import { songSections } from "./bar-map.js";
import type { ScoreInfo } from "./score-info.js";

export interface ProposedLink {
  section: string;
  occurrence: number;
  bars: [number, number];
  /** The score's name for this stretch, for the reviewer. Not a manifest field. */
  scoreMarker: string;
}

export function proposeLinks(
  sections: readonly { name: string; bars: number }[],
  score: ScoreInfo,
): { links: ProposedLink[]; decisions: string[] } {
  const links: ProposedLink[] = [];
  const decisions: string[] = [];
  if (score.markers.length === 0) {
    decisions.push("the score has no section markers, so every section needs linking by hand");
    return { links, decisions };
  }

  // Our sections' bars; the time signature doesn't matter for bar numbers.
  const placed = songSections(sections, [4, 4]);
  const markerAt = new Map(score.markers.map((m) => [m.bar, m.text]));
  const boundaries = [...score.markers.map((m) => m.bar), score.bars + 1];
  const nextBoundary = (bar: number) => boundaries.find((b) => b > bar) ?? score.bars + 1;

  for (const s of placed) {
    const name = `${s.name} (${ordinal(s.occurrence)})`;
    const last = s.firstBar + s.bars - 1;
    if (s.firstBar > score.bars) {
      decisions.push(`${name} starts at bar ${s.firstBar}, past the score's last bar (${score.bars})`);
      continue;
    }
    const marker = markerAt.get(s.firstBar);
    if (marker === undefined) {
      decisions.push(`${name} starts at bar ${s.firstBar}, but the score has no marker there`);
      continue;
    }
    const next = nextBoundary(s.firstBar);
    if (next !== last + 1) {
      const inside = score.markers.find((m) => m.bar > s.firstBar && m.bar <= last);
      decisions.push(
        inside
          ? `score marker "${inside.text}" at bar ${inside.bar} falls inside ${name} (bars ${s.firstBar}–${last})`
          : `${name} is bars ${s.firstBar}–${last}, but the score's "${marker}" runs ${s.firstBar}–${next - 1}`,
      );
      continue;
    }
    links.push({ section: s.name, occurrence: s.occurrence, bars: [s.firstBar, last], scoreMarker: marker });
  }
  return { links, decisions };
}
