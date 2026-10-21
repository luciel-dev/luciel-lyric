/* Luciel Lyric on Android. The lyric picture is the same engine as the desktop app. */
(function () {
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
      return this;
    };
  }
  const $ = (s) => document.querySelector(s);
  const QUALITY = {
    draft: { label: "Draft", w: 540, h: 960, fps: 24, bitrate: 2000000 },
    standard: { label: "Standard", w: 720, h: 1280, fps: 30, bitrate: 6000000 },
    high: { label: "High", w: 1080, h: 1920, fps: 30, bitrate: 12000000 },
    max: { label: "Max", w: 1080, h: 1920, fps: 30, bitrate: 16000000 },
  };
  const DEMO = [
    { words: [{ text: "neon", start: 0.4, end: 0.8 }, { text: "rain", start: 0.85, end: 1.3 }, { text: "on", start: 1.35, end: 1.55 }, { text: "glass", start: 1.6, end: 2.2 }] },
    { words: [{ text: "halo", start: 2.5, end: 3.0 }, { text: "in", start: 3.05, end: 3.25 }, { text: "the", start: 3.3, end: 3.5 }, { text: "static", start: 3.55, end: 4.3 }] },
    { words: [{ text: "we", start: 4.7, end: 4.95 }, { text: "keep", start: 5.0, end: 5.4 }, { text: "the", start: 5.45, end: 5.65 }, { text: "chorus", start: 5.7, end: 6.5 }] },
  ];
  const state = {
    screen: "track", duration: 0, start: 0, length: 20, peaks: [], lines: [],
    look: "noir", animId: "fadewords", animLive: false, fontId: "",
    palette: null, colorOv: null, title: "", artist: "", bg: "gradient", videoIn: 0,
    zoomId: "none", keys: [], quality: "standard", fx: [], playing: false, t: 0,
  };
  let P = null;
  let stage = null;
  let samples = null;
  let sampleMode = "clip";
  let mascotTimer = 0;
  const params = new URLSearchParams(location.search);
  const demo = params.get("demo");

  function norm(w) { return (w || "").toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9']+/g, ""); }
  function ratio(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const m = a.length, n = b.length, dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0]; dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return 1 - dp[n] / Math.max(m, n);
  }
  function groupLines(words) {
    const lines = []; let cur = [];
    for (const w of words) {
      if (cur.length) {
        const prev = cur[cur.length - 1];
        const chars = cur.reduce((s, x) => s + x.text.length + 1, 0);
        if (w.start - prev.end > 0.5 || cur.length >= 8 || chars > 38) { lines.push({ words: cur }); cur = []; }
      }
      cur.push(w);
    }
    if (cur.length) lines.push({ words: cur });
    return lines;
  }
  function alignLyrics(pasted, words, clipLen) {
    const ref = [];
    pasted.split(/\n/).map((l) => l.trim()).filter(Boolean).forEach((line, li) => {
      line.split(/\s+/).forEach((t) => ref.push([t, li]));
    });
    if (!ref.length || !words.length) return groupLines(words);
    const n = ref.length, m = words.length, GAP = -0.6;
    const S = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    const B = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
    for (let j = 1; j <= m; j++) { S[0][j] = S[0][j - 1] + GAP; B[0][j] = 2; }
    const sims = ref.map((r) => words.map((w) => ratio(r[0], w.text)));
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
      const s = sims[i - 1][j - 1];
      const match = S[i - 1][j - 1] + (s >= 0.5 ? 2 * s : -1 + s);
      const up = S[i - 1][j] + GAP, left = S[i][j - 1] + GAP;
      const best = Math.max(match, up, left);
      S[i][j] = best; B[i][j] = best === match ? 0 : best === up ? 1 : 2;
    }
    let endI = 0;
    for (let i = 1; i <= n; i++) if (S[i][m] > S[endI][m]) endI = i;
    const pairs = new Map();
    let i = endI, j = m;
    while (i > 0 && j > 0) {
      const b = B[i][j];
      if (b === 0) { if (sims[i - 1][j - 1] >= 0.5) pairs.set(i - 1, j - 1); i--; j--; }
      else if (b === 1) i--;
      else j--;
    }
    if (!pairs.size) return groupLines(words);
    const idxs = [...pairs.keys()];
    const lo = Math.min(...idxs), hi = Math.max(...idxs);
    const out = [];
    for (let r = lo; r <= hi; r++) {
      if (pairs.has(r)) {
        const h = words[pairs.get(r)];
        out.push({ text: ref[r][0], start: h.start, end: h.end, line: ref[r][1], matched: true });
      } else out.push({ text: ref[r][0], start: null, end: null, line: ref[r][1], matched: false });
    }
    let k = 0;
    while (k < out.length) {
      if (out[k].matched) { k++; continue; }
      const s = k;
      while (k < out.length && !out[k].matched) k++;
      const t0 = s > 0 ? out[s - 1].end : Math.max(0, (out[k] ? out[k].start : clipLen) - 0.4 * (k - s));
      const t1 = k < out.length ? out[k].start : Math.min(clipLen, t0 + 0.4 * (k - s));
      const weights = out.slice(s, k).map((w) => Math.max(1, w.text.length));
      const tot = weights.reduce((a, b) => a + b, 0);
      let acc = t0;
      weights.forEach((wgt, x) => {
        const d = (t1 - t0) * wgt / tot;
        out[s + x].start = acc; out[s + x].end = acc + d; acc += d;
      });
    }
    const lines = [];
    let cur = [], curLine = null;
    for (const w of out) {
      if (curLine !== null && w.line !== curLine) { lines.push({ words: cur }); cur = []; }
      curLine = w.line;
      cur.push({ text: w.text, start: w.start, end: w.end });
    }
    if (cur.length) lines.push({ words: cur });
    return lines;
  }

  function show(id) {
    state.screen = id;
    document.querySelectorAll(".screen").forEach((el) => {
      const on = el.dataset.screen === id;
      el.classList.toggle("on", on);
      el.style.display = on ? "block" : "none";
    });
    document.querySelectorAll("#dock button").forEach((b) => b.setAttribute("aria-current", b.dataset.screen === id ? "true" : "false"));
    const sc = document.scrollingElement || document.documentElement;
    sc.scrollTop = 0;
    sc.scrollLeft = 0;
    const main = document.querySelector("main");
    if (main) { main.scrollTop = 0; main.scrollLeft = 0; }
    if (id === "look" || id === "time" || id === "render") draw(state.t || 1.2);
    if (id === "time") paintTimeline();
  }
  function mascot(name) {
    const img = $("#mascot");
    const file = name && name !== "idle" ? "mascot/emote-" + name + ".webp" : "mascot/idle.png";
    img.src = file;
    clearTimeout(mascotTimer);
    if (name && name !== "idle") mascotTimer = setTimeout(() => { img.src = "mascot/idle.png"; }, 2600);
  }
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function theme(name) {
    document.documentElement.dataset.theme = name;
    try { localStorage.setItem("lc-theme", name); } catch (e) {}
    document.querySelectorAll("#themes button").forEach((b) => b.setAttribute("aria-checked", b.dataset.theme === name ? "true" : "false"));
    paintWave();
    paintTimeline();
  }
  function settle() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  function overflowsX(el) {
    return el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 2;
  }
  function fitAll() {
    const sel = [
      ".brand", ".tag", ".themes button", ".dock button",
      ".screen.on h1", ".screen.on h2", ".screen.on .sum",
      ".screen.on .lcd", ".screen.on .hint", ".screen.on .lead",
      ".screen.on button", ".screen.on small", ".screen.on .fx span",
      ".screen.on .colors label"
    ].join(", ");
    document.querySelectorAll(sel).forEach((el) => {
      if (el.clientWidth < 2) return;
      el.style.letterSpacing = "";
      el.style.setProperty("--fit", "1");
      const floor = el.matches(".dock button, .themes button, .brand, .tag") ? 0.4 : 0.55;
      let fit = 1;
      let guard = 0;
      while (guard++ < 16 && fit > floor && overflowsX(el)) {
        if (!el.style.letterSpacing) el.style.letterSpacing = "0px";
        fit = Math.round((fit - 0.04) * 100) / 100;
        el.style.setProperty("--fit", String(fit));
      }
    });
  }
  function canvasBusy(cv) {
    if (!cv || cv.width < 2 || cv.height < 2) return false;
    const rect = cv.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 16) return false;
    let min = 1e9, max = 0;
    try {
      const ctx = cv.getContext("2d");
      const spots = [[2, 2], [cv.width * 0.5, cv.height * 0.35], [cv.width * 0.5, cv.height * 0.7]];
      spots.forEach((spot) => {
        const x = Math.max(0, Math.min(cv.width - 2, Math.floor(spot[0])));
        const y = Math.max(0, Math.min(cv.height - 2, Math.floor(spot[1])));
        const w = Math.min(12, cv.width - x);
        const h = Math.min(12, cv.height - y);
        const data = ctx.getImageData(x, y, w, h).data;
        for (let i = 0; i < data.length; i += 16) {
          const l = data[i] + data[i + 1] + data[i + 2];
          if (l < min) min = l;
          if (l > max) max = l;
        }
      });
    } catch (e) { return false; }
    return max - min > 18;
  }
  function inView(el, minH, full) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch (e) {}
    const r = el.getBoundingClientRect();
    const dock = document.querySelector(".dock").getBoundingClientRect();
    const vw = window.innerWidth;
    if (r.left < -1 || r.right > vw + 1) return false;
    if (full === false) {
      const visibleH = Math.min(r.bottom, dock.top) - Math.max(r.top, 0);
      return visibleH >= minH && r.width >= 8;
    }
    return r.width >= 8 && r.height >= minH && r.top >= -1 && r.bottom <= dock.top + 1;
  }
  function describe(el) {
    if (!el || !el.tagName) return "?";
    const id = el.id ? "#" + el.id : "";
    let cls = "";
    if (typeof el.className === "string" && el.className.trim()) cls = "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
    return el.tagName.toLowerCase() + id + cls;
  }
  function pageWide() {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    const roots = [document.querySelector(".top"), document.querySelector(".dock"), document.querySelector(".screen.on")];
    const seen = new Set();
    roots.forEach((root) => {
      if (!root) return;
      [root, ...root.querySelectorAll("*")].forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        if (el.closest(".hscroll") && !el.classList.contains("hscroll")) return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) return;
        if (r.right > vw + 1.5 || r.left < -1.5) bad.push(describe(el));
      });
    });
    const sc = document.scrollingElement;
    if (sc && sc.scrollWidth > vw + 2) bad.push("page");
    return bad;
  }
  function textWide() {
    const sel = ".brand, .tag, .themes button, .dock button, .screen.on button, .screen.on h1, .screen.on h2, .screen.on .sum, .screen.on .lcd, .screen.on small, .screen.on .hint, .screen.on .lead, .screen.on .fx span, .screen.on .colors label";
    const bad = [];
    document.querySelectorAll(sel).forEach((el) => {
      if (el.clientWidth < 2) return;
      const wide = el.scrollWidth > el.clientWidth + 2;
      const single = el.matches("button, .brand, .tag, .lcd, .sum, h1, h2");
      const tall = single && el.scrollHeight > el.clientHeight + 4;
      if (wide || tall) bad.push(describe(el));
    });
    return bad;
  }
  function clearsDock() {
    const screen = document.querySelector(".screen.on");
    if (!screen) return false;
    const kids = [...screen.children].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 8 && el.offsetParent !== null;
    });
    const last = kids[kids.length - 1];
    if (!last) return false;
    const sc = document.scrollingElement || document.documentElement;
    sc.scrollTop = sc.scrollHeight;
    document.documentElement.scrollTop = sc.scrollHeight;
    document.body.scrollTop = document.body.scrollHeight;
    const dock = document.querySelector(".dock").getBoundingClientRect();
    const r = last.getBoundingClientRect();
    const ok = r.height > 8 && r.bottom <= dock.top + 2 && r.left >= -1 && r.right <= window.innerWidth + 1;
    sc.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    return ok;
  }
  function contentFlags(screen) {
    const expect = { wave: 0, start: 0, play: 0, lyrics: 0, syncbtn: 0, stage: 0, looks: 0, palettes: 0, anims: 0, timeline: 0, zooms: 0, quality: 0, fx: 0, renderbtn: 0, title: 0 };
    const flags = [];
    if (!inView(document.querySelector(".screen.on h1"), 12)) flags.push("title");
    else expect.title = 1;
    if (screen === "track") {
      expect.wave = canvasBusy($("#wave")) ? 1 : 0;
      expect.start = inView($("#start"), 12) ? 1 : 0;
      expect.play = inView($("#playClip"), 28) ? 1 : 0;
      if (!expect.wave) flags.push("wave");
      if (!expect.start) flags.push("start");
      if (!expect.play) flags.push("play");
    } else if (screen === "sync") {
      expect.lyrics = inView($("#lyrics"), 32) ? 1 : 0;
      expect.syncbtn = inView($("#syncBtn"), 28) ? 1 : 0;
      if (!expect.lyrics) flags.push("lyrics");
      if (!expect.syncbtn) flags.push("syncbtn");
    } else if (screen === "look") {
      const stage = $("#stage");
      const cards = [...document.querySelectorAll("#looks button")];
      const drawn = cards.length === 13 && cards.every((b) => {
        const cv = b.querySelector("canvas");
        return cv && cv.getBoundingClientRect().height >= 16 && cv.getBoundingClientRect().width >= 16;
      });
      const grid = $("#looks");
      if (grid && cards.length) {
        grid.scrollTop = 0;
        const firstOk = canvasBusy(cards[0].querySelector("canvas"));
        grid.scrollTop = grid.scrollHeight;
        const lastCv = cards[12] && cards[12].querySelector("canvas");
        const gr = grid.getBoundingClientRect();
        const lr = lastCv ? lastCv.getBoundingClientRect() : null;
        const lastSeen = lr && lr.bottom > gr.top + 4 && lr.top < gr.bottom - 4;
        expect.stage = canvasBusy(stage) && inView(stage, 32) ? 1 : 0;
        expect.looks = drawn && firstOk && lastSeen && inView(grid, 32) ? 13 : 0;
      }
      const pals = document.querySelectorAll("#palettes button");
      const anims = document.querySelectorAll("#anims button");
      expect.palettes = pals.length === 12 && inView($("#palettes"), 20) ? 12 : pals.length;
      expect.anims = anims.length === 15 && inView($("#anims"), 20) ? 15 : anims.length;
      if (!expect.stage) flags.push("stage");
      if (expect.looks !== 13) flags.push("looks");
      if (expect.palettes !== 12) flags.push("palettes");
      if (expect.anims !== 15) flags.push("anims");
    } else if (screen === "time") {
      expect.timeline = canvasBusy($("#tl")) && inView($("#tl"), 16) ? 1 : 0;
      const zooms = document.querySelectorAll("#zooms button");
      expect.zooms = zooms.length === 5 && inView($("#zooms"), 16) ? 5 : zooms.length;
      if (!expect.timeline) flags.push("timeline");
      if (expect.zooms !== 5) flags.push("zooms");
    } else if (screen === "render") {
      const q = document.querySelectorAll("#quality button");
      const fx = document.querySelectorAll("#fx label");
      expect.quality = q.length;
      expect.fx = fx.length;
      expect.renderbtn = inView($("#renderBtn"), 28) ? 1 : 0;
      if (q.length !== 4 || !inView($("#quality"), 20, false)) flags.push("quality");
      if (fx.length < 1 || !inView($("#fx"), 24, false)) flags.push("fx");
      if (!expect.renderbtn) flags.push("renderbtn");
    }
    return { expect, flags };
  }
  function measure(screen) {
    const sc = document.scrollingElement || document.documentElement;
    sc.scrollTop = 0;
    sc.scrollLeft = 0;
    fitAll();
    const { expect, flags } = contentFlags(screen);
    const wide = pageWide();
    const box = textWide();
    const clear = clearsDock() ? 1 : 0;
    sc.scrollTop = 0;
    sc.scrollLeft = 0;
    if (!clear) flags.push("clear");
    wide.slice(0, 4).forEach((w) => flags.push("wide:" + w));
    box.slice(0, 4).forEach((w) => flags.push("box:" + w));
    const labels = [...document.querySelectorAll("#themes button")].map((b) => b.textContent.trim()).join("/");
    const dockWords = [...document.querySelectorAll("#dock button")].map((b) => b.textContent.trim()).join("/");
    const themesOk = labels === "Aero/Y2K/Winamp" ? 1 : 0;
    const dockOk = dockWords === "Track/Sync/Look/Time/Render" ? 1 : 0;
    if (!themesOk) flags.push("themes");
    if (!dockOk) flags.push("dock");
    const pad = parseFloat(getComputedStyle(document.querySelector(".app")).paddingTop) || 0;
    const inset = pad >= 40 ? 1 : 0;
    if (!inset) flags.push("inset");
    const themeName = document.documentElement.dataset.theme || "aero";
    const zoom = parseInt(document.documentElement.dataset.textZoom || "100", 10) || 100;
    const parts = [
      screen, themeName, flags.length ? "fail" : "ok",
      "zoom=" + zoom,
      "title=" + expect.title,
      "wave=" + expect.wave,
      "start=" + expect.start,
      "play=" + expect.play,
      "lyrics=" + expect.lyrics,
      "syncbtn=" + expect.syncbtn,
      "stage=" + expect.stage,
      "looks=" + expect.looks,
      "palettes=" + expect.palettes,
      "anims=" + expect.anims,
      "timeline=" + expect.timeline,
      "zooms=" + expect.zooms,
      "quality=" + expect.quality,
      "fx=" + expect.fx,
      "renderbtn=" + expect.renderbtn,
      "clear=" + clear,
      "fit=" + (box.length ? 0 : 1),
      "overflow=" + wide.length,
      "box=" + box.length,
      "inset=" + inset,
      "themes=" + themesOk,
      "dock=" + dockOk
    ];
    if (flags.length) parts.push("missing=" + flags.slice(0, 8).join(","));
    return parts.join(" ");
  }
  function resolved() {
    const lk = P.looks[state.look] || P.looks.noir;
    const anim = P.anims.find((a) => a.id === state.animId) || P.anims[0];
    const style = Object.assign({}, P.styleDefaults, lk.style, anim.style || {}, (state.palette && state.palette.colors) || {}, state.colorOv || {});
    if (state.fontId) style.fontId = state.fontId;
    const animOv = Object.assign({}, P.animDefaults, anim.anim || {});
    if (!state.animLive) { animOv.idle = "none"; animOv.cursor = false; }
    return { lk, style, anim: animOv };
  }
  function audioSlice() {
    if (!samples) return null;
    if (sampleMode !== "song") return samples;
    const sr = 8000;
    const a = Math.max(0, Math.floor(state.start * sr));
    const b = Math.min(samples.length, a + Math.floor(state.length * sr));
    return samples.subarray(a, Math.max(a + 1, b));
  }
  function hexColor(c) {
    return /^#[0-9a-fA-F]{6}$/.test(c || "") ? c : "#ffffff";
  }
  function syncColors() {
    const s = resolved().style;
    $("#cLyric").value = hexColor(s.color);
    $("#cTitle").value = hexColor(s.titleColor);
    $("#cArtist").value = hexColor(s.artistColor);
  }
  function scene() {
    const r = resolved();
    const groups = window.LL.prepare(state.lines, r.style, r.anim, state.length);
    const keys = state.zoomId === "custom" ? state.keys : (window.LL.zoomPreset(state.zoomId, state.length, groups) || []);
    return {
      style: r.style, anim: r.anim, lines: state.lines, title: state.title, artist: state.artist,
      clipLen: state.length, visualizer: true, bgMode: state.bg, grad: r.lk.grad, wave: r.lk.wave,
      zoom: { keys, target: "bg" }, fx: state.fx.filter((f) => f.on), fps: 30,
      video: state.videoEl || null, clip: state.bg === "video" ? { in: state.videoIn, start: 0 } : null,
      darken: 0.35, blur: 0,
    };
  }
  function draw(t) {
    if (!stage) return;
    const box = $("#stage");
    const w = 360, h = 640;
    stage.setSize(w, h, 1080);
    const slice = audioSlice();
    if (slice) stage.setAudio(slice, 8000);
    stage.setScene(scene());
    if (state.videoEl && state.bg === "video") {
      try { state.videoEl.currentTime = state.videoIn + Math.max(0, t); } catch (e) {}
    }
    stage.drawFrame(Math.max(0, Math.min(state.length - 0.05, t)));
  }
  function paintLooks() {
    const row = $("#looks");
    row.innerHTML = "";
    Object.entries(P.looks).forEach(([id, lk]) => {
      const b = document.createElement("button");
      b.dataset.id = id;
      b.className = id === state.look ? "on" : "";
      const cv = document.createElement("canvas");
      cv.width = 180; cv.height = 320;
      const thumb = new LLStage.Stage(cv);
      const anim = Object.assign({}, P.animDefaults, { idle: "none", cursor: false, enter: "none", exit: "none" });
      const fake = new Float32Array(8000);
      for (let i = 0; i < fake.length; i++) fake[i] = 0.45 * Math.sin(i / 14) * (0.6 + 0.4 * Math.sin(i / 90));
      thumb.setAudio(fake, 8000);
      thumb.setSize(180, 320, 1080);
      thumb.setScene({
        style: Object.assign({}, P.styleDefaults, lk.style), anim, lines: DEMO, title: "Title", artist: "Artist",
        clipLen: 8, visualizer: true, bgMode: "gradient", grad: lk.grad, wave: lk.wave,
        zoom: { keys: [], target: "bg" }, fx: [], fps: 30,
      });
      thumb.drawFrame(1.35);
      const label = document.createElement("small");
      label.textContent = lk.label;
      b.append(cv, label);
      b.onclick = () => {
        state.look = id;
        state.animId = lk.anim || state.animId;
        state.animLive = false;
        state.fontId = "";
        state.palette = null;
        state.colorOv = null;
        mascot("music");
        paintLooks(); paintAnims(); paintPalettes(); syncColors(); draw(1.35);
      };
      row.append(b);
    });
  }
  function paintAnims() {
    const row = $("#anims");
    row.innerHTML = "";
    P.anims.forEach((a) => {
      const b = document.createElement("button");
      b.textContent = a.label;
      b.className = a.id === state.animId ? "on" : "";
      b.onclick = () => {
        state.animId = a.id;
        state.animLive = true;
        mascot("happy");
        paintAnims();
        play();
      };
      row.append(b);
    });
  }
  function paintPalettes() {
    const row = $("#palettes");
    row.innerHTML = "";
    P.palettes.forEach((p) => {
      const b = document.createElement("button");
      b.textContent = p.label;
      b.className = state.palette && state.palette.id === p.id ? "on" : "";
      b.onclick = () => { state.palette = p; state.colorOv = null; paintPalettes(); syncColors(); draw(state.t || 1.2); };
      row.append(b);
    });
  }
  function paintZooms() {
    const row = $("#zooms");
    row.innerHTML = "";
    P.zoomPresets.forEach((z) => {
      const b = document.createElement("button");
      b.textContent = z.label;
      b.className = state.zoomId === z.id ? "on" : "";
      b.onclick = () => { state.zoomId = z.id; paintZooms(); draw(state.t || 1); };
      row.append(b);
    });
  }
  function paintFx() {
    const box = $("#fx");
    box.innerHTML = "";
    state.fx.forEach((f) => {
      const lab = document.createElement("label");
      const ck = document.createElement("input");
      ck.type = "checkbox"; ck.checked = !!f.on;
      ck.onchange = () => { f.on = ck.checked; };
      const name = document.createElement("span");
      name.textContent = f.label;
      const range = document.createElement("input");
      range.type = "range"; range.min = 0; range.max = 100; range.value = f.amount;
      range.oninput = () => { f.amount = +range.value; f.on = true; ck.checked = true; };
      lab.append(ck, name, range);
      box.append(lab);
    });
  }
  function paintQuality() {
    const row = $("#quality");
    row.innerHTML = "";
    Object.entries(QUALITY).forEach(([id, q]) => {
      const b = document.createElement("button");
      b.textContent = q.label;
      b.className = state.quality === id ? "on" : "";
      b.onclick = () => { state.quality = id; paintQuality(); };
      row.append(b);
    });
    const q = QUALITY[state.quality];
    $("#qualityHint").textContent = q.label + ": " + q.w + "×" + q.h + " · " + q.fps + " fps. Phone Max is 1080p30 (desktop Max is 60 fps).";
  }
  function paintWave() {
    const cv = $("#wave");
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.fillRect(0, 0, w, h);
    const dur = Math.max(state.duration, state.start + state.length, 1);
    const peaks = state.peaks.length ? state.peaks : new Array(400).fill(0.05);
    ctx.fillStyle = cssVar("--wave-off", "#8aa0ad");
    peaks.forEach((p, i) => {
      const x = i / peaks.length * w;
      const bh = Math.max(2, p * (h - 16));
      ctx.fillRect(x, (h - bh) / 2, Math.max(1, w / peaks.length - 1), bh);
    });
    const x0 = state.start / dur * w, x1 = (state.start + state.length) / dur * w;
    ctx.fillStyle = cssVar("--wave-on", "#1aa9d6");
    peaks.forEach((p, i) => {
      const x = i / peaks.length * w;
      if (x < x0 || x > x1) return;
      const bh = Math.max(2, p * (h - 16));
      ctx.fillRect(x, (h - bh) / 2, Math.max(1, w / peaks.length - 1), bh);
    });
    ctx.fillStyle = cssVar("--wave-sel", "rgba(32,180,220,.34)");
    ctx.fillRect(x0, 0, x1 - x0, h);
  }
  function paintLines() {
    const ol = $("#lineList");
    ol.innerHTML = "";
    state.lines.forEach((ln) => {
      const li = document.createElement("li");
      li.textContent = ln.words.map((w) => w.text).join(" ");
      ol.append(li);
    });
  }
  function paintKeys() {
    const ul = $("#keys");
    ul.innerHTML = "";
    state.keys.forEach((k, i) => {
      const li = document.createElement("li");
      li.textContent = k.t.toFixed(1) + "s · zoom " + k.z.toFixed(2);
      const rm = document.createElement("button");
      rm.className = "pill"; rm.textContent = "Remove";
      rm.onclick = () => { state.keys.splice(i, 1); state.zoomId = "custom"; paintKeys(); };
      li.append(rm);
      ul.append(li);
    });
    paintTimeline();
  }
  function paintTimeline() {
    const cv = $("#tl");
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.fillRect(0, 0, w, h);
    const y = 28, bh = 18;
    ctx.fillStyle = "rgba(255,255,255,.18)";
    ctx.beginPath(); ctx.roundRect(12, y, w - 24, bh, 4); ctx.fill();
    ctx.fillStyle = cssVar("--track", "#1592b8");
    ctx.beginPath(); ctx.roundRect(12, y, w - 24, bh, 4); ctx.fill();
    ctx.fillStyle = cssVar("--ink", "#f4fffd");
    ctx.font = "12px sans-serif";
    ctx.fillText("lyric section", 16, 18);
    state.keys.forEach((k) => {
      const x = 12 + (w - 24) * (Math.max(0, Math.min(state.length, k.t)) / state.length);
      ctx.fillStyle = "#f6e27a";
      ctx.beginPath();
      ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y + bh / 2); ctx.lineTo(x, y + bh + 6); ctx.lineTo(x - 6, y + bh / 2);
      ctx.closePath(); ctx.fill();
    });
  }
  function stopPlay() { state.playing = false; }
  function play() {
    stopPlay();
    state.playing = true;
    state.animLive = true;
    const audio = $("#audio");
    const t0 = performance.now();
    if (audio.src) { try { audio.currentTime = state.start; audio.play(); } catch (e) {} }
    const step = (now) => {
      if (!state.playing) return;
      state.t = Math.min(state.length, (now - t0) / 1000);
      draw(state.t);
      if (state.t < state.length - 0.02) requestAnimationFrame(step);
      else { state.playing = false; try { audio.pause(); } catch (e) {} mascot("happy"); }
    };
    requestAnimationFrame(step);
  }
  function applyWords(words) {
    const pasted = $("#lyrics").value;
    state.lines = pasted.trim() ? alignLyrics(pasted, words, state.length) : groupLines(words);
    paintLines();
    $("#syncStatus").textContent = state.lines.length + " lines ready.";
    mascot("happy");
    show("look");
    draw(1.2);
  }
  function fakePeaks(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(0.15 + 0.7 * Math.abs(Math.sin(i / 7) * Math.sin(i / 3)));
    return out;
  }
  function demoFill() {
    state.duration = 96;
    state.start = 12;
    state.length = 20;
    state.peaks = fakePeaks(400);
    state.title = "Glass Static";
    state.artist = "Luciel";
    state.lines = DEMO.map((ln) => ({ words: ln.words.map((w) => Object.assign({}, w)) }));
    $("#lyrics").value = state.lines.map((ln) => ln.words.map((w) => w.text).join(" ")).join("\n");
    $("#title").value = state.title;
    $("#artist").value = state.artist;
    $("#trackName").textContent = "sample · glass-static";
    $("#start").max = String(Math.max(0, state.duration - state.length));
    $("#start").value = String(state.start);
    $("#len").value = String(state.length);
    $("#startVal").textContent = state.start.toFixed(1) + "s";
    $("#lenVal").textContent = state.length + "s";
    sampleMode = "clip";
    const sr = 8000, n = sr * 8;
    samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = 0.4 * Math.sin(i / 18) * (0.5 + 0.5 * Math.sin(i / 400));
    paintWave();
    paintLines();
  }

  async function boot() {
    const res = await fetch("engine/presets.json");
    P = await res.json();
    if (window.LLFX) LLFX.setDefs(P.fx);
    state.fx = P.fx.map((f) => ({ id: f.id, label: f.label, amount: f.def || 40, on: false, option: (f.options || [null])[0] }));
    stage = new LLStage.Stage($("#stage"));
    try { await LLStage.loadFonts({}); } catch (e) {}
    if (demo) demoFill();
    paintLooks(); paintAnims(); paintPalettes(); paintZooms(); paintFx(); paintQuality(); paintTimeline();
    syncColors();
    try { await document.fonts.ready; } catch (e) {}
    window.__audits = [];
    async function publish(screen) {
      await settle();
      fitAll();
      const msg = measure(screen);
      window.__audits.push(msg);
      document.documentElement.dataset.audit = msg;
      if (window.Luciel && Luciel.ready) Luciel.ready(msg);
    }
    if (demo === "audit") {
      for (const th of ["aero", "y2k", "winamp"]) {
        theme(th);
        for (const sc of ["track", "sync", "look", "time", "render"]) {
          show(sc);
          if (sc === "look" || sc === "time" || sc === "render") draw(1.35);
          await publish(sc);
        }
      }
      return;
    }
    theme(document.documentElement.dataset.theme || "aero");
    const screen = ["track", "sync", "look", "time", "render"].includes(demo) ? demo : "track";
    show(screen);
    if (screen === "look" || screen === "time" || screen === "render") draw(1.35);
    await publish(screen);
    if (window.Luciel && Luciel.info) {
      try {
        const info = JSON.parse(Luciel.info());
        if (info.model) $("#modelText").textContent = "Speech model is on this phone. Sync works offline.";
      } catch (e) {}
    } else if (!demo) {
      $("#trackHint").textContent = "Open this page in the Luciel Lyric app to pick a song.";
    }
  }

  $("#dock").onclick = (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.screen); };
  $("#themes").onclick = (e) => { const b = e.target.closest("button"); if (b) { theme(b.dataset.theme); mascot("surprised"); } };
  function onColor(key, input) {
    input.oninput = () => {
      state.colorOv = Object.assign({}, state.colorOv || {}, { [key]: input.value });
      draw(state.t || 1.2);
    };
  }
  onColor("color", $("#cLyric"));
  onColor("titleColor", $("#cTitle"));
  onColor("artistColor", $("#cArtist"));
  $("#start").oninput = () => { state.start = +$("#start").value; $("#startVal").textContent = state.start.toFixed(1) + "s"; paintWave(); };
  $("#len").oninput = () => {
    state.length = +$("#len").value; $("#lenVal").textContent = state.length + "s";
    $("#start").max = String(Math.max(0, state.duration - state.length));
    paintWave();
  };
  $("#title").oninput = () => { state.title = $("#title").value; draw(state.t || 1.2); };
  $("#artist").oninput = () => { state.artist = $("#artist").value; draw(state.t || 1.2); };
  $("#playClip").onclick = () => { mascot("music"); play(); };
  $("#previewBtn").onclick = () => { mascot("music"); play(); };
  $("#pickAudio").onclick = () => { if (window.Luciel) Luciel.pickAudio(); else $("#trackHint").textContent = "Song picking runs in the Android app."; };
  $("#pickVideo").onclick = () => { if (window.Luciel) Luciel.pickVideo(); };
  $("#fontBtn").onclick = () => { if (window.Luciel) Luciel.pickFont(); };
  $("#getModel").onclick = () => { if (window.Luciel) { $("#modelText").textContent = "Downloading the speech model…"; Luciel.downloadModel(); } };
  $("#syncBtn").onclick = () => {
    if (!window.Luciel) { applyWords(DEMO.flatMap((l) => l.words)); return; }
    mascot("confused");
    $("#syncStatus").textContent = "Listening to the section…";
    Luciel.transcribe(state.start, state.length);
  };
  $("#bgModes").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.bg = b.dataset.bg;
    document.querySelectorAll("#bgModes button").forEach((x) => x.classList.toggle("on", x === b));
    draw(state.t || 1);
  };
  $("#addKey").onclick = () => {
    state.zoomId = "custom";
    state.keys.push({ t: +(state.t || 0).toFixed(2), z: 1.15, x: 0.5, y: 0.5, ease: "inOutSine" });
    paintKeys(); paintZooms();
  };
  $("#clipIn").oninput = () => { state.videoIn = +$("#clipIn").value; $("#inVal").textContent = state.videoIn.toFixed(1) + "s"; };
  $("#renderBtn").onclick = () => render();
  $("#shareBtn").onclick = () => { if (window.Luciel) Luciel.share(); };

  async function render() {
    if (!window.Luciel) { $("#renderStatus").textContent = "Rendering runs in the Android app."; return; }
    const q = QUALITY[state.quality];
    mascot("music");
    $("#renderStatus").textContent = "Drawing frames…";
    $("#shareBtn").hidden = true;
    const started = Luciel.beginRender(JSON.stringify({
      width: q.w, height: q.h, fps: q.fps, bitrate: q.bitrate, start: state.start, length: state.length,
    }));
    if (started && started !== "ok") { $("#renderStatus").textContent = started; mascot("crying"); return; }
    const canvas = document.createElement("canvas");
    const rs = new LLStage.Stage(canvas);
    rs.setSize(q.w, q.h, 1080);
    const slice = audioSlice();
    if (slice) rs.setAudio(slice, 8000);
    const frames = Math.round(state.length * q.fps);
    const rowBytes = q.w * 4;
    const rows = Math.max(8, Math.min(32, Math.floor(180000 / rowBytes)));
    for (let f = 0; f < frames; f++) {
      const t = f / q.fps;
      if (state.videoEl && state.bg === "video") {
        const vt = state.videoIn + t;
        if (Math.abs((state.videoEl.currentTime || 0) - vt) > 0.05) {
          await new Promise((ok) => { state.videoEl.addEventListener("seeked", ok, { once: true }); state.videoEl.currentTime = vt; });
        }
      }
      rs.setScene(scene());
      rs.drawFrame(t);
      const data = rs.cv.getContext("2d").getImageData(0, 0, q.w, q.h).data;
      for (let y = 0; y < q.h; y += rows) {
        const rh = Math.min(rows, q.h - y);
        const slice = data.subarray(y * rowBytes, (y + rh) * rowBytes);
        let bin = "";
        const step = 3 * 4096;
        for (let i = 0; i < slice.length; i += step) {
          const sub = slice.subarray(i, Math.min(slice.length, i + step));
          let s = "";
          for (let j = 0; j < sub.length; j++) s += String.fromCharCode(sub[j]);
          bin += btoa(s);
        }
        Luciel.frameStrip(y, rh, bin);
      }
      Luciel.commitFrame();
      if (f % q.fps === 0) $("#renderStatus").textContent = "Drawing " + (f / q.fps).toFixed(0) + " / " + state.length + "s";
      await new Promise((ok) => setTimeout(ok, 0));
    }
    Luciel.finishRender();
  }

  window.LucielApp = {
    back() {
      const order = ["track", "sync", "look", "time", "render"];
      const i = order.indexOf(state.screen);
      if (i > 0) { show(order[i - 1]); return true; }
      return false;
    },
    dispatch(text) {
      const msg = JSON.parse(text);
      if (msg.type === "track" && msg.phase === "ready") {
        state.duration = msg.duration;
        state.peaks = Array.from(msg.peaks);
        state.start = Math.min(state.start, Math.max(0, state.duration - state.length));
        $("#trackName").textContent = (msg.name || "track") + " · " + state.duration.toFixed(1) + "s";
        $("#start").max = String(Math.max(0, state.duration - state.length));
        $("#trackHint").textContent = "Drag the section. Sync listens only to those seconds.";
        if (msg.audio) $("#audio").src = "https://appassets.androidplatform.net/files/" + msg.audio;
        sampleMode = "song";
        fetch("https://appassets.androidplatform.net/files/preview.pcm").then((r) => r.arrayBuffer()).then((buf) => {
          samples = new Float32Array(buf);
        }).catch(() => {});
        paintWave();
        mascot("music");
      } else if (msg.type === "track" && msg.error) {
        $("#trackHint").textContent = msg.error; mascot("crying");
      } else if (msg.type === "track") {
        $("#trackHint").textContent = "Reading the song…";
      } else if (msg.type === "model") {
        if (msg.error) { $("#modelText").textContent = msg.error; mascot("crying"); }
        else if (msg.ready) { $("#modelText").textContent = "Speech model is on this phone. Sync works offline."; mascot("happy"); }
        else $("#modelText").textContent = "Downloading… " + Math.round((msg.progress || 0) * 100) + "%";
      } else if (msg.type === "sync" && msg.phase === "words") {
        const words = msg.words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
        applyWords(words);
      } else if (msg.type === "sync" && msg.error) {
        $("#syncStatus").textContent = msg.error; mascot("crying");
      } else if (msg.type === "sync") {
        $("#syncStatus").textContent = "Listening…";
      } else if (msg.type === "video" && msg.ok) {
        const v = document.createElement("video");
        v.src = "https://appassets.androidplatform.net/files/bg.mp4";
        v.muted = true; v.playsInline = true;
        v.onloadeddata = () => { state.videoEl = v; state.bg = "video"; $("#clipName").textContent = msg.name; draw(1); };
        $("#clipName").textContent = "Loading clip…";
      } else if (msg.type === "font" && msg.ok) {
        const face = new FontFace("lc-custom", "url(https://appassets.androidplatform.net/files/custom.ttf)");
        face.load().then(() => { document.fonts.add(face); state.fontId = "custom"; draw(state.t || 1.2); mascot("happy"); });
      } else if (msg.type === "render" && msg.path) {
        $("#renderStatus").textContent = "Saved on this phone (" + Math.round(msg.bytes / 1000000) + " MB).";
        $("#shareBtn").hidden = false;
        mascot("happy");
      } else if (msg.type === "render" && msg.error) {
        $("#renderStatus").textContent = msg.error; mascot("crying");
      }
    },
  };

  window.addEventListener("error", (e) => {
    if (window.Luciel && Luciel.ready) Luciel.ready("error:" + (e.message || "script"));
  });
  boot().catch((e) => {
    $("#tagline").textContent = e.message || "could not start";
    if (window.Luciel && Luciel.ready) Luciel.ready("error:" + (e.message || "boot"));
  });
})();
