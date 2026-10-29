/**
 * The tracks of a REAPER project that play something, for the control page's
 * mute buttons. Read from the song's .RPP: REAPER's OSC names tracks but says
 * nothing about folders, and the folder is what groups the stems.
 *
 * A track plays if it holds items or is a folder; the band's record tracks
 * hold neither and are left out. Numbers are REAPER's 1-based track numbers,
 * which is what /track/<n>/mute addresses.
 */

export interface PlaybackTrack {
  n: number;
  name: string;
  /** The mute saved in the project; REAPER's reports update it live. */
  muted: boolean;
  folder?: true;
  /** The folder track this one sits in. */
  parent?: number;
}

const unquote = (s: string) => (s.length >= 2 && s[0] === '"' && s.at(-1) === '"' ? s.slice(1, -1) : s);

export function playbackTracks(rpp: string): PlaybackTrack[] {
  interface Raw { n: number; name: string; muted: boolean; folderDelta: number; isFolder: boolean; hasItems: boolean }
  const raws: Raw[] = [];
  let depth = 0;          // block nesting
  let trackDepth = -1;    // nesting inside the current <TRACK, or -1
  let cur: Raw | undefined;

  for (const line of rpp.split("\n")) {
    const t = line.trim();
    if (t.startsWith("<")) {
      depth++;
      if (t.startsWith("<TRACK")) {
        cur = { n: raws.length + 1, name: "", muted: false, folderDelta: 0, isFolder: false, hasItems: false };
        raws.push(cur);
        trackDepth = depth;
      } else if (cur && t.startsWith("<ITEM")) {
        cur.hasItems = true;
      }
      continue;
    }
    if (t === ">") {
      if (depth === trackDepth) { trackDepth = -1; cur = undefined; }
      depth--;
      continue;
    }
    if (!cur || depth !== trackDepth) continue;
    if (t.startsWith("NAME ")) cur.name = unquote(t.slice(5));
    else if (t.startsWith("MUTESOLO ")) cur.muted = t.split(/\s+/)[1] === "1";
    else if (t.startsWith("ISBUS ")) {
      const [, kind, delta] = t.split(/\s+/);
      cur.isFolder = kind === "1";
      cur.folderDelta = Number(delta) || 0;
    }
  }

  // Folder nesting: a folder track opens a level, a last child closes some.
  const out: PlaybackTrack[] = [];
  const parents: number[] = [];
  for (const r of raws) {
    const parent = parents.at(-1);
    if (r.hasItems || r.isFolder) {
      out.push({
        n: r.n, name: r.name, muted: r.muted,
        ...(r.isFolder ? { folder: true as const } : {}),
        ...(parent !== undefined ? { parent } : {}),
      });
    }
    if (r.folderDelta > 0) parents.push(r.n);
    else for (let i = 0; i < -r.folderDelta; i++) parents.pop();
  }
  return out;
}
