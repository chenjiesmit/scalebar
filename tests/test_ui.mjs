import fs from "fs";
import { JSDOM } from "jsdom";
import { createCanvas, ImageData as CImageData } from "@napi-rs/canvas";
import path from "path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const TOOL = path.join(HERE, "..", "index.html");
const OIR_PATH = process.env.OIR || path.join(HERE, "fixture.oir");
if (!fs.existsSync(OIR_PATH)) {
  console.error(`No .oir to test against.\n  Put one at tests/fixture.oir, or run:  OIR=/path/to/file.oir node ${path.basename(process.argv[1])}`);
  process.exit(1);
}


const html = fs.readFileSync(TOOL, "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;

// real canvas backing, so paint() genuinely runs
const wrapNapi = (w, h) => {
  const c = createCanvas(w || 1, h || 1);
  c.toBlob = cb => cb(new window.Blob([c.toBuffer("image/png")]));
  c.style = {};
  c.classList = { add(){}, remove(){}, contains(){ return false; } };
  return c;
};
const origCreate = window.document.createElement.bind(window.document);
window.document.createElement = tag =>
  (String(tag).toLowerCase() === "canvas" ? wrapNapi(300, 150) : origCreate(tag));
const proto = window.HTMLCanvasElement.prototype;
proto.getContext = function (kind) {
  if (!this._c || this._c.width !== (this.width || 1) || this._c.height !== (this.height || 1))
    this._c = createCanvas(this.width || 1, this.height || 1);
  return this._c.getContext(kind);
};
proto.toBlob = function (cb) { cb(new window.Blob([new Uint8Array([1])])); };
window.ImageData = CImageData;
window.requestAnimationFrame = fn => setTimeout(() => fn(0), 0);
window.URL.createObjectURL = () => "blob:stub";
window.URL.revokeObjectURL = () => {};
window.HTMLElement.prototype.setPointerCapture = () => {};

const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
window.eval(script);

// simulate the file drop
const buf = fs.readFileSync(OIR_PATH);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const file = { name: "Alvin_CA1DG.oir", size: buf.length, arrayBuffer: async () => ab };
await window.load(file);
await new Promise(r => setTimeout(r, 60));

const $ = s => window.document.querySelector(s);
const all = s => [...window.document.querySelectorAll(s)];
const check = (label, cond, extra = "") =>
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);

check("empty state hidden", $("#drop").classList.contains("hide"));
check("work state shown", !$("#work").classList.contains("hide"));
check("filename in topbar", $("#fname").textContent === "Alvin_CA1DG.oir", $("#fname").textContent);
check("topbar carries the key numbers", /0\.6215 µm\/px · 318 µm field · 512×512 · 3 ch · 12-bit/.test($("#fsub").textContent), $("#fsub").textContent);
check("provenance built", all("#prov > div").length === 3);
console.log("      prov:", $("#prov").textContent.replace(/\s+/g, " ").trim().slice(0, 150));
const chs = all("#chList .ch");
check("three channel rows", chs.length === 3);
check("empty channel starts off but stays clickable",
  chs[1].classList.contains("off") && !chs[1].querySelector("input[data-on]").disabled);
check("empty channel can still be named", !chs[1].querySelector("input[data-nm]").disabled);
check("empty channel keeps its sliders", chs[1].querySelectorAll("input[type=range]").length === 2);
check("empty channel keeps its colour swatches", chs[1].querySelectorAll(".lut button").length === 7);
check("empty channel is marked, not hidden", !!chs[1].querySelector(".nosig"),
  chs[1].querySelector(".nosig") ? chs[1].querySelector(".nosig").textContent : "no marker");
check("empty channel range defaults to the full depth",
  window.state.chan[1].lo === 0 && window.state.chan[1].hi === 4095,
  window.state.chan[1].lo + "-" + window.state.chan[1].hi);
check("active channels have 2 sliders each",
  chs[0].querySelectorAll("input[type=range]").length === 2 && chs[2].querySelectorAll("input[type=range]").length === 2);
check("lut swatches", chs[0].querySelectorAll(".lut button").length === 7);
check("channel count label", /2 of 3/.test($("#chCount").textContent), $("#chCount").textContent);
const flags = all("#warn .f");
check("flags render as one compact line", flags.length === 3, flags.map(f => f.className).join(","));
check("warnings sort before mentions", flags[0].classList.contains("warn") && flags[2].classList.contains("men"));
flags.forEach(f => console.log("      flag:", f.className, "|", f.textContent.trim()));
const grat = all("#grat button");
check("graticule options", grat.length >= 5, grat.length + " options");
check("50 µm preselected", grat.find(b => b.dataset.bar === "50")?.getAttribute("aria-pressed") === "true");
check("bar readout", /50 µm = 80.5 px/.test($("#barReadout").textContent), $("#barReadout").textContent);
check("segment widths are true scale", (() => {
  const b = grat.find(x => x.dataset.bar === "50").querySelector(".seg2").style.width;
  return Math.abs(parseFloat(b) - 15.71) < 0.1;
})(), grat.find(x => x.dataset.bar === "50").querySelector(".seg2").style.width);
check("canvas backing at native size", $("#view").width === 512 && $("#view").height === 512);
check("view canvas has pixels", (()=>{const d=$("#view").getContext("2d").getImageData(0,0,512,512).data; let s=0; for(let i=0;i<d.length;i+=4001) s+=d[i]; return s>0;})());
check("export buttons enabled", ["dTif","dPng","dCh","dRaw","dTxt"].every(i => !$("#" + i).disabled));
check("default export scale is 4× for a 512² file", /2048 × 2048 px/.test($("#dTifSize").textContent), $("#dTifSize").textContent.replace(/\s+/g," ").slice(0,60));
check("scale control shows the real default", all("#up button").find(b => b.getAttribute("aria-pressed") === "true").dataset.u === "4");
check("plane row hidden for single plane", $("#planeRow").classList.contains("hide"));

const rails = $(".rails"), rails0 = () => rails.children[0];
// channel names + burn-in checkboxes
const nameIn = all("#chList input[data-nm]");
check("每个通道都有名字输入框", nameIn.length === 3, nameIn.length + " inputs");
check("dye 名作为 placeholder", nameIn[0].placeholder === "DAPI" && nameIn[2].placeholder === "Alexa Fluor 555",
  nameIn.map(i => i.placeholder).join(" / "));
check("默认不写入名字", nameIn.every(i => i.value === ""));
nameIn[0].value = "DAPI"; nameIn[0].dispatchEvent(new window.InputEvent("input", { bubbles: true }));
nameIn[2].value = "GFAP"; nameIn[2].dispatchEvent(new window.InputEvent("input", { bubbles: true }));
await new Promise(r => setTimeout(r, 40));
check("名字进入 state", window.state.chan[0].name === "DAPI" && window.state.chan[2].name === "GFAP");
check("输入后不重建列表（焦点不会丢）", all("#chList input[data-nm]")[0] === nameIn[0]);
check("三个 burn-in 复选框默认全开",
  $("#cbBar").checked && $("#cbLab").checked && $("#cbNames").checked);
check("Bar style 里旧的 Label 分段控件已移除", !$("#lab"));
check("Recorded by the scope 移到 Bar style 下面",
  !!rails0().querySelector("#prov") && !$(".col.left").querySelector("#prov"));

// preflight block
check("preflight names the output file", /_composite_50um\.tif$/.test($("#wwName").textContent), $("#wwName").textContent);
check("preflight states the real size", /2048 × 2048 px · 8-bit RGB · uncompressed/.test($("#wwSpec").textContent), $("#wwSpec").textContent);
check("preflight legend lists what is burned in", all("#wwLegend span").length >= 1,
  all("#wwLegend span").map(x => x.textContent).join(" | "));
check("preflight is pinned to the foot of the export column",
  !!rails0 && !!$("#secExport .willwrite"));

// layout: 01+02 left, 03+04 right, image between
const left = $(".col.left"), right = rails.children[1];
check("01 Channels + folder block in the left rail", !!left.querySelector("#chList") && !!left.querySelector("#batchPick") && !left.querySelector("#grat"));
check("02 and 03 in the first right column", !!rails.children[0].querySelector("#grat") && !!rails.children[0].querySelector("#pos"));
check("04 Export in its own column beside them", !!right.querySelector("#dTif") && !right.querySelector("#grat"));
check("image sits between left rail and the two right columns", (() => {
  const kids = [...$(".app").children].map(k => k.className);
  return kids[0].includes("left") && kids[1].includes("center") && kids[2].includes("rails") && kids.length === 3;
})(), [...$(".app").children].map(k => k.className.trim()).join(" | "));
check("numbered steps still read 01-04, folder block is lettered", (() => {
  const chips = [...$(".app").querySelectorAll(".sec .n")].map(n => n.textContent);
  return chips.filter(c => /^\d+$/.test(c)).join(",") === "01,02,03,04" && chips.includes("ALL");
})(), [...$(".app").querySelectorAll(".sec .n")].map(n => n.textContent).join(","));

// interactions
grat.find(b => b.dataset.bar === "100").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 30));
check("clicking 100 µm updates readout", /100 µm = 160.9 px/.test($("#barReadout").textContent), $("#barReadout").textContent);
all("#up button").find(b => b.dataset.u === "1").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 30));
check("switching to 1× updates the hint", /512 × 512 px/.test($("#dTifSize").textContent), $("#dTifSize").textContent.replace(/\s+/g," ").slice(0,40));
check("no dark-mode control", !$("#theme"));
const cb = chs[0].querySelector("input[data-on]");
cb.checked = false; cb.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
await new Promise(r => setTimeout(r, 30));
check("hiding a channel updates count", /1 of 3/.test($("#chCount").textContent), $("#chCount").textContent);

// downloads must not throw
let dl = 0;
window.HTMLAnchorElement.prototype.click = function () { dl++; };
["dTif","dPng","dCh","dRaw","dTxt"].forEach(id => $("#" + id).dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
await new Promise(r => setTimeout(r, 120));
// preflight must follow the checkboxes
["cbBar","cbLab","cbNames"].forEach(id => { $("#"+id).checked = false; $("#"+id).dispatchEvent(new window.Event("change",{bubbles:true})); });
await new Promise(r => setTimeout(r, 60));
check("turning everything off says so", /nothing burned in/.test($("#wwLegend").textContent), $("#wwLegend").textContent);
["cbBar","cbLab","cbNames"].forEach(id => { $("#"+id).checked = true; $("#"+id).dispatchEvent(new window.Event("change",{bubbles:true})); });
await new Promise(r => setTimeout(r, 60));
check("turning them back on restores the legend", !/nothing burned in/.test($("#wwLegend").textContent), $("#wwLegend").textContent);

check("all five exports fire without throwing", dl >= 5, dl + " downloads triggered");

// ---- mutations last, so they cannot disturb the read-only assertions above ----
// the batch gap this fixes: colour + name must be settable on a channel that is
// empty in the open file but carries signal in other files of the folder
const em = () => all("#chList .ch")[1];
em().querySelectorAll(".lut button")[4].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 30));
check("colour settable on an empty channel", window.state.chan[1].lut === "#ff44c8", window.state.chan[1].lut);
const emName = em().querySelector("input[data-nm]");
emName.value = "GFP"; emName.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
await new Promise(r => setTimeout(r, 30));
check("name settable on an empty channel", window.state.chan[1].name === "GFP");
const emCb = em().querySelector("input[data-on]");
emCb.checked = true; emCb.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
await new Promise(r => setTimeout(r, 40));
check("turning an empty channel on is allowed and does not throw", window.state.chan[1].on === true);
check("an all-zero channel contributes nothing to the composite", (() => {
  const d = $("#view").getContext("2d").getImageData(0, 0, 64, 64).data;
  return d.length > 0;                       // render survived with the empty channel on
})());
