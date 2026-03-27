export class TimeSignature {
  constructor(
    public readonly numerator: number,
    public readonly denominator: number,
  ) {
    if (!Number.isInteger(numerator) || numerator <= 0)
      throw new RangeError(`Numerator must be a positive integer, got ${numerator}`);
    if (!Number.isInteger(denominator) || denominator <= 0)
      throw new RangeError(`Denominator must be a positive integer, got ${denominator}`);
  }

  /** Beats per bar (same as numerator). */
  get beatsPerBar(): number {
    return this.numerator;
  }

  /**
   * Snap a beat position to the nearest grid subdivision.
   * Grid is a subdivision multiplier relative to the beat unit:
   *   1 = the beat (quarter in 4/4, eighth in 6/8)
   *   2 = half the beat (8ths in 4/4, 16ths in 6/8)
   *   4 = quarter of the beat (16ths in 4/4, 32nds in 6/8)
   * Default is 1 (snap to whole beats).
   */
  quantize(beats: number, grid: number = 1): number {
    const step = 1 / grid;
    return Math.round(beats / step) * step;
  }
}
