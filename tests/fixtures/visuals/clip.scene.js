// Shows the "counter" clip full screen, one second behind the song.
export default function scene(p, song) {
  let counter;
  p.setup = () => {
    p.createCanvas(song.width, song.height);
    counter = song.clip("counter", (s) => s.t - 1);
  };
  p.draw = () => {
    p.background(0);
    if (counter.visible) p.image(counter.frame, 0, 0, p.width, p.height);
  };
}
