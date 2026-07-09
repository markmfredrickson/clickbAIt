# Count-ins across meter changes

The auto count-in for a cued section sits in the **bar immediately before** the
section's downbeat. That bar belongs to the *previous* section, so it is counted
in the **previous section's meter** — the pulse the band is still feeling — not the
new section's.

Why: the count-in is a timing lead-in to the downbeat, heard while the band is
still in the old bar. Counting the *new* meter there lands the numbers on the wrong
beats of the old bar (a 3-beat "1 2 3" laid into a 4/4 bar starts on beat 2), and a
larger new meter overflows a short old bar and collides with earlier cues. So:

- **4/4 → 3/4**: count "… 2 3 4" (four beats, in the 4/4 the band is playing), then
  the click switches to 3/4 at the downbeat and its accent marks the new "1".
- **2/4 pickup → anything**: the count-in is only the pickup's two beats ("name 2").
  Correct, but short.

## Known-thin / unresolved cases

- **Short pickups (2/4)** give a 2-beat count (e.g. Don't Dream It's Over's Outro
  after its 2/4 pickup → "outro 2"). Correct per the rule but skimpy. For a fuller
  lead ("outro 3 4 1 2 1") use an **explicit count cue** (manual `cues[]` today, or
  a future per-section count-in schema field).

- **Odd / compound meters (7/8, 5/8, …)** — UNRESOLVED. The count places one number
  per unit of the numerator, which is right for x/4 but wrong-feeling for compound
  8ths: 7/8 is usually felt in groups (e.g. 2+2+3) and wants "1 2 3" over the groups,
  not seven even numbers. **Changing *into* such a meter is unknown territory** and
  intentionally deferred — handle with explicit count cues for now. (See the
  count-in loop in `src/build/rpp.ts`.)

## Verified by

`tests/build-rpp.test.ts`: "counts a meter-change section in the PREVIOUS section's
meter" and "does not overflow a short old bar" (2/4 pickup before 5/4).
Real songs: Dirty Work (steely-dan) — meter changes are in non-cued transitional
bars, so cued count-ins stay 4/4; Don't Dream It's Over — 2/4 pickup before the Outro.
