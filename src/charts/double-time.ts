/**
 * Rewrite a score written in half time at the tempo the band counts. A score
 * transcribed at 82 for a song the band hears at 164 has one bar for every
 * two of ours, and the chart build maps one score bar to one song bar.
 *
 * Every note becomes twice as long and the tempo doubles, so the music sounds
 * the same. The doubled bars are cut into 4/4 bars: a 4/4 bar becomes two and
 * a 2/4 bar becomes one. A note that crosses a new barline is split, and the
 * second part is tied to the first; a rest is just split. Section markers stay
 * on the first of the new bars.
 *
 * The work happens on alphaTab's plain-object form of the score (its JSON
 * converter), where copying a beat for a split is a structuredClone. Bars
 * whose doubled length isn't whole 4/4 bars, repeats, and tuplets are refused
 * rather than guessed at; this score has none of them.
 */

import * as alphaTab from "@coderline/alphatab";

type Obj = Map<string, unknown>;

/** alphaTab's tick length of a quarter note. */
const QUARTER = 960;
const NEW_BAR = 4 * QUARTER;

/** Note values alphaTab can write, longest first, as [duration, ticks]. */
const VALUES: [number, number][] = [-4, -2, 1, 2, 4, 8, 16, 32, 64, 128, 256].map((d) => [
  d,
  d < 0 ? 4 * QUARTER * -d : (4 * QUARTER) / d,
]);

const dotted = (ticks: number, dots: number) => ticks * (2 - 1 / 2 ** dots);

/** One written value (duration, dots) for a length, or several tied ones when no single value fits. */
function noteValues(ticks: number): { duration: number; dots: number }[] {
  for (const [duration, plain] of VALUES) {
    for (const dots of [0, 1, 2]) if (dotted(plain, dots) === ticks) return [{ duration, dots }];
  }
  const out: { duration: number; dots: number }[] = [];
  let left = ticks;
  for (const [duration, plain] of VALUES) {
    while (plain <= left) {
      out.push({ duration, dots: 0 });
      left -= plain;
    }
  }
  if (left !== 0) throw new Error(`can't write a note ${ticks} ticks long`);
  return out;
}

const list = (o: Obj, key: string) => o.get(key) as Obj[];

export function doubleTime(score: alphaTab.model.Score): alphaTab.model.Score {
  const settings = new alphaTab.Settings();
  const json = alphaTab.model.JsonConverter.scoreToJsObject(score) as Obj;
  const masterBars = list(json, "masterbars");

  // How many 4/4 bars each source bar becomes.
  const splits = masterBars.map((mb, i) => {
    const bar = i + 1;
    if (mb.get("isrepeatstart") || (mb.get("repeatcount") as number) > 0 || (mb.get("alternateendings") as number) > 0) {
      throw new Error(`bar ${bar} has a repeat or an alternate ending, which double time doesn't handle`);
    }
    const num = mb.get("timesignaturenumerator") as number;
    const den = mb.get("timesignaturedenominator") as number;
    const doubledTicks = 2 * num * ((4 * QUARTER) / den);
    if (doubledTicks % NEW_BAR !== 0) {
      throw new Error(`bar ${bar} is in ${num}/${den}, which doubled isn't a whole number of 4/4 bars`);
    }
    return doubledTicks / NEW_BAR;
  });

  json.set("masterbars", masterBars.flatMap((mb, i) => splitMasterBar(mb, splits[i])));
  for (const track of list(json, "tracks")) {
    for (const staff of list(track, "staves")) {
      staff.set("bars", list(staff, "bars").flatMap((bar, i) => splitBar(bar, splits[i], i + 1)));
    }
  }
  renumber(json);
  return alphaTab.model.JsonConverter.jsObjectToScore(json, settings);
}

function splitMasterBar(mb: Obj, count: number): Obj[] {
  const tempos = list(mb, "tempoautomations") ?? [];
  return Array.from({ length: count }, (_, k) => {
    const out = structuredClone(mb);
    out.set("timesignaturenumerator", 4);
    out.set("timesignaturedenominator", 4);
    out.set("timesignaturecommon", false);
    if (k > 0) out.delete("section");
    out.set(
      "tempoautomations",
      tempos
        .filter((a) => Math.min(Math.floor((a.get("ratioposition") as number) * count), count - 1) === k)
        .map((a) => {
          const t = structuredClone(a);
          t.set("ratioposition", (a.get("ratioposition") as number) * count - k);
          t.set("value", (a.get("value") as number) * 2);
          return t;
        }),
    );
    return out;
  });
}

function splitBar(bar: Obj, count: number, barNumber: number): Obj[] {
  const halves = Array.from({ length: count }, () => {
    const out = structuredClone(bar);
    out.set("voices", []);
    return out;
  });
  for (const voice of list(bar, "voices")) {
    const pieces = splitVoice(list(voice, "beats"), count, barNumber);
    halves.forEach((half, k) => {
      const v = structuredClone(voice);
      v.set("beats", pieces[k]);
      list(half, "voices").push(v);
    });
  }
  return halves;
}

/** A voice's beats, doubled and dealt into `count` new bars. */
function splitVoice(beats: Obj[], count: number, barNumber: number): Obj[][] {
  const bars: Obj[][] = Array.from({ length: count }, () => []);
  // A voice with nothing in it is one empty beat; each new bar gets its own.
  if (beats.length > 0 && beats.every((b) => b.get("isempty"))) return bars.map(() => [structuredClone(beats[0])]);

  let at = 0;
  let graces: Obj[] = [];
  for (const beat of beats) {
    if ((beat.get("tupletnumerator") as number) > 0 && beat.get("tupletnumerator") !== beat.get("tupletdenominator")) {
      throw new Error(`bar ${barNumber} has a tuplet, which double time doesn't handle`);
    }
    // A grace note keeps its own value and goes with the beat it leads into.
    if ((beat.get("gracetype") as number) !== 0) {
      graces.push(beat);
      continue;
    }
    const duration = beat.get("duration") as number;
    const plain = duration < 0 ? 4 * QUARTER * -duration : (4 * QUARTER) / duration;
    const length = 2 * dotted(plain, beat.get("dots") as number);

    // Cut at each new barline, then write each part in note values.
    const parts: { bar: number; ticks: number }[] = [];
    for (let start = at, left = length; left > 0; ) {
      const bar = Math.floor(start / NEW_BAR);
      const ticks = Math.min(left, (bar + 1) * NEW_BAR - start);
      parts.push({ bar, ticks });
      start += ticks;
      left -= ticks;
    }
    if (parts[parts.length - 1].bar >= count) {
      throw new Error(`bar ${barNumber} holds more than its time signature allows`);
    }
    const written = parts.flatMap((p) => noteValues(p.ticks).map((v) => ({ bar: p.bar, ...v })));
    written.forEach((w, i) => {
      const piece = i === 0 ? beat : continuation(beat);
      piece.set("duration", w.duration);
      piece.set("dots", w.dots);
      if (i === 0) bars[w.bar].push(...graces);
      if (i === written.length - 1 && i > 0) moveEndings(beat, piece);
      bars[w.bar].push(piece);
    });
    graces = [];
    at += length;
  }
  // A bar written short leaves later new bars with nothing; alphaTab wants a beat in every voice.
  return bars.map((beats) => (beats.length > 0 ? beats : [emptyBeat(beats[0])]));
}

function emptyBeat(like: Obj): Obj {
  const out = continuation(like);
  out.set("isempty", true);
  out.set("notes", []);
  out.set("duration", 4);
  out.set("dots", 0);
  return out;
}

/** A copy of a beat that carries on its notes, tied, with nothing that happens at a beat's start. */
function continuation(beat: Obj): Obj {
  const out = structuredClone(beat);
  for (const key of ["automations", "lyrics"]) out.delete(key);
  out.set("text", null);
  out.set("chordid", null);
  out.set("pickstroke", 0);
  out.set("brushtype", 0);
  for (const note of list(out, "notes") ?? []) {
    note.set("istiedestination", true);
    note.set("slideouttype", 0);
    note.set("ishammerpullorigin", false);
    note.set("slideintype", 0);
    note.set("accentuated", 0);
  }
  return out;
}

/** What happens as a note ends (a slide or hammer-on out of it) belongs on its last part. */
function moveEndings(first: Obj, last: Obj): void {
  const firstNotes = list(first, "notes") ?? [];
  const lastNotes = list(last, "notes") ?? [];
  firstNotes.forEach((note, i) => {
    for (const key of ["slideouttype", "ishammerpullorigin"]) {
      lastNotes[i]?.set(key, note.get(key));
      note.set(key, key === "slideouttype" ? 0 : false);
    }
  });
}

/**
 * Give every bar, voice, beat and note its own id again after the copying.
 * Notes link to each other by id (ties, slides, hammer-ons, slurs); those
 * links go, and alphaTab finds them again from the notes' order and strings,
 * as it does for a Guitar Pro 5 file.
 */
function renumber(json: Obj): void {
  let bar = 0;
  let voice = 0;
  let beat = 0;
  let note = 0;
  for (const track of list(json, "tracks")) {
    for (const staff of list(track, "staves")) {
      for (const b of list(staff, "bars")) {
        b.set("id", bar++);
        for (const v of list(b, "voices")) {
          v.set("id", voice++);
          for (const bt of list(v, "beats")) {
            bt.set("id", beat++);
            for (const n of list(bt, "notes") ?? []) {
              n.set("id", note++);
              for (const key of [...n.keys()]) if (key.endsWith("noteid")) n.delete(key);
            }
          }
        }
      }
    }
  }
}

/**
 * The score as a Guitar Pro 7 file. A drum track without a drum list (every
 * Guitar Pro 5 drum track) names each note's drum by id, but alphaTab's writer
 * reads that number as a place in the standard list it writes, so every hit
 * lands on another drum. Writing once and reading back gives that standard
 * list, which alphaTab doesn't export; the track gets it and each note its
 * drum's place in it.
 */
export function toGuitarPro(score: alphaTab.model.Score): Uint8Array {
  const settings = new alphaTab.Settings();
  const write = () => new alphaTab.exporter.Gp7Exporter().export(score, settings);
  const bare = score.tracks.filter((t) => t.staves.some((s) => s.isPercussion) && t.percussionArticulations.length === 0);
  if (bare.length === 0) return write();

  const back = alphaTab.importer.ScoreLoader.loadScoreFromBytes(write(), settings);
  for (const track of bare) {
    const list = back.tracks[track.index].percussionArticulations;
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            for (const note of beat.notes) {
              if (!note.isPercussion) continue;
              const place = list.findIndex((a) => a.id === note.percussionArticulation);
              if (place < 0) throw new Error(`track "${track.name}" bar ${bar.index + 1}: no standard drum ${note.percussionArticulation}`);
              note.percussionArticulation = place;
            }
          }
        }
      }
    }
    track.percussionArticulations = list;
  }
  return write();
}
