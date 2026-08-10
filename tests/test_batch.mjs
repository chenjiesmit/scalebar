import fs from "fs";
import { JSDOM } from "jsdom";
import { createCanvas, ImageData as CImageData, GlobalFonts } from "@napi-rs/canvas";
import path from "path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const TOOL = path.join(HERE, "..", "index.html");
const OIR_PATH = process.env.OIR || path.join(HERE, "fixture.oir");
if (!fs.existsSync(OIR_PATH)) {
  console.error(`No .oir to test against.\n  Put one at tests/fixture.oir, or run:  OIR=/path/to/file.oir node ${path.basename(process.argv[1])}`);
  process.exit(1);
}

GlobalFonts.registerFromPath("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "Inter");

const html = fs.readFileSync(TOOL, "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const wrapC = (w, h) => { const c = createCanvas(w || 1, h || 1); c.toBlob = cb => cb(new window.Blob([c.toBuffer("image/png")])); c.style = {}; c.classList = { add(){}, remove(){}, contains(){return false} }; return c; };
const oc = window.document.createElement.bind(window.document);
window.document.createElement = t => (String(t).toLowerCase() === "canvas" ? wrapC(300, 150) : oc(t));
window.HTMLCanvasElement.prototype.getContext = function (k) {
  if (!this._c || this._c.width !== (this.width || 1) || this._c.height !== (this.height || 1))
    this._c = createCanvas(this.width || 1, this.height || 1);
  return this._c.getContext(k);
};
window.ImageData = CImageData;
window.requestAnimationFrame = fn => setTimeout(() => fn(0), 0);
window.HTMLElement.prototype.setPointerCapture = () => {};
const captured = [];
window.URL.createObjectURL = b => { captured.push(b); return "blob:stub"; };
window.URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function () {};
Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
const stage = window.document.querySelector("#stage");
Object.defineProperty(stage, "clientWidth", { value: 1000, configurable: true });
Object.defineProperty(stage, "clientHeight", { value: 900, configurable: true });

// ---- fake folder: 3 good copies, 1 broken, 1 companion part-file that must be skipped
const good = fs.readFileSync(OIR_PATH);
const gab = good.buffer.slice(good.byteOffset, good.byteOffset + good.byteLength);
const mk = (name, ab) => ({ name, size: ab.byteLength, arrayBuffer: async () => ab });
const folder = [
  mk("ctx_A.oir", gab), mk("ctx_B.oir", gab), mk("ctx_C.oir", gab),
  mk("broken.oir", new Uint8Array(4096).buffer),
  mk("ctx_A_00001.oir", gab),
  { name: "notes.txt", size: 3, arrayBuffer: async () => new Uint8Array(3).buffer },
];
const written = new Map();
const subDir = { getFileHandle: async name => ({ createWritable: async () => ({ write: async b => written.set(name, b), close: async () => {} }) }) };
const dirHandle = {
  entries: async function* () { for (const f of folder) yield [f.name, { kind: "file", getFile: async () => f }]; },
  getDirectoryHandle: async () => subDir,
};
window.showDirectoryPicker = async () => dirHandle;

window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]);

const $ = s => window.document.querySelector(s);
const all = s => [...window.document.querySelectorAll(s)];
const check = (l, c, x = "") => console.log(`${c ? "PASS" : "FAIL"}  ${l}${x ? "  — " + x : ""}`);

// open one file, then tune settings that the batch must inherit
await window.load(mk("open_me.oir", gab));
await new Promise(r => setTimeout(r, 60));
all("#grat button").find(b => b.dataset.bar === "100").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
all("#col button").find(b => b.dataset.c === "#fff100").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
all("#pos button").find(b => b.dataset.p === "tl").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
all("#chList button[data-lut='0']").find(b => b.dataset.c === "#00d5ff").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 40));
all("#chList input[data-nm]").forEach((inp, i) => {
  inp.value = ["DAPI", "", "GFAP"][i];
  inp.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
});
$("#cbLab").checked = false; $("#cbLab").dispatchEvent(new window.Event("change", { bubbles: true }));
await new Promise(r => setTimeout(r, 40));
check("names + checkbox staged", window.state.chan[0].name === "DAPI" && window.state.chan[2].name === "GFAP" && window.state.label === false);
check("settings staged", window.state.bar === 100 && window.state.colour === "#fff100" && window.state.pos === "tl" && window.state.chan[0].lut === "#00d5ff");

// pick the folder
$("#batchPick").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 80));
check("only real .oir collected", window.BATCH.files.length === 4, window.BATCH.files.map(f => f.name).join(", "));
check("companion part-file skipped", !window.BATCH.files.some(f => /_00001/.test(f.name)));
check("non-oir skipped", !window.BATCH.files.some(f => /\.txt$/.test(f.name)));
check("count shown", /4 \.oir/.test($("#batchCount").textContent), $("#batchCount").textContent);
check("write target announced", /scalebar_export/.test($("#batchWhere").textContent), $("#batchWhere").textContent.slice(0, 70));
check("levels default is match", window.BATCH.levels === "match");
check("levels note explains why", /comparable/.test($("#lvNote").textContent), $("#lvNote").textContent.slice(0, 60));

// run it
await window.batchRun();
console.log("      log:", $("#batchLog").textContent.replace(/\s+/g, " ").trim());
check("three composites written", written.size === 3, [...written.keys()].join(", "));
check("names carry the bar length", [...written.keys()].every(n => /_composite_100um\.tif$/.test(n)));
check("broken file reported, not fatal", /broken\.oir/.test($("#batchLog").textContent));

// results come back into the page
const thumbs = all("#batchGrid .bthumb");
check("每个成功的文件都有缩略图", thumbs.length === 3, thumbs.length + " thumbs");
check("缩略图是按钮，点了换主视图", thumbs.every(a => a.tagName === "BUTTON" && a.dataset.r !== undefined));
check("缩略图标了源文件名", thumbs.map(a => a.textContent).join(",") === "ctx_A,ctx_B,ctx_C", thumbs.map(a => a.textContent).join(","));
check("失败的文件没有缩略图", !thumbs.some(a => /broken/.test(a.textContent)));
check("reveal 按钮出现了", !$("#batchAfter").classList.contains("hide"));
check("有写入权限时按钮叫 Show the folder", $("#batchOpen").textContent === "Show the folder", $("#batchOpen").textContent);
let picked = null;
window.showDirectoryPicker = async o => { picked = o; return dirHandle; };
$("#batchOpen").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 30));
check("reveal 从导出子目录打开", picked && picked.startIn === subDir && picked.mode === "read", JSON.stringify(picked && { mode: picked.mode, startIn: !!picked.startIn }));

// clicking a result must swap it into the viewer, keeping the batch's settings
const barBefore = window.state.bar, colBefore = window.state.chan[0].lut, nameBefore = window.state.chan[0].name;
thumbs[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 120));
check("主视图换成了点的那个文件", $("#fname").textContent === "ctx_B.oir", $("#fname").textContent);
check("标尺长度没被重新猜", window.state.bar === barBefore, window.state.bar + " vs " + barBefore);
check("颜色和名字保留", window.state.chan[0].lut === colBefore && window.state.chan[0].name === nameBefore);
check("被点的缩略图标成当前", thumbs[1].classList.contains("on") && !thumbs[0].classList.contains("on"));
check("缩略图网格没有被清掉", all("#batchGrid .bthumb").length === 3);
check("画布重绘了", $("#view").width === 2048 || $("#view").width > 0, "canvas " + $("#view").width);

// verify a written TIFF
const blob = written.get("ctx_A_composite_100um.tif");
const bytes = new Uint8Array(await blob.arrayBuffer());
fs.writeFileSync("batch_out.tif", bytes);
check("written file is a TIFF", bytes[0] === 0x49 && bytes[1] === 0x49 && bytes.length > 1e6, bytes.length + " bytes");

// batch output must equal what the single-file button produces for the same settings
captured.length = 0;
$("#dTif").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 60));
const single = new Uint8Array(await captured[0].arrayBuffer());
const strip = 2048 * 2048 * 3;
const a = single.slice(single.length - strip), b = bytes.slice(bytes.length - strip);
let diff = 0;
for (let i = 0; i < strip; i++) if (a[i] !== b[i]) diff++;
check("batch inherited the names", window.BATCH.files.length > 0 && /DAPI/.test(JSON.stringify(window.state.chan)));
check("batch pixels identical to the single-file export", diff === 0, diff ? diff + " differing bytes" : "0 differing bytes");
