/**
 * Keyed crops: a song's picture can be cut to a different 16:9 box at chosen
 * times, gliding from one box to the next. Each key's box is fully in place at
 * its `at` (seconds into the phone video) and glides in, eased, over the
 * `glide` seconds before it; between glides the box holds still.
 *
 * Boxes are fractions of the frame (see `Crop` in gig.ts). `angle` turns the
 * picture under the box, in degrees about the frame's centre, clockwise when
 * positive, as the picker page shows it.
 *
 * The render does all of this in one `perspective` filter, which takes the
 * four source points that go to the frame's corners and, with per-frame
 * expressions, can move them smoothly.
 */

export interface Box {
  x: number;
  y: number;
  size: number;
  angle: number;
}

export interface CropKey {
  at: number;
  x: number;
  y: number;
  size: number;
  angle?: number;
  /** Seconds the glide into this box takes; 2 unless set. */
  glide?: number;
}

export const DEFAULT_GLIDE = 2;

const smooth = (p: number) => p * p * (3 - 2 * p);
const box = (k: CropKey): Box => ({ x: k.x, y: k.y, size: k.size, angle: k.angle ?? 0 });

/** The box at time `t`. Keys are in order and their glides don't overlap. */
export function boxAt(keys: CropKey[], t: number): Box {
  let current = box(keys[0]);
  for (const k of keys.slice(1)) {
    const glide = k.glide ?? DEFAULT_GLIDE;
    if (t >= k.at) {
      current = box(k);
      continue;
    }
    if (t > k.at - glide) {
      const s = smooth((t - (k.at - glide)) / glide);
      const next = box(k);
      return {
        x: current.x + (next.x - current.x) * s,
        y: current.y + (next.y - current.y) * s,
        size: current.size + (next.size - current.size) * s,
        angle: current.angle + (next.angle - current.angle) * s,
      };
    }
    break;
  }
  return current;
}

/**
 * Where in the source frame the box's corners are, in pixels: top-left,
 * top-right, bottom-left, bottom-right, the order `perspective` takes.
 */
export function corners(b: Box, width: number, height: number): [number, number][] {
  const a = (b.angle * Math.PI) / 180;
  const [cx, cy] = [width / 2, height / 2];
  const points: [number, number][] = [
    [b.x, b.y], [b.x + b.size, b.y], [b.x, b.y + b.size], [b.x + b.size, b.y + b.size],
  ];
  return points.map(([fx, fy]) => {
    const [dx, dy] = [fx * width - cx, fy * height - cy];
    return [cx + Math.cos(a) * dx + Math.sin(a) * dy, cy - Math.sin(a) * dx + Math.cos(a) * dy];
  });
}

/** A number for an ffmpeg expression: fixed-point, bracketed when negative. */
function num(v: number): string {
  const s = String(Number(v.toFixed(6)));
  return v < 0 ? `(${s})` : s;
}

/**
 * The `perspective` filter that cuts the keyed boxes out of the picture.
 * `start` is the phone video's time at the cut's first frame, where ffmpeg's
 * frame count `in` starts from 0.
 */
export function perspectiveFilter(keys: CropKey[], v: { start: number; fps: number }): string {
  /** One of the box's values over time: the first key's, plus each glide's change. */
  const over = (get: (b: Box) => number): string => {
    let expr = num(get(box(keys[0])));
    for (let i = 1; i < keys.length; i++) {
      const change = get(box(keys[i])) - get(box(keys[i - 1]));
      if (change === 0) continue;
      const glide = keys[i].glide ?? DEFAULT_GLIDE;
      const p = `clip((in-${num((keys[i].at - glide - v.start) * v.fps)})/${num(glide * v.fps)},0,1)`;
      expr += `+${num(change)}*${p}*${p}*(3-2*${p})`;
    }
    return expr;
  };
  const [x, y, size, angle] = [over((b) => b.x), over((b) => b.y), over((b) => b.size), over((b) => b.angle)];
  const a = `(${angle})*PI/180`;
  const point = (fx: string, fy: string) => {
    const [dx, dy] = [`((${fx})*W-W/2)`, `((${fy})*H-H/2)`];
    return [`W/2+cos(${a})*${dx}+sin(${a})*${dy}`, `H/2-sin(${a})*${dx}+cos(${a})*${dy}`];
  };
  const pts = [point(x, y), point(`${x}+${size}`, y), point(x, `${y}+${size}`), point(`${x}+${size}`, `${y}+${size}`)];
  const opts = pts.flatMap(([px, py], i) => [`x${i}='${px}'`, `y${i}='${py}'`]);
  return `perspective=${opts.join(":")}:interpolation=cubic:sense=source:eval=${keys.length > 1 ? "frame" : "init"}`;
}
