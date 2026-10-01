// White only during beat 16; black everywhere else.
export default function scene(p, song) {
  p.setup = () => p.createCanvas(song.width, song.height);
  p.draw = () => p.background(Math.floor(song.now().beat) === 16 ? 255 : 0);
}
