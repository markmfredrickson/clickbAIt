/**
 * Bail mutes the Stems folder, and coming back puts it as it was. The folder
 * is muted by default (the band plays live), so a return must never unmute
 * stems that were already off. `held` is the folder's state saved at the
 * first silence; an unknown state counts as muted, the projects' default.
 */
export function stemsSend(
  audible: boolean,
  held: boolean | undefined,
  knownMuted: boolean | undefined,
): { mute?: boolean; held: boolean | undefined } {
  if (!audible) return { mute: true, held: held ?? knownMuted ?? true };
  if (held === undefined) return { held: undefined };
  return { mute: held, held: undefined };
}

/**
 * Whether to send REAPER's /repeat to reach `want`. /repeat is a toggle (a 1
 * flips it, a 0 does nothing), so it goes out only when the state REAPER last
 * reported differs. Unreported counts as off, REAPER's default.
 */
export function repeatToggle(known: boolean | undefined, want: boolean): boolean {
  return (known ?? false) !== want;
}
