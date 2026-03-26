export interface Event {
  at: number; // 1-indexed beat within the bar
  type: "chord" | "lyric" | "cue" | "marker";
  value: string | string[];
}

export interface Bar {
  beats?: number;         // beats in this bar; defaults to song.defaultBeats
  repeat?: number;        // how many times this bar repeats; defaults to 1
  bpmMultiplier?: number; // tempo relative to master BPM; defaults to 1.0
  events?: Event[];
}

export interface Section {
  name: string;
  bars: Bar[];
  color?: number;    // REAPER region color; defaults to 1
  endBeat?: number;  // explicit region end in beats from section start; defaults to sum of bar beats
}

export interface Song {
  title: string;
  artist?: string;
  masterBpm: number;
  defaultBeats?: number;  // default beats per bar; defaults to 4
  leadInBars?: number;    // silent click-only bars before first section; defaults to 0
  sections: Section[];
}
