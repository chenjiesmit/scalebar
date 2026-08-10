import fs from "fs";
import { DOMParser } from "@xmldom/xmldom";
import path from "path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const TOOL = path.join(HERE, "..", "index.html");
const OIR_PATH = process.env.OIR || path.join(HERE, "fixture.oir");
if (!fs.existsSync(OIR_PATH)) {
  console.error(`No .oir to test against.\n  Put one at tests/fixture.oir, or run:  OIR=/path/to/file.oir node ${path.basename(process.argv[1])}`);
  process.exit(1);
}


const html = fs.readFileSync(TOOL, "utf8");
const src = html.split("/* ===PARSER_START=== */")[1].split("/* ===PARSER_END=== */")[0];

globalThis.DOMParser = DOMParser;
globalThis.Blob = class Blob {
  constructor(parts) { this.bytes = new Uint8Array(parts[0]); this.size = this.bytes.length; }
};
const OIR = new Function(src + "; return OIR;")();

const buf = fs.readFileSync(OIR_PATH);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const t0 = Date.now();
const r = OIR.parse(ab);
console.log(`parse: ${Date.now() - t0} ms for ${(buf.length / 1048576).toFixed(1)} MB`);
console.log("meta:", JSON.stringify(r.meta));
console.log("planes:", r.planes.length);
r.chans.forEach((c, i) => {
  const p = r.planes[0][i];
  console.log(` ${c.name} ${String(c.dye).padEnd(16)} lut ${c.colour} min ${p.min} max ${p.max} mean ${p.mean.toFixed(1)} display ${p.lo}-${p.hi} empty=${p.empty} clip=${p.clipped ? p.clipPct.toFixed(2)+"%" : "no"}`);
});

/* optional: a numpy dump of the same planes, to prove byte equality.
   generate with the python CLI, or skip this section. */
const TRUTH = path.join(HERE, "raw_check.bin");
if (!fs.existsSync(TRUTH)) {
  console.log("PIXELS: skipped (no raw_check.bin reference present)");
  process.exit(0);
}
const truth = fs.readFileSync(TRUTH);
const tv = new Uint16Array(truth.buffer, truth.byteOffset, truth.byteLength / 2);
let bad = 0;
r.chans.forEach((c, i) => {
  const px = r.planes[0][i].data, off = i * 512 * 512;
  for (let k = 0; k < px.length; k++) if (px[k] !== tv[off + k]) bad++;
});
console.log(bad === 0 ? "PIXELS: byte-exact vs python decode" : `PIXELS: ${bad} mismatches`);

const field = r.meta.width * r.meta.pxUm;
console.log(`suggest(${field.toFixed(1)} um field) = ${OIR.suggest(field)} um`);

fs.writeFileSync("js_gray16.tif", OIR.tiff(r.planes[0][2].data, 512, 512, { rgb: false, pxUm: r.meta.pxUm, desc: "" }).bytes);
const rgb = new Uint8Array(512*512*3);
for (let i = 0; i < 512*512; i++) { rgb[i*3] = r.planes[0][2].data[i] >> 4; rgb[i*3+2] = r.planes[0][0].data[i] >> 4; }
fs.writeFileSync("js_rgb8.tif", OIR.tiff(rgb, 512, 512, { rgb: true, pxUm: r.meta.pxUm, desc: "" }).bytes);
console.log("wrote js_gray16.tif and js_rgb8.tif");
