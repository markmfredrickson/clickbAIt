/**
 * The mixer interface fader-now talks to.
 *
 * Paths and units copy Mixing Station's data model, so a driver for Mixing
 * Station itself is a pass-through and the X32 driver is a translation:
 *
 *   ch.4.mix.lvl   channel 5 fader, in dB (-90 .. +10)
 *   ch.4.mix.on    channel 5 on, a boolean (false = muted)
 *   bus.0.mix.lvl  bus 1 fader, in dB
 *
 * Indices are 0-based, as in Mixing Station. Which paths a driver supports is
 * up to the driver; an unsupported path is an error, never a silent no-op.
 */

/** A parameter path in Mixing Station's form, e.g. "ch.0.mix.lvl". */
export type MixerPath = string;

/** dB for levels, a boolean for `on`. */
export type MixerValue = number | boolean;

export interface MixerDriver {
  /**
   * Ask the board for a parameter's current value and watch it from then on.
   * `listener` hears changes made by anyone else: the driver never reports
   * its own writes back, whether or not the board echoes them.
   */
  subscribe(path: MixerPath, listener: (value: MixerValue) => void): Promise<MixerValue>;

  /** Set a parameter. Sends are paced; a newer value for a path replaces an unsent one. */
  set(path: MixerPath, value: MixerValue): void;

  close(): void;
}
