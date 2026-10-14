/**
 * The split page: one-view prompter pages tiled in iframes, so a tablet shows
 * two parts at once without arranging browser windows.
 *
 *   /split?view=drums&view=lyrics&at=60&drums=1.4
 *
 * `view` names each frame's view, in order; `at` gives where each divider
 * sits, as a percent of the screen. Every other option passes through to every
 * frame, where each takes what applies to it (sizes are keyed by channel).
 */

const MIN_VIEWS = 2;
const MAX_VIEWS = 4;
/** No frame thinner than this, in percent. */
const MIN_SHARE = 10;

export function parseSplit(query: string): { views: string[]; at: number[] } | { error: string } {
  const q = new URLSearchParams(query);
  const views = q.getAll("view").map((v) => v.trim()).filter(Boolean);
  if (views.length < MIN_VIEWS || views.length > MAX_VIEWS) {
    return { error: `a split shows ${MIN_VIEWS} to ${MAX_VIEWS} views; this link names ${views.length}` };
  }
  return { views, at: dividers(q.get("at"), views.length) };
}

function dividers(raw: string | null, views: number): number[] {
  const even = Array.from({ length: views - 1 }, (_, i) => Math.round(((i + 1) * 1000) / views) / 10);
  if (!raw) return even;
  const at = raw.split(",").map(Number);
  if (at.length !== views - 1 || at.some((x) => !Number.isFinite(x))) return even;
  const clamped = at.map((x) => Math.min(100 - MIN_SHARE, Math.max(MIN_SHARE, x)));
  // Each frame keeps its minimum: dividers in order, at least that far apart.
  const ok = clamped.every((x, i) => x - (i === 0 ? 0 : clamped[i - 1]) >= MIN_SHARE) && 100 - clamped[clamped.length - 1] >= MIN_SHARE;
  return ok ? clamped : even;
}

/** The prompter page a frame shows: its view, plus every option that isn't the split's own. */
export function frameSrc(view: string, splitQuery: string): string {
  const out = new URLSearchParams();
  out.set("view", view);
  for (const [k, v] of new URLSearchParams(splitQuery)) if (k !== "view" && k !== "at") out.append(k, v);
  return "/prompt?" + out.toString();
}

/** The split's query with the dividers moved; views and other options stay as they were. */
export function withSplitAt(splitQuery: string, at: number[]): string {
  const q = new URLSearchParams(splitQuery);
  const value = at.map((x) => String(Math.round(x * 10) / 10)).join(",");
  const parts: string[] = [];
  let placed = false;
  for (const [k, v] of q) {
    if (k === "at") {
      if (!placed) parts.push("at=" + value);
      placed = true;
    } else parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  if (!placed) parts.push("at=" + value);
  return "?" + parts.join("&");
}
