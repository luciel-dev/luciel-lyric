import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ctx = { console, globalThis: {} };
ctx.window = ctx;
ctx.globalThis = ctx;
runInContext(readFileSync(join(here, "../../static/engine/layers.js"), "utf8"), createContext(ctx));
const L = ctx.LLLayers;
if (!L) throw new Error("LLLayers missing");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function near(a, b, eps = 1e-6) {
  assert(Math.abs(a - b) < eps, a + " != " + b);
}

const exact = L.placeBox(1080, 1920, 1080, 1920, {fit: "fill", scale: 1, x: 0.5, y: 0.5});
near(exact.x, 0); near(exact.y, 0); near(exact.w, 1080); near(exact.h, 1920);
assert(L.isCoverDefault({fit: "fill", scale: 1, x: 0.5, y: 0.5}), "default cover");

const wide = L.placeBox(1920, 1080, 1080, 1920, L.defaultPlace());
near(wide.h, 1920);
near(wide.w, 1920 * (1920 / 1080));
near(wide.y, 0);

const fit = L.placeBox(1920, 1080, 1080, 1920, {fit: "fit", scale: 1, x: 0.5, y: 0.5});
near(fit.w, 1080);
near(fit.h, 1080 / (1920 / 1080));
near(fit.x, 0);
near(fit.y, (1920 - fit.h) / 2);

const lines = [{words: [{text: "PLEASE", start: 0.2, end: 0.8}, {text: "SEND", start: 0.8, end: 1.2}], style: {color: "#fff"}}];
const style = {posY: 0.62, size: 0.08, color: "#ffffff"};
const fp = L.textFingerprint(lines, style);
let video = {clips: [{id: "c1", in: 0, out: 4, start: 0, duration: 8}], place: L.defaultPlace(), aspect: "9:16", overlays: [], lines, style};
const edits = [
  {op: "trim", index: 0, edge: "out", delta: -0.4},
  {op: "move", index: 0, start: 0.2},
  {op: "scale", scale: 1.2},
  {op: "position", x: 0.4, y: 0.6},
  {op: "fit", fit: "fit"},
  {op: "fit", fit: "crop"},
  {op: "aspect", aspect: "1:1"},
  {op: "aspect", aspect: "16:9"},
  {op: "aspect", aspect: "4:5"},
  {op: "scale", scale: 0.8},
  {op: "split", index: 0, at: 1.2},
  {op: "overlay", text: "Title", start: 0, end: 2},
];
for (const edit of edits) video = L.applyVideoEdit(video, edit);
assert(!("lines" in video) && !("style" in video), "video edit returned lyric fields");
assert(L.textFingerprint(lines, style) === fp, "fingerprint changed");
assert(JSON.stringify(lines) === JSON.stringify([{words: [{text: "PLEASE", start: 0.2, end: 0.8}, {text: "SEND", start: 0.8, end: 1.2}], style: {color: "#fff"}}]), "lines mutated");
assert(video.clips.length === 2, "split");
assert(video.overlays.length === 1 && video.overlays[0].text === "Title", "overlay");
assert(video.aspect === "4:5", "aspect");
assert(video.place.fit === "crop" && Math.abs(video.place.scale - 0.8) < 1e-6, "place");
console.log("layers-test ok");
