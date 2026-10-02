// Asks for a stem the test song doesn't have, on its first frame.
export default function scene(p, song) {
  p.setup = () => p.createCanvas(song.width, song.height);
  p.draw = () => p.background(255 * song.now().f("bass", "low"));
}
