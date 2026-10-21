import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ctx = { console, globalThis: {} };
ctx.window = ctx;
ctx.globalThis = ctx;
runInContext(readFileSync(join(here, "../src/mobile/lyricsync.js"), "utf8"), createContext(ctx));
const LS = ctx.LyricSync;
if (!LS) throw new Error("LyricSync missing");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const words = LS.mergeTokens(LS.fixtureTokens());
const texts = words.map((w) => w.text);
assert(texts.includes("there's"), "contraction not merged: " + texts.join(" | "));
assert(texts.includes("beavers"), "subword not merged: " + texts.join(" | "));
assert(texts.includes("away,"), "punctuation not glued: " + texts.join(" | "));
assert(!texts.some((t) => t === "'s" || t === "avers" || t === ","), "leftover pieces: " + texts.join(" | "));
assert(LS.timingsLookReal(words), "fixture timings should look real");

const aligned = LS.alignLyrics(LS.PASTED_FIXTURE, words, 12);
assert(!aligned.error, aligned.error || "align failed");
const lines = aligned.lines.map((ln) => ln.words.map((w) => w.text).join(" "));
assert(lines.length === 4, "pasted line count " + lines.length + " " + JSON.stringify(lines));
assert(lines[0] === "Sing me, far away, there's", lines[0]);
assert(lines[1] === "voices, voicing me my name", lines[1]);
assert(lines[2] === "saying me. On the master man,", lines[2]);
assert(lines[3] === "beavers", lines[3]);
assert(lines[0].includes("there's") && !lines[0].includes(" '"), "detokenize display");
for (const ln of aligned.lines) {
  let prev = -1;
  for (const w of ln.words) {
    assert(w.end > w.start && w.start >= prev - 0.02, "line timing " + w.text);
    prev = w.start;
  }
}

const grouped = LS.groupLines(words);
const flat = grouped.flatMap((ln) => ln.words.map((w) => w.text));
assert(flat.includes("beavers") && !flat.includes("avers"), "group split a word");
assert(grouped.every((ln) => !ln.words.some((w) => w.text === "avers" || w.text === "'s")), "group leftover");
const sentence = grouped.map((ln) => ln.words.map((w) => w.text).join(" "));
assert(sentence.some((ln) => /me\.$/.test(ln)), "expected a break after the sentence: " + JSON.stringify(sentence));

const missed = LS.alignLyrics("completely unrelated zucchini orchestra\n", words, 12);
assert(missed.error && missed.lines.length === 0, "mismatch should surface an error");

const ln = { words: words.slice(0, 4).map((w) => Object.assign({}, w)) };
const kept = ln.words[0].start;
assert(LS.applyLineText(ln, "Sing me, far away,"), "edit");
assert(ln.words[0].start === kept && ln.words[3].text === "away,", "same-count edit kept timing");
assert(LS.applyLineText(ln, "Hello edited lyric"), "rewrite");
assert(ln.words.map((w) => w.text).join(" ") === "Hello edited lyric", "rewrite text");
let prev = -1;
for (const w of ln.words) {
  assert(w.end > w.start && w.start >= prev - 0.001, "rewritten timing");
  prev = w.start;
}

const typed = LS.linesFromText("line one here\nline two", 10);
assert(typed.length === 2 && typed[0].words[0].text === "line" && typed[1].words[0].start > typed[0].words.at(-1).start, "user lines");

console.log("lyricsync ok");
