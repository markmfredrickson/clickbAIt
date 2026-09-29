/**
 * Kindle screen sleep. The Kindle's sleep timer counts only touches — a page
 * that keeps changing on its own still goes dark when the timer runs out — so
 * the e-ink client reminds the player to tap. It can't read the timer setting;
 * the page is told it (`/eink?sleep=<minutes>`).
 */

/** Mid-song, remind this long before the timer runs out. */
const FINAL_WARNING_MS = 2 * 60_000;

/**
 * Whether to show the tap reminder. Between songs it's cheap to tap, so remind
 * once half the timer has gone; mid-song, only when it's nearly out.
 */
export function needsTapReminder(o: { sinceTouchMs: number; sleepMs: number; songEnded: boolean }): boolean {
  if (o.sinceTouchMs >= o.sleepMs - FINAL_WARNING_MS) return true;
  return o.songEnded && o.sinceTouchMs >= o.sleepMs / 2;
}
