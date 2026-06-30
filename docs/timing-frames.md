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

## How the pre-roll is encoded (two equivalent forms)

One value — the pre-roll — written two ways that mean the same thing:

- **The curve:** `Curve.constantBpm(bpm, { t0: preRollSeconds })`. Time 0 maps
  to a negative beat; the downbeat lands at `t0`. This is what the
  `LyricsDisplay` carries, so a client converting playback seconds → beats gets
  negative beats during the count-in and beat 0 at the downbeat.
- **REAPER:** `PROJOFFS <startTimeSeconds> <measureOffset> <flag>`. We use
  `PROJOFFS 0 -<preRollBars> 0` — start time stays 0 (positive timeline), and
  the measure offset pushes the downbeat to Bar 1 with the pre-roll on negative
  bars. Verified: with `PROJOFFS 0 -4 0`, the count-in items sit at positive
  POSITION (0, 0.5, 1, …) while their bars read negative.

## Why this makes everything line up

Because REAPER and the `LyricsDisplay` share the downbeat origin:

- REAPER plays from time 0 and sends OSC `/time` as positive seconds.
- The relay runs those seconds through the song curve → negative beats during
  the count-in, beat 0 at the downbeat, positive after — which is exactly the
  frame the `LyricsDisplay` word beats are in.

No offset to reconcile, no per-song fudge. The pre-roll is the curve's `t0`,
the same number REAPER stores as its `PROJOFFS` measure offset.

## Superseded guidance

An older note said "never use negative offsets" when authoring lyrics. That was
a limitation of the old DSongL emitter, **not** of REAPER (which supports a
negative project start measure) or of this model. Under this convention,
negative beats are the *correct* representation for pickups and pre-roll.

## To do (threading it through)

- `preRoll` as a manifest field (bars or seconds — one source of truth).
- `build-lyrics-cli`: build the song curve with `t0 = preRollSeconds`.
- The RPP build: emit `PROJOFFS 0 -preRollBars 0` and place count-in/cue items
  at positive time; the song's downbeat content starts at `preRollSeconds`.
