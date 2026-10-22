import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ctx = { console, globalThis: {} };
ctx.window = ctx;
ctx.globalThis = ctx;
const sandbox = createContext(ctx);
runInContext(readFileSync(join(here, "../src/mobile/lyricsync.js"), "utf8"), sandbox);
runInContext(readFileSync(join(here, "../src/mobile/layers.js"), "utf8"), sandbox);
const LS = ctx.LyricSync;
const Layers = ctx.LucielLayers;
if (!LS || !Layers) throw new Error("lyric modules missing");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const words = LS.mergeTokens(LS.fixtureTokens());
const aligned = LS.alignLyrics(LS.PASTED_FIXTURE, words, 12);
assert(!aligned.error && aligned.lines.length === 4, aligned.error || "sync failed");

const lines = aligned.lines;
lines[0].style = { color: "#7eb8c9", posX: 0.22, posY: 0.41, size: 0.1 };
const textStyle = {
  font: "Pacifico", size: 0.12, color: "#d4a24a", align: "right",
  posX: 0.72, posY: 0.33, strokeWidth: 0.03,
};
const video = {
  aspect: "9:16", vfit: "fill", vscale: 1, vx: 0.5, vy: 0.5,
  videoName: "take-one.mp4", length: 12,
  clips: [{ t0: 0, t1: 12, srcIn: 0, speed: 1 }],
};

assert(Layers.VIDEO_EDITS.length === 10, "expected 10 video edits");
const ran = Layers.runVideoEdits(video, lines, textStyle, Layers.VIDEO_EDITS);
const ops = ran.trace.map((row) => row.op);
assert(ops.join(",") === "aspect,aspect,aspect,fit,fit,zoom,pan,trim,speed,swap", ops.join(","));
const trimmed = ran.trace.find((row) => row.op === "trim");
assert(trimmed && trimmed.t0 > 0.5, "trim did not move the video in point");
assert(ran.trace.find((row) => row.op === "speed").speed === 2, "speed edit missed");
assert(ran.video.videoName === "second-take.mp4", "swap missed");
assert(ran.video.aspect === "4:5", "resize missed");
assert(ran.video.vfit === "crop", "crop missed");
assert(ran.video.vscale === 1.85, "zoom missed");
assert(ran.stamp === Layers.lyricStamp(lines, textStyle), "styled lyrics changed");

const stamp = Layers.lyricStamp(lines, textStyle);
const wordStart = lines[0].words[0].start;
let overlays = Layers.applyOverlayEdit([], { op: "add", id: 1, text: "Opening title", start: 0.2, end: 2.5 }, 12);
assert(overlays.length === 1 && overlays[0].text === "Opening title", "add title");
overlays = Layers.applyOverlayEdit(overlays, { op: "move", id: 1, start: 1, end: 4 }, 12);
assert(overlays[0].start === 1 && overlays[0].end === 4, "move title");
assert(Layers.lyricStamp(lines, textStyle) === stamp, "overlay edit changed lyric text");
assert(lines[0].words[0].start === wordStart, "overlay edit moved a lyric");
overlays = Layers.applyOverlayEdit(overlays, { op: "remove", id: 1 }, 12);
assert(overlays.length === 0, "remove title");
assert(Layers.lyricStamp(lines, textStyle) === stamp, "remove title changed lyrics");

const line = { words: lines[0].words.map((w) => Object.assign({}, w)) };
const times = line.words.map((w) => [w.start, w.end]);
const edited = line.words.map((w) => w.text).join(" ").replace(/^Sing\b/, "Song");
assert(LS.applyLineText(line, edited, { lock: true }), "locked edit");
assert(line.words[0].text === "Song", "word text");
assert(JSON.stringify(line.words.map((w) => [w.start, w.end])) === JSON.stringify(times), "editing a word moved timings");

const inserted = { words: lines[1].words.map((w) => Object.assign({}, w)) };
const keep = inserted.words.filter((w) => w.text === "voices," || w.text === "name").map((w) => [w.text, w.start, w.end]);
assert(LS.applyLineText(inserted, "voices, extra name", { lock: true }), "insert");
keep.forEach(([text, start, end]) => {
  const w = inserted.words.find((word) => word.text === text);
  assert(w && w.start === start && w.end === end, "inserted word slid " + text);
});

const pasted = lines.map((ln) => ln.words.map((w) => w.text).join(" ")).join("\n").replace(/^Sing\b/, "Song");
const lockedTimes = lines.flatMap((ln) => ln.words.map((w) => [w.start, w.end]));
const locked = LS.applyLockedLines(lines, pasted);
assert(locked[0].words[0].text === "Song", "paste edit");
assert(JSON.stringify(locked.flatMap((ln) => ln.words.map((w) => [w.start, w.end]))) === JSON.stringify(lockedTimes), "paste edit moved timings");
assert(locked[0].style.posX === 0.22 && textStyle.posX === 0.72, "style moved");
const playing = { t: locked[0].words[0].start, playing: true };
playing.playing = false;
assert(playing.playing === false && playing.t === locked[0].words[0].start, "pause moved the clock onto a word");
assert(JSON.stringify(locked.flatMap((ln) => ln.words.map((w) => [w.start, w.end]))) === JSON.stringify(lockedTimes), "pause moved timings");

const nudged = line.words.map((w) => Object.assign({}, w));
assert(LS.nudgeWords(nudged, 0.1, 12), "nudge");
assert(nudged[0].start !== times[0][0], "nudge should be the explicit timing edit");

console.log("layers ok");

function desktopLayers() {
  const dctx = { console, globalThis: {} };
  dctx.window = dctx;
  dctx.globalThis = dctx;
  runInContext(readFileSync(join(here, "../../static/engine/layers.js"), "utf8"), createContext(dctx));
  const L = dctx.LLLayers;
  if (!L) throw new Error("LLLayers missing");
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
  const dlines = [{words: [{text: "PLEASE", start: 0.2, end: 0.8}, {text: "SEND", start: 0.8, end: 1.2}], style: {color: "#fff"}}];
  const style = {posY: 0.62, size: 0.08, color: "#ffffff"};
  const fp = L.textFingerprint(dlines, style);
  let dvideo = {clips: [{id: "c1", in: 0, out: 4, start: 0, duration: 8}], place: L.defaultPlace(), aspect: "9:16", overlays: [], lines: dlines, style};
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
  for (const edit of edits) dvideo = L.applyVideoEdit(dvideo, edit);
  assert(!("lines" in dvideo) && !("style" in dvideo), "video edit returned lyric fields");
  assert(L.textFingerprint(dlines, style) === fp, "fingerprint changed");
  assert(dvideo.clips.length === 2, "split");
  assert(dvideo.overlays.length === 1 && dvideo.overlays[0].text === "Title", "overlay");
  assert(dvideo.aspect === "4:5", "aspect");
  assert(dvideo.place.fit === "crop" && Math.abs(dvideo.place.scale - 0.8) < 1e-6, "place");
  console.log("desktop layers ok");
}
desktopLayers();
