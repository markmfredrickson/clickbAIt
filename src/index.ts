import { generateRpp } from "./rpp.js";
import { writeFileSync } from "fs";
import type { Song } from "./dsongl/index.js";

const song: Song = {
  title: "Don't Dream It's Over",
  artist: "Crowded House",
  masterBpm: 100,
  defaultBeats: 4,
  sections: [
    { name: "Intro",     bars: [{ beats: 4, repeat: 4 }] },
    { name: "Verse 1",   bars: [{ beats: 4, repeat: 8 }] },
    { name: "Short Bar", bars: [{ beats: 2, repeat: 1 }] },
    { name: "Chorus",    bars: [{ beats: 4, repeat: 8 }] },
    { name: "Verse 2",   bars: [{ beats: 4, repeat: 8 }] },
    { name: "Short Bar", bars: [{ beats: 2, repeat: 1 }] },
    { name: "Chorus",    bars: [{ beats: 4, repeat: 8 }] },
    { name: "Outro",     bars: [{ beats: 4, repeat: 4 }] },
  ],
};

const rpp = generateRpp(song);
const outPath = process.argv[2] ?? "/tmp/clickbait-test.rpp";
writeFileSync(outPath, rpp);
console.log(`Written: ${outPath}`);
