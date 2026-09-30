/**
 * `.lab` chord annotation files: one segment per line, `start end label` in
 * seconds, tab or space separated. This is the format chord detectors write
 * and Sonic Visualiser and Audacity edit as label layers over the audio. A
 * two-column `time label` line (an instant layer) lasts until the next one.
 * Blank lines and `#` comments are skipped.
 *
 * Times are seconds into the source recording, so a `.lab` stays right when
 * the beat map is re-timed. Labels are read by chord-label.ts.
 */

export interface LabSegment {
  start: number;
  /** Infinity for a two-column line with nothing after it. */
  end: number;
  label: string;
  /** 1-based line in the file. */
  line: number;
}

const NUMBER = /^-?\d+(?:\.\d+)?$/;

export function parseLab(text: string): { segments: LabSegment[]; errors: string[] } {
  const segments: LabSegment[] = [];
  const errors: string[] = [];
  // Two-column lines get their end from the next line's start.
  const open: LabSegment[] = [];

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (s === "" || s.startsWith("#")) return;
    const fields = s.split(/\s+/);
    let start: number;
    let end: number;
    let label: string;
    if (fields.length >= 3 && NUMBER.test(fields[0]) && NUMBER.test(fields[1])) {
      [start, end, label] = [Number(fields[0]), Number(fields[1]), fields.slice(2).join(" ")];
    } else if (fields.length >= 2 && NUMBER.test(fields[0])) {
      [start, end, label] = [Number(fields[0]), Infinity, fields.slice(1).join(" ")];
    } else {
      errors.push(`line ${line}: expected "start end label" or "time label"`);
      return;
    }
    if (end < start) {
      errors.push(`line ${line}: ends (${end}) before it starts (${start})`);
      return;
    }
    const prev = segments[segments.length - 1];
    for (const o of open.splice(0)) o.end = start;
    if (prev && start < prev.start) {
      errors.push(`line ${line}: starts at ${start}, before the line above (${prev.start})`);
    } else if (prev && start < prev.end) {
      errors.push(`line ${line}: starts at ${start}, inside the segment above (${prev.start} to ${prev.end})`);
    }
    const segment = { start, end, label, line };
    segments.push(segment);
    if (end === Infinity) open.push(segment);
  });
  return { segments, errors };
}

/** Writes segments as `start end label` lines, times to the millisecond. */
export function writeLab(
  segments: readonly { start: number; end: number; label: string }[],
  opts: { comment?: string } = {},
): string {
  const lines = segments.map((s) => `${s.start.toFixed(3)}\t${s.end.toFixed(3)}\t${s.label}`);
  return (opts.comment ? `# ${opts.comment}\n` : "") + lines.join("\n") + "\n";
}
