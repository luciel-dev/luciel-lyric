/* Word merge, line breaks, and lyric alignment for the phone.
   Whisper tokens are merged here the same way as word_merge.h. */
(function (G) {
  function isPunct(s) {
    return !!s && !/[\p{L}\p{N}]/u.test(s);
  }
  function startsApos(s) {
    return /^['’‘]/.test(s || "");
  }
  function num(v) {
    const n = +v;
    return Number.isFinite(n) ? n : 0;
  }
  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  function mergeTokens(tokens) {
    const out = [];
    for (const tok of tokens || []) {
      const raw = String(tok.text ?? "");
      if (!raw) continue;
      const piece = raw.replace(/^[\s]+/, "");
      if (!piece || piece[0] === "[" || piece[0] === "<") continue;
      const boundary = !out.length || /^[\s]/.test(raw);
      const prev = out[out.length - 1];
      const start = num(tok.start !== undefined ? tok.start : tok.t0);
      const end = num(tok.end !== undefined ? tok.end : tok.t1);
      if (prev && !boundary) {
        prev.text += piece;
        prev.end = Math.max(prev.end, end);
        if (prev.start <= 0 && start > 0) prev.start = start;
        continue;
      }
      if (prev && (isPunct(piece) || startsApos(piece))) {
        prev.text += piece;
        prev.end = Math.max(prev.end, end);
        continue;
      }
      out.push({ text: piece, start: start, end: Math.max(end, start) });
    }
    return out;
  }

  function gluePunct(words) {
    const out = [];
    for (const w of words || []) {
      const piece = String(w.text ?? "").trim();
      if (!piece || piece[0] === "[" || piece[0] === "<") continue;
      const prev = out[out.length - 1];
      if (prev && (isPunct(piece) || startsApos(piece))) {
        prev.text += piece;
        prev.end = Math.max(num(prev.end), num(w.end));
      } else {
        out.push({ text: piece, start: num(w.start), end: num(w.end) });
      }
    }
    return out;
  }

  function timingsLookReal(words) {
    if (!words || !words.length) return false;
    let prev = -0.001;
    let maxEnd = 0;
    let moved = false;
    for (const w of words) {
      const s = num(w.start);
      const e = num(w.end);
      if (!(e > s)) return false;
      if (s < prev - 0.02) return false;
      if (s > 0.05) moved = true;
      prev = s;
      if (e > maxEnd) maxEnd = e;
    }
    return moved && maxEnd > 0.4;
  }

  function groupLines(words) {
    const lines = [];
    let cur = [];
    const charsOf = (arr) => arr.reduce((s, w) => s + w.text.length + 1, 0);
    for (const w of words || []) {
      const word = { text: String(w.text || ""), start: num(w.start), end: num(w.end) };
      if (!word.text) continue;
      if (cur.length) {
        const prev = cur[cur.length - 1];
        const gap = word.start - prev.end;
        const sentence = /[.!?…]["']?$/.test(prev.text);
        const chars = charsOf(cur);
        const comma = /[,;:]$/.test(prev.text) && (cur.length >= 4 || chars >= 24);
        const hard = chars >= 52;
        if (gap > 0.42 || sentence || comma || hard) {
          lines.push({ words: cur });
          cur = [];
        }
      }
      cur.push(word);
    }
    if (cur.length) lines.push({ words: cur });
    return lines;
  }

  function norm(w) {
    return (w || "").toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']+/g, "");
  }
  function ratio(a, b) {
    a = norm(a);
    b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const m = a.length, n = b.length, dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return 1 - dp[n] / Math.max(m, n);
  }

  function alignLyrics(pasted, words, clipLen) {
    const ref = [];
    String(pasted || "").split(/\n/).map((l) => l.trim()).filter(Boolean).forEach((line, li) => {
      line.split(/\s+/).forEach((t) => ref.push([t, li]));
    });
    const hyp = gluePunct(words);
    const len = Math.max(0.2, num(clipLen) || (hyp.length ? hyp[hyp.length - 1].end : 0));
    if (!ref.length) return { lines: groupLines(hyp), matched: 0, ref: 0 };
    if (!hyp.length) {
      return { lines: [], error: "No words were heard in this section.", matched: 0, ref: ref.length };
    }
    const n = ref.length, m = hyp.length, GAP = -0.6;
    const S = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    const B = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
    for (let j = 1; j <= m; j++) { S[0][j] = S[0][j - 1] + GAP; B[0][j] = 2; }
    const sims = ref.map((r) => hyp.map((w) => ratio(r[0], w.text)));
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
      const s = sims[i - 1][j - 1];
      const match = S[i - 1][j - 1] + (s >= 0.5 ? 2 * s : -1 + s);
      const up = S[i - 1][j] + GAP, left = S[i][j - 1] + GAP;
      const best = Math.max(match, up, left);
      S[i][j] = best;
      B[i][j] = best === match ? 0 : best === up ? 1 : 2;
    }
    let endI = 0;
    for (let i = 1; i <= n; i++) if (S[i][m] > S[endI][m]) endI = i;
    const pairs = new Map();
    let i = endI, j = m;
    while (i > 0 && j > 0) {
      const b = B[i][j];
      if (b === 0) {
        if (sims[i - 1][j - 1] >= 0.5) pairs.set(i - 1, j - 1);
        i--; j--;
      } else if (b === 1) i--;
      else j--;
    }
    if (!pairs.size) {
      return {
        lines: [],
        error: "Couldn't match these lyrics to the singing. Check the words, or clear the box to use what the phone heard.",
        matched: 0,
        ref: n,
      };
    }
    const idxs = [...pairs.keys()];
    let lo = Math.min(...idxs), hi = Math.max(...idxs);
    const lineLo = ref[lo][1], lineHi = ref[hi][1];
    while (lo > 0 && ref[lo - 1][1] === lineLo) lo--;
    while (hi + 1 < ref.length && ref[hi + 1][1] === lineHi) hi++;
    const out = [];
    for (let r = lo; r <= hi; r++) {
      if (pairs.has(r)) {
        const h = hyp[pairs.get(r)];
        out.push({ text: ref[r][0], start: h.start, end: h.end, line: ref[r][1], matched: true });
      } else {
        out.push({ text: ref[r][0], start: null, end: null, line: ref[r][1], matched: false });
      }
    }
    let k = 0;
    while (k < out.length) {
      if (out[k].matched) { k++; continue; }
      const s = k;
      while (k < out.length && !out[k].matched) k++;
      const t0 = s > 0 ? out[s - 1].end : Math.max(0, (out[k] ? out[k].start : len) - 0.4 * (k - s));
      const t1 = k < out.length ? out[k].start : Math.min(len, t0 + 0.4 * (k - s));
      const span0 = Math.min(t0, t1);
      const span1 = Math.max(t0, t1, span0 + 0.05 * (k - s));
      const weights = out.slice(s, k).map((w) => Math.max(1, w.text.length));
      const tot = weights.reduce((a, b) => a + b, 0);
      let acc = span0;
      weights.forEach((wgt, x) => {
        const d = (span1 - span0) * wgt / tot;
        out[s + x].start = round3(acc);
        out[s + x].end = round3(acc + d);
        acc += d;
      });
    }
    const lines = [];
    let cur = [], curLine = null;
    for (const w of out) {
      if (curLine !== null && w.line !== curLine) { lines.push({ words: cur }); cur = []; }
      curLine = w.line;
      cur.push({ text: w.text, start: num(w.start), end: num(w.end) });
    }
    if (cur.length) lines.push({ words: cur });
    return { lines, matched: pairs.size, ref: n };
  }

  function linesFromText(text, clipLen) {
    const raw = String(text || "").split(/\n/).map((l) => l.trim()).filter(Boolean);
    const len = Math.max(0.2, num(clipLen) || raw.length);
    if (!raw.length) return [];
    const weights = raw.map((l) => Math.max(1, l.length));
    const tot = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    return raw.map((line, i) => {
      const span = len * weights[i] / tot;
      const parts = line.split(/\s+/).filter(Boolean);
      const ws = parts.map((p) => Math.max(1, p.length));
      const wt = ws.reduce((a, b) => a + b, 0) || 1;
      let t = acc;
      const words = parts.map((p, k) => {
        const d = span * ws[k] / wt;
        const w = { text: p, start: round3(t), end: round3(t + d) };
        t += d;
        return w;
      });
      acc += span;
      return { words };
    });
  }

  function applyLineText(ln, text) {
    if (!ln || !ln.words || !ln.words.length) return false;
    const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return false;
    const old = ln.words;
    if (parts.length === old.length) {
      parts.forEach((p, i) => { old[i].text = p; });
      return true;
    }
    const t0 = num(old[0].start);
    const t1 = num(old[old.length - 1].end);
    const span = Math.max(t1 - t0, 0.05 * parts.length);
    const weights = parts.map((p) => Math.max(1, p.length));
    const tot = weights.reduce((a, b) => a + b, 0);
    let acc = t0;
    ln.words = parts.map((p, i) => {
      const d = span * weights[i] / tot;
      const w = { text: p, start: round3(acc), end: round3(acc + d) };
      acc += d;
      return w;
    });
    return true;
  }

  const RAW_FIXTURE = [
    [" Sing", 0.20, 0.55],
    [" me", 0.55, 0.80],
    [" ,", 0.80, 0.86],
    [" far", 0.90, 1.20],
    [" away", 1.20, 1.70],
    [" ,", 1.70, 1.76],
    [" there", 1.80, 2.05],
    ["'s", 2.05, 2.25],
    [" voices", 2.70, 3.20],
    [" ,", 3.20, 3.26],
    [" voicing", 3.30, 3.80],
    [" me", 3.80, 4.00],
    [" my", 4.00, 4.20],
    [" name", 4.20, 4.70],
    [" saying", 5.10, 5.60],
    [" me", 5.60, 5.90],
    [" .", 5.90, 6.00],
    [" On", 6.20, 6.40],
    [" the", 6.40, 6.55],
    [" master", 6.55, 7.00],
    [" man", 7.00, 7.40],
    [" ,", 7.40, 7.46],
    [" be", 7.50, 7.70],
    ["avers", 7.70, 8.20],
  ];
  const PASTED_FIXTURE = "Sing me, far away, there's\nvoices, voicing me my name\nsaying me. On the master man,\nbeavers";

  function fixtureTokens() {
    return RAW_FIXTURE.map(([text, start, end]) => ({ text, start, end }));
  }

  G.LyricSync = {
    mergeTokens, gluePunct, timingsLookReal, groupLines, alignLyrics, linesFromText, applyLineText,
    fixtureTokens, PASTED_FIXTURE,
  };
})(typeof window !== "undefined" ? window : globalThis);
