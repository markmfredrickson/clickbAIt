# Gig video: plan and resume notes

As of 2026-10-27. Branch `feature/gig-sync`, worktree `~/Code/clickbAIt-gig-sync`. The gig is `songs/gigs/2026-08-08/`.

## Where things stand

All 13 songs from the 2026-08-08 garage show have a 720p 16:9 review render with captions. The board audio is synced correctly on all 12 board songs. 01 Seven Nation Army uses the phone's own audio, so it has no sync.

- **Code:** last commit c60b4ef, not merged into `claude`. The steps are in `src/gig/` (sync, vocals, lyrics, align, captions, edges, render). `gig-recipe.ts` writes the gig's wireit tasks.
- **Sync:** each board sync matches two independent excerpts to within 5 ms. The earlier bad syncs (05, 07, 12) came from an `encoderDelay` bug, fixed in c60b4ef. Each song is searched for after the previous song's video ends, in setlist order.
- **Renders:** `renders/<nn>-<slug>-16x9-review.mp4`. The mix is 60/40 board/phone at −14 LUFS, with captions as a subtitle track. Audio and video lengths agree to within 0.05 s on every render.
- **Review page:** `renders/review.html`. Each song has its video with captions, a strip showing band, singing, talk and stretched words, and a notes box with a Copy notes button. The generator is a session script and is not in the repo yet; see "Later".
- **Cuts in gig.json** (seconds into the phone video): 01 in 1.5, 02 in 4.5, 04 in 0.5, 06 in 3, 07 in 1.0, 09 in 3. No outs yet. The plan below replaces these with automatic cuts.
- **Not committed:** the gig.json and `.gitignore` edits in the songs repo, and this file.
- **Disk:** about 2.8 GB free after the renders.

## Review notes so far

Times are in the review render's own time, which is the phone video's time minus the cut's `in`.

- **01 Seven Nation Army:** a caption shows for a long time during the silence before the song starts. The video quality is poor, so this song will probably not be released.
- **02 You Can't Hurry Love:** cut at 2:56.
- **03 Lonely Boy:** start when the guitar comes in, and cut at 3:20. The lyrics don't start until after the intro, so the aligner should never see the intro.
- **Overall:** banter before and after a song should be minimal: at most a "thank you". This replaces the earlier wish for more time at the end.

## Plan: captions and cuts from the show-track timeline

Each song's `lyrics-display.json` (a build output in the song folder) gives every lyric word as a beat, plus a curve from beats to seconds on the show track. Section boundaries are approximate and meant for people; these word timings are exact. Every song starts on the click. On some songs the band dropped the click partway through, which shows up once the live words are compared with the show-track words.

1. **New `timeline:<key>` task, run after align.**
   - **Pairing:** the live aligned words and the show-track words are the same list in the same order; Lonely Boy has 211 of each. The task pairs them by index and refuses if the texts differ.
   - **Offset:** the median gap (live minus show track) over the words near the start, where the band is known to be on the click. A median ignores stretched words, so the live alignment only needs to be roughly right.
   - **Bail point:** the first place where the median gap over a sliding window of about 8 words moves more than about 150 ms from the offset. One bad word does not trigger it. A song played on the click throughout has no bail.
   - **Output:** `work/<key>.timeline.json` with the offset, the spread around it, the bail point if any, and the song's start and end in video time.
2. **Captions.** Words come from the show-track timings plus the offset, grouped into lines the way the display groups them. Past a bail they come from the live alignment instead. No caption, and no hold on the last caption, runs past the cut's `out`.
3. **Automatic cut.** A gig.json `in` or `out` still overrides the automatic one.
   - **in:** the earlier of beat 0 and the first word, minus 0.3 s. Taking the earlier one covers pickups. For Lonely Boy this is when the guitar comes in.
   - **out:** the end of the last section plus the ring-out. After a bail, it is where the band stops instead. Either way, it reaches further only for a short phrase (2 s or less) that starts within 2 s, such as "thank you".
4. **Report** each song's offset and spread, and whether it stayed on the click or where it bailed.

## Test plan (agreed 2026-10-27)

- **Offset:**
  - word pairs give the median gap;
  - a few stretched words don't move it;
  - the spread is reported;
  - it refuses when the word texts don't match.
- **Bail:**
  - it finds the point where the band left the click;
  - a few bad words don't trigger it;
  - a song on the click throughout has none.
- **Beat to seconds:** conversion through the display curve, including beats before 0 for a pickup.
- **Automatic cut:**
  - beat 0 versus a pickup word;
  - the end of the last section plus the ring-out;
  - the band stopping after a bail;
  - a "thank you" is kept and longer talk is not;
  - a gig.json override wins.
- **Captions:**
  - show-track words placed on the video's timeline;
  - a switch to live words at the bail;
  - nothing past `out`.
- **Recipe:** the `timeline` task, its inputs (the align output and the song's `lyrics-display.json`) and its dependencies.
- **Real-data check:**
  - 02's `out` lands near 2:56;
  - 03's `in` lands on the guitar entry and its `out` near 3:20;
  - each song's spread and bail point are reported.

## Parked and later

- **Desilence remap bug** (`src/authoring/desilence-align-cli.ts`, the `remap` function): it maps a word's start and end to source time separately. A word placed across a join between kept segments therefore spans the removed silence, as Lonely Boy's first word did (0.58–43.54 s). The fix is to map each word as a unit: it goes to the segment that holds most of it and is clamped to that segment's edges. With the plan above, this only matters for gig captions past a bail. It also affects the song catalog's alignment, and may be the known issue where the first word after a long instrumental starts too early.
- **Review page as a gig task:** the generator (`review-page.mjs` and `review-template.html`) currently lives in the session's scratchpad. It should become a `review` task in the gig recipe.
- **Stage crop and shake:**
  1. Speed-test RF-DETR-Seg through `ort`: CPU against CoreML, on 30 frames.
  2. Write a Rust `motion` command. It reads gray frames piped from ffmpeg, fits a similarity transform to a reference frame (kornia-imgproc Lucas–Kanade plus our own RANSAC), and outputs person masks and a confidence.
  3. In TypeScript, add smoothing and a stage rectangle built from person boxes, then crop and rotate with ffmpeg `sendcmd`.

  Avoid Ultralytics (AGPL) and CoTracker (non-commercial).
- **9:16 clips:** Mark supplies who is singing.
- **Other:** the FLAC stems branch, and merging `feature/gig-sync` into `claude` (ask before pushing).

## How to resume

- **Run a gig task:** from the gig folder, `WIREIT_CACHE=none npm run <task>`, where the task is sync, captions, edges or render. Use `WIREIT_PARALLEL=3` for renders.
- **Force a task to re-run:** delete `.wireit/<hex of the task name>/fingerprint` in the gig folder.
- **Worktree link:** the gig's package.json reaches song manifests through the worktree. So `~/Code/clickbAIt-gig-sync/songs/deermouse` must be a symlink to `~/Code/clickbAIt/songs/deermouse`; renders fail without it. Unlink it before removing the worktree.
- **Review page:** run `npx http-server@14.1.1 -p 8642 -s -c-1 .` in `renders/` and open `http://localhost:8642/review.html`. The Chrome extension can't open file:// pages.
- **Lyrics:** keep lyric text out of chat. Handle it file to file.

## Findings, 2026-10-27 evening

I compared the live aligned words with the show-track words for every song. The manifests have not changed since the gig, so the show track is the one played. In each 10-word window I took the median gap (live minus show track). In the strips below, `#` means that window sits within 150 ms of the song's most common gap, and `.` means it doesn't. The time is the start of the last window.

```
01-seven-nation-army        ############..... (266s)
02-you-cant-hurry-love      ##########.#######.............. (172s)
03-lonely-boy               ###########......... (205s)
04-somebody-that-i-used-to  ###################.####...#.#.. (210s)
05-mary-janes-last-dance    ......................##.. (241s)
06-where-is-my-mind         .#.##.##.#####... (183s)
07-my-favorite-mistake      .............#....... (216s)
08-wicked-game              #.#...#####...#... (233s)
09-jumpin-jack-flash        ########.......... (220s)
10-dont-dream-its-over      ##.................. (177s)
11-timber                   ##..################.......##########.... (229s)
12-pink-pony-club           ###########............................ (223s)
13-like-a-stone             ............#...... (362s)
```

- **On the click, then off:** 01, 02, 03, 09 and 12 hold one gap to within about 20 ms, then lose it partway through. This looks like the bail.
- **Mostly on the click:** 04 and 11.
- **Never on this click:** 05, 07 and 13. My Favorite Mistake's gap shrinks steadily from 21 s to 3 s, so the band ran faster than the show track and kept speeding up. Like a Stone jumps by tens of seconds, and its live take (410 s) is far longer than its show track. 10 holds only at the start.
- **Patchy:** 06 and 08. This could be alignment noise or a loose feel; it needs a listen.
- **Word lists differ** for 02 (342 live, 338 show) and 10 (212 live, 249 show), so the pairing must match text in order (longest common subsequence) rather than by index.
- **Open question for Mark:** do these match what happened on the night? In particular, were 05, 07 and 13 played without the click? Also, does "off" ever mean a different arrangement (a repeated section) rather than a bail? That would show up as a steady gap at a new offset, which the strips above don't separate yet.
- **Analysis scripts:** `pair.mjs`, `fit.mjs`, `local.mjs` and `strip.mjs` are session scripts in the session scratchpad. The useful parts belong in `timeline:<key>`.
