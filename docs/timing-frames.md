# Timing frames: where "beat 1" is

This is the thing that keeps getting relearned. Read it before touching
anything that converts between time and beats (the curve, the builder,
`build-rpp`, the relay).

## Three frames, three different "beat 1"s

"Beat 1" means three different things, and conflating them is the bug:

1. **REAPER project timeline.** Where the `.RPP` starts. The band needs room
   here before the music: a count-in, a spoken cue ("Verse 2… 1, 2, 3, 4"), a
   moment to lock in. So the project deliberately begins *before* the song.
2. **The song's beat grid.** Bar 1, beat 1 of the actual tune — the downbeat.
   This sits *after* the count-in.
3. **The first sung note.** On a pickup, the singer comes in *before* the
   downbeat — so the first note is at a beat *less than* the downbeat.

## The convention (pin this)

- **Song beat 0 = the bar-1 downbeat.** This is the one canonical origin.
  Everywhere — the manifest, the `LyricsDisplay`, the curve, the RPP — beat 0
  is the downbeat.
- **Pickups are negative beats.** A note one beat before the downbeat is at
  beat −1. Not a special case, not "nudge the section earlier" — just a beat
  below zero. Anything that handles beats must allow negative values.
- **The pre-roll is one number, and it lives at positive time / negative
  beats.** The count-in and cue play from real time 0 onward (so the cursor
  starts at 0:00 and nobody scrolls back), but the bar grid labels them as
  negative bars, with the downbeat as Bar 1.

So at time 0 the beat is negative (start of the count-in); at time
`preRollSeconds` the beat is 0 (the downbeat); pickups sit just below 0.

## How the pre-roll is encoded (two equivalent forms — from ONE helper)

One value — `paddingBeats`, the space before the downbeat (count-in + spoken
slug + any pickup room) — written two ways that mean the same thing. Both come
from **`src/core/timing-frame.ts` `downbeatFrame(paddingBeats, bpm, beatsPerBar)`**,
so the two encodings cannot drift apart:

- **The curve:** `Curve.constantBpm(bpm, { t0: downbeatFrame(...).downbeatSeconds })`.
  Time 0 maps to a negative beat; the downbeat lands at `t0`. This is what the
  `LyricsDisplay` carries, so the bundle player (playback seconds → beats) gets
  negative beats during the count-in and beat 0 at the downbeat.
- **REAPER:** `PROJOFFS 0 <downbeatFrame(...).measureOffset> 0` — start time
  stays 0 (positive timeline), and the measure offset pushes the downbeat to Bar
  1 with the pre-roll on negative bars. With `PROJOFFS 0 -4 0`, the count-in
  items sit at positive POSITION (0, 0.5, 1, …) while their bars read negative.

The measure offset uses the FULL padding, not just the slug — a count-in,
pickup, or prep-tone can push the downbeat past the slug bars. (The bug that
motivated this: PROJOFFS used the slug while the curve used the padding, so live
was a constant offset off while bundles were fine.) `downbeatFrame` also flags
`wholeBars: false` when the padding isn't a whole number of bars — then the
downbeat can't land on a bar line and `/beat/str` tracking is fractionally off.

## Why this makes everything line up

Because REAPER and the `LyricsDisplay` share the downbeat origin:

- **Live:** REAPER sends OSC `/beat/str` (measure.beat, PROJOFFS-aware), and the
  relay's `beatStrToBeats` treats Bar 1 as beat 0 — so the count-in reads as
  negative beats and the downbeat as 0. This path is tempo/playrate-proof
  (bar-based), which is why it replaced the older `/time`→curve approach for
  `LyricsDisplay` songs. (Legacy `SongPayload` songs still use `/time`→curve.)
- **Bundle:** the client runs `<audio>.currentTime` through the same curve `t0`
  → the same frame the `LyricsDisplay` word beats are in.

No offset to reconcile, no per-song fudge — as long as `PROJOFFS` and the curve
`t0` come from the same `downbeatFrame` call, which they now do.

## Superseded guidance

An older note said "never use negative offsets" when authoring lyrics. That was
a limitation of the old DSongL emitter, **not** of REAPER (which supports a
negative project start measure) or of this model. Under this convention,
negative beats are the *correct* representation for pickups and pre-roll.

## How it's threaded now (implemented)

- `generate.ts` computes `paddingBeats` once (from `buildRpp`) and passes it to
  `buildLyricsDisplay` as `renderOffsetBeats` — one number, both consumers.
- Both consumers convert it through the shared `downbeatFrame` (see above):
  `rpp.ts` uses `.measureOffset` for `PROJOFFS`; `lyrics-display.ts` uses
  `.downbeatSeconds` for the curve `t0`.
- `tests/timing-frame.test.ts` pins the two encodings together, so a change to
  one formula can't silently desync live from bundle again.

Remaining sharp edge: a fractional-bar pickup (`wholeBars: false`) leaves the
downbeat off REAPER's bar grid, so live `/beat/str` is off by a fraction of a
bar. Fixing that needs `PROJOFFS`'s time-offset field (or snapping padding to
whole bars) — not yet done; `downbeatFrame` warns when it happens.
