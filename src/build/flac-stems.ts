/**
 * Stems moved from WAV to FLAC. `flacStemRefs` renames a song's references to
 * the stems that were converted, in its recipe (package.json) or manifest,
 * leaving every other WAV (cues, clicks, multitrack audio) alone.
 */

/** `names` are the converted stems' file names without the `.wav`. */
export function flacStemRefs(text: string, names: string[]): string {
  let out = text.split("stems/*.wav").join("stems/*.flac");
  for (const name of names) {
    out = out.split(`stems/${name}.wav`).join(`stems/${name}.flac`);
    out = out.split(`"${name}.wav"`).join(`"${name}.flac"`);
  }
  return out;
}
