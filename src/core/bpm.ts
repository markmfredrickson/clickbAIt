export class BPM {
  constructor(public readonly value: number) {
    if (value <= 0) throw new RangeError(`BPM must be positive, got ${value}`);
  }

  /** Milliseconds per beat. */
  get msPerBeat(): number {
    return 60_000 / this.value;
  }

  /** Seconds per beat. */
  get secondsPerBeat(): number {
    return 60 / this.value;
  }

  /** Convert a duration in seconds to beats. */
  secondsToBeats(seconds: number): number {
    return (seconds / 60) * this.value;
  }

  /** Convert a duration in beats to seconds. */
  beatsToSeconds(beats: number): number {
    return (beats / this.value) * 60;
  }

  /** Convert milliseconds to beats. */
  msToBeats(ms: number): number {
    return this.secondsToBeats(ms / 1000);
  }

  /** Convert beats to milliseconds. */
  beatsToMs(beats: number): number {
    return this.beatsToSeconds(beats) * 1000;
  }

  /** Return a new BPM scaled by a factor. */
  scale(factor: number): BPM {
    return new BPM(this.value * factor);
  }
}
