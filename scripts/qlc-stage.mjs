// Write a QLC+ 5 workspace with the 3D stage: lights placed and aimed, mannequins for the band, the screen.
// Usage: node scripts/qlc-stage.mjs <band lights folder>
// Reads stage-3d.json (the layout) and clickbait-rig.qxw (the base workspace: patch + Art-Net input) from the folder,
// and writes clickbait-stage.qxw, mannequin.obj and drummer.obj beside them. Those three are derived; edit the inputs.
// Our scene (meters): x across (audience-left negative), y up, z upstage positive (stage front edge z = 0).
// QLC+ 3D, from its source (qmlui/mainview3d.cpp): positions in millimeters, the grid centered on the origin, the default
// camera at z = +7.5 m, so larger Z is toward the audience. A position is an item's box corner: QLC+ adds half the item's
// size. Rotation applies -X about x, then -Y about y, then -Z about z, to a light hanging straight down, so a beam
// direction d comes from tilt X = acos(-d.y) and pan Y = atan2(-d.x, d.z).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
if (!process.argv[2]) throw new Error("usage: node scripts/qlc-stage.mjs <band lights folder>");
const dir = resolve(process.argv[2]) + "/";
const S = JSON.parse(readFileSync(dir + "stage-3d.json", "utf8"));
const GRID = { w: 8, h: 4, d: 8 }, FRONT = 6; // stage front edge 6 m back from the grid's audience side... measured from its upstage edge
const X = (x) => (x + GRID.w / 2) * 1000, Y = (y) => y * 1000, Z = (z) => (FRONT - z) * 1000; // audience at larger Z
const deg = (r) => (r * 180) / Math.PI, f2 = (v) => +v.toFixed(2);
function aimRot(pos, aim) {
  // direction in QLC axes (z flips)
  let d = [aim[0] - pos[0], aim[1] - pos[1], -(aim[2] - pos[2])]; // our z runs upstage, QLC+ Z runs toward the audience
  const n = Math.hypot(...d); d = d.map((v) => v / n);
  const tilt = Math.acos(Math.max(-1, Math.min(1, -d[1]))); // from straight down
  const pan = Math.atan2(-d[0], d[2]);
  return { XRot: f2(deg(tilt)), YRot: f2(deg(pan)), ZRot: 0 };
}
// figures as boxes (meters). QLC+ places a mesh by its bounding-box center and offsets it by half its RAW size
// (before scaling, cached per file), so every mesh is written centered and positions subtract half the raw size.
const FACES = [[1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 8, 4], [4, 8, 5, 1]];
function writeObj(file, boxes, title) {
  const ys = boxes.flatMap((b) => [b[1], b[4]]), cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let obj = "# " + title + ", meters, centered\n", base = 0;
  for (const [x0, y0, z0, x1, y1, z1] of boxes) {
    for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]) obj += `v ${x} ${(y - cy).toFixed(3)} ${z}\n`;
    for (const q of FACES) obj += `f ${q.map((k) => k + base).join(" ")}\n`;
    base += 8;
  }
  writeFileSync(dir + file, obj);
}
const UPPER = [[-0.22, 0.85, -0.12, 0.22, 1.45, 0.12], [-0.32, 0.9, -0.06, -0.22, 1.42, 0.06], [0.22, 0.9, -0.06, 0.32, 1.42, 0.06], [-0.11, 1.5, -0.11, 0.11, 1.75, 0.11]];
const LEGS = [[-0.17, 0, -0.1, -0.03, 0.85, 0.1], [0.03, 0, -0.1, 0.17, 0.85, 0.1]];
writeObj("mannequin.obj", [...LEGS, ...UPPER], "clickbAIt standing figure, 1.75 m"); // spans 0 to 1.75 m
// the drummer is seated: full size, hips at 0.55 m, thighs forward toward the audience (+z in QLC+), shins down to the floor.
// Spans 0 to 1.45 m high and -0.12 to 0.42 m deep, so its box center sits 0.15 m in front of the torso.
const SEATED_LEGS = [[-0.17, 0.45, -0.05, -0.03, 0.57, 0.42], [0.03, 0.45, -0.05, 0.17, 0.57, 0.42], [-0.17, 0, 0.32, -0.03, 0.45, 0.42], [0.03, 0, 0.32, 0.17, 0.45, 0.42]];
writeObj("drummer.obj", [...UPPER.map(([x0, y0, z0, x1, y1, z1]) => [x0, y0 - 0.3, z0, x1, y1 - 0.3, z1]), ...SEATED_LEGS], "clickbAIt seated drummer");
const FX_HALF = 63; // the fixture box is ~127 mm
const fx = S.fixtures.map((f, i) => { const r = aimRot(f.pos, f.aim); return `   <FxItem ID="${i}" XPos="${f2(X(f.pos[0]) - FX_HALF)}" YPos="${f2(Y(f.pos[1]) - FX_HALF)}" ZPos="${f2(Z(f.pos[2]) - FX_HALF)}" XRot="${r.XRot}" YRot="${r.YRot}" ZRot="0"/>`; });
const meshes = S.band.map((p, i) => `   <MeshItem ID="${i + 1}" XPos="${f2(X(p.x) - 320)}" YPos="0" ZPos="${f2(Z(p.z) - (p.drummer ? 270 : 120))}" XRot="0" YRot="0" ZRot="0" XScale="1" YScale="1" ZScale="1" Res="${dir}${p.drummer ? "drummer" : "mannequin"}.obj"/>`);
const sw = S.screen.x1 - S.screen.x0; // the screen: QLC+'s cube is 2 m raw, centered 2.4 m up, 2.1 m tall
meshes.unshift(`   <MeshItem ID="0" XPos="${f2(X((S.screen.x0 + S.screen.x1) / 2) - 1000)}" YPos="1400" ZPos="${f2(Z(4.2) - 1000)}" XRot="0" YRot="0" ZRot="0" XScale="${f2(sw / 2)}" YScale="1.05" ZScale="0.02" Res="generic/cube.obj"/>`);
// a drum kit in front of the drummer, from QLC+'s cylinder (radius 1, height 2 raw, centered, axis vertical)
// [name, x offset, height of center, z offset (toward the audience is negative), radius, height, lying on its side?]
const KIT = [["kick", 0, 0.28, -0.6, 0.28, 0.4, true], ["snare", -0.35, 0.65, -0.4, 0.18, 0.15], ["rack tom", -0.08, 0.78, -0.62, 0.15, 0.25],
  ["floor tom", 0.45, 0.42, -0.3, 0.2, 0.4], ["hi-hat", -0.62, 0.95, -0.35, 0.18, 0.02], ["crash", -0.45, 1.3, -0.7, 0.23, 0.01], ["ride", 0.58, 1.15, -0.55, 0.28, 0.01]];
const dr = S.band.find((p) => p.drummer);
KIT.forEach(([, dx, cy, dz, r, h, side]) => {
  const cx = dr.x + dx, cz = dr.z + dz;
  meshes.push(`   <MeshItem ID="${meshes.length}" XPos="${f2(X(cx) - 1000)}" YPos="${f2((cy - 1) * 1000)}" ZPos="${f2(Z(cz) - 1000)}" XRot="${side ? 90 : 0}" YRot="0" ZRot="0" XScale="${r}" YScale="${h / 2}" ZScale="${r}" Res="generic/cylinder.obj"/>`);
});
const monitor = `  <Monitor DisplayMode="1" ShowLabels="1">
   <Font>Arial,12,-1,5,400,0,0,0,0,0,0,0,0,0,0,1</Font>
   <ChannelStyle>0</ChannelStyle>
   <ValueStyle>0</ValueStyle>
   <Grid Width="${GRID.w}" Height="${GRID.h}" Depth="${GRID.d}" Units="0" POV="2"/>
   <StageItem>0</StageItem>
${fx.join("\n")}
${meshes.join("\n")}
  </Monitor>`;
const ws = readFileSync(dir + "clickbait-rig.qxw", "utf8");
const out = ws.includes("<Monitor") ? ws.replace(/  <Monitor[\s\S]*?<\/Monitor>/, monitor) : ws.replace("</Workspace>", monitor + "\n</Workspace>");
writeFileSync(dir + "clickbait-stage.qxw", out);
console.log("wrote clickbait-stage.qxw, mannequin.obj, drummer.obj");
S.fixtures.forEach((f, i) => console.log(f.name.padEnd(4), fx[i].trim()));
