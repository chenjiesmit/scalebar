import fs from "fs";
import { DOMParser } from "@xmldom/xmldom";
import { createCanvas, ImageData as CImageData, GlobalFonts } from "@napi-rs/canvas";
import path from "path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const TOOL = path.join(HERE, "..", "index.html");
const OIR_PATH = process.env.OIR || path.join(HERE, "fixture.oir");
if (!fs.existsSync(OIR_PATH)) {
  console.error(`No .oir to test against.\n  Put one at tests/fixture.oir, or run:  OIR=/path/to/file.oir node ${path.basename(process.argv[1])}`);
  process.exit(1);
}

GlobalFonts.registerFromPath("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", "IBM Plex Mono");

const html = fs.readFileSync(TOOL, "utf8");
const parserSrc = html.split("/* ===PARSER_START=== */")[1].split("/* ===PARSER_END=== */")[0];
globalThis.DOMParser = DOMParser;
globalThis.Blob = class { constructor(p){ this.bytes = new Uint8Array(p[0]); this.size = this.bytes.length; } };
const OIR = new Function(parserSrc + "; return OIR;")();

// pull the real drawing functions out of the app half of the shipped script
const app = html.split("/* ===PARSER_END=== */")[1];
const grab = name => {
  const i = app.indexOf(`function ${name}(`);
  let d = 0, j = app.indexOf("{", i);
  for (let k = j; k < app.length; k++) {
    if (app[k] === "{") d++;
    else if (app[k] === "}") { d--; if (!d) return app.slice(i, k + 1); }
  }
};
const shipped = ["compositeOn", "composite", "grey", "barGeometryOn", "barGeometry", "paintOn", "nameLabels", "paint"].map(grab).join("\n");

const buf = fs.readFileSync(OIR_PATH);
const oir = OIR.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const state = {
  oir, plane: 0, bar: 50, pos: "br", colour: "#ffffff", label: true,
  th: 1.2, fs: 5.2, mg: 4.5, up: 1, custom: null,
  chan: oir.chans.map((c, i) => ({ on: !oir.planes[0][i].empty, lut: c.colour, lo: oir.planes[0][i].lo, hi: oir.planes[0][i].hi })),
};
const env = { state, document: { createElement: () => createCanvas(8, 8) }, ImageData: CImageData };
const fns = new Function("state,document,ImageData", shipped + "; return {composite,grey,barGeometry,paint,nameLabels};")(env.state, env.document, env.ImageData);

const g = fns.barGeometry(512, 512);
console.log("bar geometry @512px:", Object.fromEntries(Object.entries(g).map(([k, v]) => [k, +v.toFixed(2)])));
console.log(`bar spans x ${g.x0.toFixed(1)}–${g.x1.toFixed(1)} (${g.px.toFixed(1)} px = ${(g.px * oir.meta.pxUm).toFixed(2)} µm) — target ${state.bar} µm`);

for (const [name, up, pos] of [["render_1x", 1, "br"], ["render_2x", 2, "br"], ["render_tl", 1, "tl"]]) {
  state.up = up; state.pos = pos;
  const c = fns.paint(fns.composite(), createCanvas(1, 1), up);
  fs.writeFileSync(name + ".png", c.toBuffer("image/png"));
  console.log(name, c.width + "×" + c.height);
}
state.up = 1; state.pos = "br";
fs.writeFileSync("render_ch3.png", fns.paint(fns.grey(2), createCanvas(1,1), 1).toBuffer("image/png"));
console.log("render_ch3", "ok");
