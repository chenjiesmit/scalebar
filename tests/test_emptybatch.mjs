/* Regression: a channel that is empty in the OPEN file must still be fully
   settable, because a batch inherits colour and name by channel index. If CH2 is
   dark here but bright in the next file, this row is the only place to set it.

   The test synthesises a second file by filling the empty channel's pixel blocks
   with a constant, then checks the batch output carries the colour set here.

   Needs: tests/fixture.oir   (or  OIR=/path/to/file.oir node test_emptybatch.mjs)
   The file must have at least one channel with no signal. */
import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";
import { createCanvas, ImageData as CImageData, GlobalFonts } from "@napi-rs/canvas";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const TOOL = path.join(HERE, "..", "index.html");
const OIR_PATH = process.env.OIR || path.join(HERE, "fixture.oir");
if (!fs.existsSync(OIR_PATH)) {
  console.error(`No .oir to test against.\n  Put one at tests/fixture.oir, or run:  OIR=/path/to/file.oir node ${path.basename(process.argv[1])}`);
  process.exit(1);
}
for (const f of ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                 "/System/Library/Fonts/Supplemental/Arial Bold.ttf"])
  if (fs.existsSync(f)) { GlobalFonts.registerFromPath(f, "Inter"); break; }

const html = fs.readFileSync(TOOL, "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;

// --- browser bits jsdom lacks, backed by a real canvas
const wrapC = (w, h) => {
  const c = createCanvas(w || 1, h || 1);
  c.toBlob = cb => cb(new window.Blob([c.toBuffer("image/png")]));
  c.style = {};
  c.classList = { add(){}, remove(){}, contains(){ return false; } };
  return c;
};
const origCreate = window.document.createElement.bind(window.document);
window.document.createElement = t =>
  (String(t).toLowerCase() === "canvas" ? wrapC(300, 150) : origCreate(t));
window.HTMLCanvasElement.prototype.getContext = function (k) {
  if (!this._c || this._c.width !== (this.width || 1) || this._c.height !== (this.height || 1))
    this._c = createCanvas(this.width || 1, this.height || 1);
  return this._c.getContext(k);
};
window.ImageData = CImageData;
window.requestAnimationFrame = fn => setTimeout(() => fn(0), 0);
window.URL.createObjectURL = () => "blob:stub";
window.URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function () {};
window.HTMLElement.prototype.setPointerCapture = () => {};

// --- the shipped parser, used up front to find which channel is empty
globalThis.DOMParser = window.DOMParser;
globalThis.Blob = window.Blob;
const parserSrc = html.split("/* ===PARSER_START=== */")[1].split("/* ===PARSER_END=== */")[0];
const OIR = new Function(parserSrc + "; return OIR;")();

const A = fs.readFileSync(OIR_PATH);
const aab = A.buffer.slice(A.byteOffset, A.byteOffset + A.byteLength);
const probe = OIR.parse(aab);
const emptyIdx = probe.planes[0].findIndex(p => p.empty);
if (emptyIdx < 0) {
  console.error("Every channel in this .oir has signal, so there is nothing to test here.");
  process.exit(1);
}
const emptyId = probe.chans[emptyIdx].id;

// --- scan the container for that channel's blocks, exactly as the tool does
function scanBlocks(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), out = [];
  let p = 0;
  while (p + 40 < buf.length) {
    if (dv.getInt32(p + 4, true) === 3) {
      const cl = dv.getInt32(p, true);
      if (cl > 12 && cl < 300) {
        const ul = dv.getInt32(p + 16, true);
        if (cl === ul + 12 && ul > 0 && ul < 250) {
          let ok = true;
          for (let i = 0; i < ul; i++) {
            const c = buf[p + 20 + i];
            if (c < 32 || c > 126) { ok = false; break; }
          }
          if (ok) {
            const nb = dv.getInt32(p + 20 + ul, true);
            if (nb > 0 && nb <= buf.length - p) {
              out.push({ uid: buf.toString("latin1", p + 20, p + 20 + ul), nb, off: p + 28 + ul });
              p += 28 + ul + nb;
              continue;
            }
          }
        }
      }
    }
    p++;
  }
  return out;
}
const FILL = 2000;
const B = Buffer.from(A);
const patched = scanBlocks(B).filter(b => !b.uid.startsWith("REF_LSM") && b.uid.includes(emptyId));
for (const b of patched) for (let i = 0; i + 1 < b.nb; i += 2) B.writeUInt16LE(FILL, b.off + i);
const bab = B.buffer.slice(B.byteOffset, B.byteOffset + B.byteLength);

// --- a folder holding only the synthesised file
const written = new Map();
const subDir = { getFileHandle: async n => ({ createWritable: async () => ({ write: async b => written.set(n, b), close: async () => {} }) }) };
const files = [{ name: "has_signal.oir", size: B.length, arrayBuffer: async () => bab }];
window.showDirectoryPicker = async () => ({
  entries: async function* () { for (const f of files) yield [f.name, { kind: "file", getFile: async () => f }]; },
  getDirectoryHandle: async () => subDir,
});

window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]);
const all = s => [...window.document.querySelectorAll(s)];
const $ = s => window.document.querySelector(s);
const check = (l, c, x = "") => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x ? "  — " + x : ""}`);
  if (!c) process.exitCode = 1;
};

await window.load({ name: "channel_empty.oir", size: A.length, arrayBuffer: async () => aab });
await new Promise(r => setTimeout(r, 80));
check(`channel ${emptyIdx + 1} is empty in the open file`, window.state.oir.planes[0][emptyIdx].empty);

// set colour, name and visibility on the row the old build locked
const row = () => all("#chList .ch")[emptyIdx];
row().querySelectorAll(".lut button")[2].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const nm = row().querySelector("input[data-nm]");
nm.value = "GFP"; nm.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
const cb = row().querySelector("input[data-on]");
cb.checked = true; cb.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
await new Promise(r => setTimeout(r, 60));
check("the empty row accepts colour, name and visibility",
  window.state.chan[emptyIdx].lut === "#00e35c" &&
  window.state.chan[emptyIdx].name === "GFP" &&
  window.state.chan[emptyIdx].on);

$("#batchPick").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 80));
await window.batchRun();
const outName = [...written.keys()][0];
check("the other file was written", !!outName, outName || "nothing written");

const meta = window.state.oir.meta;
const up = OIR.pickScale(meta.width, meta.height);
const W = meta.width * up, H = meta.height * up;
/* the filled channel is constant, mapped through 0..fullDepth into #00e35c
   (green 227/255), so every pixel must carry at least that much green. the
   composite takes the max per output channel, so this floor can only come
   from that channel being on, in that colour. */
const full = (1 << meta.bits) - 1;
const floor = Math.round((FILL / full) * 255 * (0xe3 / 255));
const greenFraction = async name => {
  const bytes = new Uint8Array(await written.get(name).arrayBuffer());
  const strip = bytes.slice(bytes.length - W * H * 3);
  let n = 0;
  for (let i = 0; i < strip.length; i += 3) if (strip[i + 1] >= floor - 2) n++;
  return n / (W * H);
};
const onFrac = await greenFraction(outName);
check("the batch used the colour set on the empty row", onFrac > 0.99,
  `${(100 * onFrac).toFixed(1)}% of pixels carry the green floor of ${floor}`);

// control: switch it off and that floor must vanish
cb.checked = false; cb.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
await new Promise(r => setTimeout(r, 60));
written.clear();
await window.batchRun();
const offFrac = await greenFraction([...written.keys()][0]);
check("switching it off removes it from the batch output", offFrac < 0.2,
  `${(100 * offFrac).toFixed(1)}% still at that level`);
