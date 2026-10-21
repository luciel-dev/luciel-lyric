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
      const conf = num(w.confidence == null ? 1 : w.confidence);
      if (prev && (isPunct(piece) || startsApos(piece))) {
        prev.text += piece;
        prev.end = Math.max(num(prev.end), num(w.end));
        prev.confidence = Math.min(num(prev.confidence == null ? 1 : prev.confidence), conf);
      } else {
        out.push({ text: piece, start: num(w.start), end: num(w.end), confidence: conf });
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
      const word = {
        text: String(w.text || ""),
        start: num(w.start),
        end: num(w.end),
        confidence: num(w.confidence == null ? 1 : w.confidence),
      };
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

  // Typed lyrics are warped onto the heard words with DTW. Each typed word gets
  // its own start and end. Line breaks stay as typed, including a line of 9 words.
  function alignLyrics(pasted, words, clipLen) {
    const ref = [];
    String(pasted || "").split(/\n/).forEach((line, li) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      trimmed.split(/\s+/).forEach((t) => ref.push({ text: t, line: li }));
    });
    const hyp = gluePunct(words);
    const len = Math.max(0.2, num(clipLen) || (hyp.length ? hyp[hyp.length - 1].end : 0));
    if (!ref.length) return { lines: groupLines(hyp), matched: 0, ref: 0, mode: "heard" };
    if (!hyp.length) {
      return {
        lines: [],
        error: "No words were heard in this section.",
        matched: 0,
        ref: ref.length,
        mode: "dtw",
      };
    }
    const n = ref.length, m = hyp.length;
    const sims = ref.map((r) => hyp.map((w) => ratio(r.text, w.text)));
    const SKIP = 0.55;
    const INF = 1e12;
    const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    const B = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
    for (let i = 0; i <= n; i++) D[i][0] = 0;
    for (let j = 1; j <= m; j++) D[0][j] = INF;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const diag = D[i - 1][j - 1] + (1 - sims[i - 1][j - 1]);
        const up = D[i - 1][j] + SKIP;
        const left = D[i][j - 1] + SKIP;
        let best = diag, src = 0;
        if (up < best) { best = up; src = 1; }
        if (left < best) { best = left; src = 2; }
        D[i][j] = best;
        B[i][j] = src;
      }
    }
    let endI = 1;
    for (let i = 2; i <= n; i++) if (D[i][m] < D[endI][m]) endI = i;
    const pairs = new Map();
    let i = endI, j = m;
    while (i > 0 && j > 0 && D[i][j] < INF / 2) {
      const src = B[i][j];
      if (src === 0) {
        if (sims[i - 1][j - 1] >= 0.5) pairs.set(i - 1, j - 1);
        i--;
        j--;
      } else if (src === 1) i--;
      else j--;
    }
    if (!pairs.size) {
      return {
        lines: [],
        error: "Couldn't match these lyrics to the singing. Check the words, or clear the box to use what the phone heard.",
        matched: 0,
        ref: n,
        mode: "dtw",
      };
    }
    const idxs = [...pairs.keys()];
    let lo = Math.min(...idxs), hi = Math.max(...idxs);
    const lineLo = ref[lo].line, lineHi = ref[hi].line;
    while (lo > 0 && ref[lo - 1].line === lineLo) lo--;
    while (hi + 1 < ref.length && ref[hi + 1].line === lineHi) hi++;
    const out = [];
    for (let r = lo; r <= hi; r++) {
      if (pairs.has(r)) {
        const h = hyp[pairs.get(r)];
        const sim = sims[r][pairs.get(r)];
        const heard = num(h.confidence == null ? 1 : h.confidence);
        const confidence = round3(Math.min(1, sim * (heard > 0 ? heard : sim)));
        out.push({
          text: ref[r].text,
          start: h.start,
          end: h.end,
          line: ref[r].line,
          matched: true,
          confidence: confidence,
          low: sim < 0.72 || heard < 0.35,
        });
      } else {
        out.push({
          text: ref[r].text,
          start: null,
          end: null,
          line: ref[r].line,
          matched: false,
          confidence: 0,
          low: true,
        });
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
    let prevEnd = 0;
    for (const w of out) {
      let start = num(w.start);
      let end = num(w.end);
      if (start < prevEnd) start = prevEnd;
      if (end < start + 0.02) end = start + 0.02;
      w.start = round3(start);
      w.end = round3(end);
      prevEnd = w.end;
    }
    const lines = [];
    let cur = [], curLine = null;
    for (const w of out) {
      if (curLine !== null && w.line !== curLine) { lines.push({ words: cur }); cur = []; }
      curLine = w.line;
      cur.push({
        text: w.text,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
        low_confidence: !!w.low,
      });
    }
    if (cur.length) lines.push({ words: cur });
    lines.forEach((ln) => {
      const cs = ln.words.map((w) => num(w.confidence));
      const mean = cs.reduce((a, b) => a + b, 0) / (cs.length || 1);
      ln.confidence = round3(mean);
      ln.low_confidence = ln.words.some((w) => w.low_confidence) || mean < 0.45;
    });
    const lowLines = lines.filter((ln) => ln.low_confidence).length;
    let error = null;
    if (lowLines === lines.length) {
      error = "These lyrics don't match the singing closely enough. Low-confidence lines are marked — fix the words, or tap them in.";
    }
    return { lines, matched: pairs.size, ref: n, mode: "dtw", error: error };
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

  const ALIGN_VOCAB = {
    "'": 27, "</s>": 2, "<pad>": 0, "<s>": 1, "<unk>": 3, "|": 4,
    A: 7, B: 24, C: 19, D: 14, E: 5, F: 20, G: 21, H: 11, I: 10, J: 29,
    K: 26, L: 15, M: 17, N: 9, O: 8, P: 23, Q: 30, R: 13, S: 12, T: 6,
    U: 16, V: 25, W: 18, X: 28, Y: 22, Z: 31,
  };
  const ALIGN_BLANK = "<pad>";
  const ALIGN_BREAK = "|";
  const OK_SCORE_PER_WORD = -20;
  const WINDOW_MARGIN = 0.03;

  function lyricRows(text) {
    const rows = [];
    String(text || "").split(/\n/).forEach((line, li) => {
      line.split(/\s+/).forEach((token) => {
        if (token) rows.push({ text: token, line: li });
      });
    });
    return rows;
  }

  function alignChars(token) {
    const out = [];
    const upper = String(token || "").toUpperCase().replace(/[’‘]/g, "'");
    for (const ch of upper) {
      if (Object.prototype.hasOwnProperty.call(ALIGN_VOCAB, ch) && ch !== "<pad>" && ch !== "<s>" && ch !== "</s>" && ch !== "<unk>" && ch !== "|") {
        out.push(ALIGN_VOCAB[ch]);
      }
    }
    return out;
  }

  function softmaxLog(flat, frames, vocab) {
    const probs = new Array(frames);
    const logp = new Array(frames);
    for (let t = 0; t < frames; t++) {
      const base = t * vocab;
      let max = -Infinity;
      for (let v = 0; v < vocab; v++) {
        const x = flat[base + v];
        if (x > max) max = x;
      }
      let sum = 0;
      const row = new Float64Array(vocab);
      for (let v = 0; v < vocab; v++) {
        row[v] = Math.exp(flat[base + v] - max);
        sum += row[v];
      }
      const lp = new Float64Array(vocab);
      const denom = Math.max(sum, 1e-12);
      for (let v = 0; v < vocab; v++) {
        const p = row[v] / denom;
        row[v] = p;
        lp[v] = Math.log(Math.min(1, Math.max(p, 1e-10)));
      }
      probs[t] = row;
      logp[t] = lp;
    }
    return { probs, logp };
  }

  function viterbi(logp, targets, blank) {
    const T = logp.length;
    const L = targets.length;
    if (!T || !L) return null;
    const ext = new Int32Array(2 * L + 1);
    for (let i = 0; i < ext.length; i++) ext[i] = (i % 2 === 0) ? blank : targets[(i - 1) >> 1];
    const S = ext.length;
    const NEG = -1e30;
    const canSkip = new Uint8Array(S);
    for (let i = 2; i < S; i++) canSkip[i] = ext[i] !== blank && ext[i] !== ext[i - 2] ? 1 : 0;
    let dp = new Float64Array(S);
    dp.fill(NEG);
    dp[0] = logp[0][ext[0]];
    if (S > 1) dp[1] = logp[0][ext[1]];
    const ptr = new Array(T);
    for (let t = 0; t < T; t++) ptr[t] = new Uint8Array(S);
    for (let t = 1; t < T; t++) {
      const emit = logp[t];
      const ndp = new Float64Array(S);
      const srcs = ptr[t];
      for (let s = 0; s < S; s++) {
        let best = dp[s];
        let src = 0;
        if (s > 0 && dp[s - 1] > best) { best = dp[s - 1]; src = 1; }
        if (s > 1 && canSkip[s] && dp[s - 2] > best) { best = dp[s - 2]; src = 2; }
        ndp[s] = best + emit[ext[s]];
        srcs[s] = src;
      }
      dp = ndp;
    }
    const endTok = S >= 2 ? dp[S - 2] : NEG;
    let s = dp[S - 1] >= endTok ? S - 1 : S - 2;
    const score = dp[s];
    if (!(score > -1e20)) return null;
    const path = new Int32Array(T);
    for (let t = T - 1; t >= 0; t--) {
      path[t] = ext[s];
      if (t === 0) break;
      const step = ptr[t][s];
      if (step === 1) s -= 1;
      else if (step === 2) s -= 2;
      if (s < 0) s = 0;
    }
    return { path, score };
  }

  function alignSlice(logp, probs, rows, frameS) {
    const blank = ALIGN_VOCAB[ALIGN_BLANK];
    const pieces = [];
    rows.forEach((row, wi) => {
      const chars = alignChars(row.text);
      if (!chars.length) return;
      if (pieces.length) pieces.push([ALIGN_VOCAB[ALIGN_BREAK], -1]);
      chars.forEach((tok) => pieces.push([tok, wi]));
    });
    if (!pieces.length) return null;
    const targets = pieces.map((p) => p[0]);
    const vit = viterbi(logp, targets, blank);
    if (!vit) return null;
    const frames = rows.map(() => []);
    const mass = rows.map(() => 0);
    const count = rows.map(() => 0);
    let ti = 0;
    let t = 0;
    const path = vit.path;
    while (t < path.length && ti < pieces.length) {
      const tok = path[t];
      if (tok === blank) { t++; continue; }
      if (tok !== pieces[ti][0]) return null;
      const wi = pieces[ti][1];
      while (t < path.length && path[t] === tok) {
        if (wi >= 0) {
          frames[wi].push(t);
          mass[wi] += probs[t][tok];
          count[wi] += 1;
        }
        t++;
      }
      ti++;
    }
    if (ti !== pieces.length) return null;
    const words = rows.map((row, wi) => {
      const fr = frames[wi];
      if (!fr.length) {
        return { text: row.text, line: row.line, start: null, end: null, confidence: 0, low_confidence: true };
      }
      const conf = count[wi] ? mass[wi] / count[wi] : 0;
      return {
        text: row.text, line: row.line,
        start: fr[0] * frameS, end: (fr[fr.length - 1] + 1) * frameS,
        confidence: conf, low_confidence: false,
      };
    });
    return { words, score: vit.score };
  }

  function fillGaps(words, duration) {
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.start != null) continue;
      const prevEnd = i && words[i - 1].end != null ? words[i - 1].end : 0;
      let nxt = null;
      for (let j = i + 1; j < words.length; j++) {
        if (words[j].start != null) { nxt = words[j].start; break; }
      }
      const nxtStart = nxt != null ? nxt : Math.min(duration, prevEnd + 0.12);
      w.start = prevEnd;
      w.end = Math.max(prevEnd + 0.04, nxtStart);
      w.confidence = 0;
      w.low_confidence = true;
    }
    let prev = 0;
    words.forEach((w) => {
      let start = Math.max(num(w.start), prev);
      let end = Math.max(num(w.end), start + 0.02);
      if (duration) {
        end = Math.min(duration, end);
        start = Math.min(start, Math.max(0, end - 0.02));
      }
      w.start = round3(start);
      w.end = round3(Math.max(end, start + 0.02));
      prev = w.end;
    });
    return words;
  }

  function packAligned(groups, ok) {
    const means = groups.map((group) => {
      const cs = group.map((w) => num(w.confidence));
      return cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 0;
    });
    const overall = means.length ? means.reduce((a, b) => a + b, 0) / means.length : 0;
    return groups.map((group, i) => {
      const mean = means[i];
      const low = !ok || mean < 0.12 || (mean < overall - 0.12 && mean < overall * 0.55);
      return {
        words: group.map((w) => ({
          text: w.text,
          start: w.start,
          end: w.end,
          confidence: round3(num(w.confidence)),
          low_confidence: low,
        })),
        confidence: round3(mean),
        low_confidence: low,
      };
    });
  }

  function alignWindows(rows, duration) {
    if (!rows.length) return [];
    const bounds = [];
    let start = 0;
    for (let i = 1; i <= rows.length; i++) {
      if (i === rows.length || rows[i].line !== rows[start].line) {
        bounds.push([start, i]);
        start = i;
      }
    }
    const n = bounds.length;
    let spans = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j <= n; j++) {
        const a = bounds[i][0];
        const b = bounds[j - 1][1];
        const count = b - a;
        if (count < 1) continue;
        if ((i === 0 && j === n) || (duration * 0.45 <= count && count <= Math.max(8, duration * 4.5))) spans.push([a, b]);
      }
    }
    if (spans.length > 40) {
      const step = Math.max(1, Math.floor(spans.length / 36));
      const kept = [];
      for (let i = 0; i < spans.length; i += step) kept.push(spans[i]);
      const full = [0, rows.length];
      if (!kept.some((s) => s[0] === full[0] && s[1] === full[1])) kept.push(full);
      spans = kept;
    }
    const seen = new Set();
    const out = [];
    spans.forEach((span) => {
      const key = span[0] + ":" + span[1];
      if (seen.has(key)) return;
      seen.add(key);
      out.push(span);
    });
    return out;
  }

  function calibrate(scorePerWord) {
    return Math.max(0, Math.min(1, (scorePerWord - (-36)) / ((-10) - (-36))));
  }

  function alignFromLogits(flat, frames, duration, text) {
    const rows = lyricRows(text);
    const dur = num(duration);
    if (!rows.length) {
      return { ok: false, error: "Paste the lyrics first.", confidence: 0, lines: [], words: [], mode: "forced_alignment" };
    }
    if (!(dur >= 0.4) || !flat || frames < 2) {
      return { ok: false, error: "That clip is too short to align.", confidence: 0, lines: [], words: [], mode: "forced_alignment" };
    }
    const vocab = 32;
    const { probs, logp } = softmaxLog(flat, frames, vocab);
    const frameS = dur / Math.max(1, frames);
    const cands = [];
    alignWindows(rows, dur).forEach(([a, b]) => {
      const aligned = alignSlice(logp, probs, rows.slice(a, b), frameS);
      if (!aligned) return;
      const n = Math.max(1, b - a);
      cands.push({ key: aligned.score / n, n: n, words: aligned.words, score: aligned.score });
    });
    if (!cands.length) {
      return {
        ok: false,
        error: "Couldn't align these lyrics to the vocals.",
        confidence: 0, lines: [], words: [], mode: "forced_alignment",
      };
    }
    const bestKey = Math.max(...cands.map((c) => c.key));
    const close = cands.filter((c) => c.key >= bestKey - Math.abs(bestKey) * WINDOW_MARGIN);
    close.sort((a, b) => a.n - b.n);
    const picked = close[close.length - 1];
    const words = fillGaps(picked.words, dur);
    const per = picked.score / Math.max(1, words.length);
    const ok = per >= OK_SCORE_PER_WORD && words.every((w) => w.end > w.start);
    const groups = [];
    let cur = [], curLine = null;
    words.forEach((w) => {
      if (cur.length && w.line !== curLine) { groups.push(cur); cur = []; }
      curLine = w.line;
      cur.push(w);
    });
    if (cur.length) groups.push(cur);
    const lines = packAligned(groups, ok);
    const error = ok ? null : "These lyrics don't match the singing closely enough. Low-confidence lines are marked — fix the words, or tap them in.";
    const flatWords = [];
    lines.forEach((ln) => ln.words.forEach((w) => flatWords.push(w)));
    return {
      ok: ok,
      error: error,
      confidence: round3(calibrate(per)),
      score: picked.score,
      lines: lines,
      words: flatWords,
      ref_words: rows.length,
      ref_words_used: words.length,
      mode: "forced_alignment",
    };
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
    mergeTokens, gluePunct, timingsLookReal, groupLines, alignLyrics, alignFromLogits, linesFromText, applyLineText,
    fixtureTokens, PASTED_FIXTURE,
  };
})(typeof window !== "undefined" ? window : globalThis);
