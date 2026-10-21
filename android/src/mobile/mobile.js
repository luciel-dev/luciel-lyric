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
    look: "noir", animId: "fadewords", animLive: false, fontId: "", hyp: [],
    palette: null, colorOv: null, title: "", artist: "", bg: "gradient", videoIn: 0,
    videoName: "", videoEl: null, videoReady: false, clips: [], nextClipId: 1,
    selectedClip: 0, selectedLine: -1, pxPerSec: 46, thumbs: [],
    zoomId: "none", keys: [], quality: "standard", fx: [], playing: false, loopPreview: false, t: 0,
    checks: null,
  };
  let P = null;
  let stage = null;
  let samples = null;
  let sampleMode = "clip";
  let mascotTimer = 0;
  let leadWhy = "";
  const params = new URLSearchParams(location.search);
  const demo = params.get("demo");

  const LS = () => window.LyricSync;

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
    const host = document.getElementById("pin-" + id);
    const pin = $("#previewPin");
    if (host && pin) host.appendChild(pin);
    pinPreview();
    sizePreview();
    if (id === "look" || id === "time" || id === "render") draw(state.t > 0.05 ? state.t : 1.2);
    if (id === "time") { paintEditor(); paintTimeline(); }
    updatePreviewChrome();
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
    if (stage && (state.screen === "look" || state.screen === "time" || state.screen === "render")) {
      draw(state.t > 0.05 ? state.t : 1.2);
    }
  }
  function settle() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  function overflowsX(el) {
    return el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 2;
  }
  function fitAll() {
    const sel = [
      ".brand", ".tag", ".themes button",
      ".screen.on h1", ".screen.on h2", ".screen.on .sum",
      ".screen.on .lcd", ".screen.on .hint", ".screen.on .lead",
      ".screen.on button", ".screen.on small", ".screen.on .fx span",
      ".screen.on .colors label"
    ].join(", ");
    document.querySelectorAll(sel).forEach((el) => {
      if (el.closest("#dock") || el.clientWidth < 2) return;
      el.style.letterSpacing = "";
      el.style.setProperty("--fit", "1");
      const floor = el.matches(".themes button, .brand, .tag") ? 0.4 : 0.55;
      let fit = 1;
      let guard = 0;
      while (guard++ < 16 && fit > floor && overflowsX(el)) {
        if (!el.style.letterSpacing) el.style.letterSpacing = "0px";
        fit = Math.round((fit - 0.04) * 100) / 100;
        el.style.setProperty("--fit", String(fit));
      }
    });
    fitDock();
    fitLines();
  }
  function contentBox(el) {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      left: rect.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0),
      right: rect.right - (parseFloat(cs.borderRightWidth) || 0) - (parseFloat(cs.paddingRight) || 0),
      top: rect.top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0),
      bottom: rect.bottom - (parseFloat(cs.borderBottomWidth) || 0) - (parseFloat(cs.paddingBottom) || 0),
    };
  }
  function textBounds(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!rects.length) return null;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    rects.forEach((r) => {
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    });
    return { left, right, top, bottom, lines: rects.length };
  }
  function curveClips(btn, text) {
    const rect = btn.getBoundingClientRect();
    const cs = getComputedStyle(btn);
    const radii = [
      parseFloat(cs.borderTopLeftRadius) || 0,
      parseFloat(cs.borderTopRightRadius) || 0,
      parseFloat(cs.borderBottomRightRadius) || 0,
      parseFloat(cs.borderBottomLeftRadius) || 0,
    ];
    const centers = [
      [rect.left + radii[0], rect.top + radii[0]],
      [rect.right - radii[1], rect.top + radii[1]],
      [rect.right - radii[2], rect.bottom - radii[2]],
      [rect.left + radii[3], rect.bottom - radii[3]],
    ];
    const points = [
      [text.left, text.top],
      [text.right, text.top],
      [text.right, text.bottom],
      [text.left, text.bottom],
    ];
    for (let i = 0; i < 4; i++) {
      const radius = radii[i];
      if (radius < 1) continue;
      const dx = points[i][0] - centers[i][0];
      const dy = points[i][1] - centers[i][1];
      const outsideX = (i === 0 || i === 3) ? dx < -0.4 : dx > 0.4;
      const outsideY = i < 2 ? dy < -0.4 : dy > 0.4;
      if (outsideX && outsideY && Math.sqrt(dx * dx + dy * dy) > radius + 0.5) return true;
    }
    return false;
  }
  function zoomScale() {
    const tz = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tz")) || 1;
    const zoom = (parseInt(document.documentElement.dataset.textZoom || "100", 10) || 100) / 100;
    return zoom / tz;
  }
  function measuredGlyph(label) {
    const canvas = measuredGlyph.canvas || (measuredGlyph.canvas = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    ctx.font = getComputedStyle(label).font;
    const measured = ctx.measureText((label.textContent || "").trim());
    const scale = zoomScale();
    const advance = Math.max(0, measured.width || 0) * scale;
    const cap = Math.max(1.5, advance * 0.4);
    const pastLeft = Math.min(cap, Math.max(0, (measured.actualBoundingBoxLeft || 0) * scale));
    const pastRight = Math.min(cap, Math.max(0, ((measured.actualBoundingBoxRight || 0) - (measured.width || 0)) * scale));
    return { advance, pastLeft, pastRight, width: advance + pastLeft + pastRight };
  }
  function glyphBox(label) {
    const text = textBounds(label);
    if (!text) return null;
    const glyph = measuredGlyph(label);
    const rangeWidth = text.right - text.left;
    const labelRect = label.getBoundingClientRect();
    // WebView's range for a full-width label is the line box, not the glyphs.
    // A clipped overflow is also as wide as the label; the advance is wider then,
    // so the edge comparison below still fails.
    if (glyph.width > 1 && rangeWidth > glyph.width + 1 && rangeWidth > labelRect.width - 2) {
      const mid = (labelRect.left + labelRect.right) / 2;
      const half = glyph.width / 2;
      return { left: mid - half, right: mid + half, top: text.top, bottom: text.bottom };
    }
    return {
      left: text.left - glyph.pastLeft,
      right: text.right + glyph.pastRight,
      top: text.top,
      bottom: text.bottom,
    };
  }
  function labelOverflow(btn) {
    const label = btn.querySelector(".docklabel") || btn;
    if (btn.clientWidth < 2 || label.clientWidth < 2) return false;
    const box = contentBox(btn);
    const text = glyphBox(label);
    // Advance plus any ink past it (side bearings) must sit inside the padded
    // pill with a visible margin. scrollWidth still fails on its own.
    const slackX = 3;
    const slackY = 1;
    const outside = !text
      || text.left < box.left + slackX - 0.5
      || text.right > box.right - slackX + 0.5
      || text.top < box.top + slackY - 0.5
      || text.bottom > box.bottom - slackY + 0.5;
    const scrollBad = label.scrollWidth > label.clientWidth + 1;
    const curve = !!(text && curveClips(btn, text));
    const left = text ? (text.left - box.left).toFixed(1) : "na";
    const right = text ? (box.right - text.right).toFixed(1) : "na";
    btn.dataset.dockWhy = [
      "sw" + label.scrollWidth + "-" + label.clientWidth,
      "L" + left,
      "R" + right,
      scrollBad ? "scroll" : "",
      outside ? "edge" : "",
      curve ? "curve" : "",
      "fit" + (btn.style.getPropertyValue("--fit") || "1"),
    ].filter(Boolean).join("/");
    return scrollBad || outside || curve;
  }
  function applyDockFit(buttons, fit) {
    const tz = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tz")) || 1;
    buttons.forEach((b) => {
      const fs = parseFloat(getComputedStyle(b).getPropertyValue("--fs")) || 9;
      const px = (fs * tz * fit) + "px";
      b.style.letterSpacing = "0px";
      b.style.setProperty("--fit", String(fit));
      b.style.fontSize = px;
      const label = b.querySelector(".docklabel");
      if (label) {
        label.style.letterSpacing = "0px";
        label.style.fontSize = px;
      }
    });
  }
  function fitDock() {
    const buttons = [...document.querySelectorAll("#dock button")];
    applyDockFit(buttons, 1);
    let fit = 1;
    let guard = 0;
    while (guard++ < 24 && fit > 0.4 && buttons.some(labelOverflow)) {
      fit = Math.round((fit - 0.03) * 100) / 100;
      applyDockFit(buttons, fit);
    }
  }
  function lineEdits() {
    return [...document.querySelectorAll(".screen.on #lineList .lineedit")].filter((el) => el.clientWidth >= 8);
  }
  function lineRows(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 2 && r.height > 2);
    if (!rects.length) return 1;
    const tops = [];
    rects.forEach((r) => {
      if (!tops.some((top) => Math.abs(top - r.top) < 3)) tops.push(r.top);
    });
    return tops.length;
  }
  function fitLines() {
    const edits = lineEdits();
    if (!edits.length) return;
    edits.forEach((el) => el.style.setProperty("--fit", "1"));
    let fit = 1;
    let guard = 0;
    while (guard++ < 16 && fit > 0.62 && edits.some((el) => lineRows(el) > 2.05)) {
      fit = Math.round((fit - 0.04) * 100) / 100;
      edits.forEach((el) => el.style.setProperty("--fit", String(fit)));
    }
  }
  function dockFits() {
    const buttons = [...document.querySelectorAll("#dock button")];
    if (buttons.length !== 5 || buttons.some(labelOverflow)) return false;
    const sizes = buttons.map((b) => getComputedStyle(b.querySelector(".docklabel") || b).fontSize);
    return sizes.every((size) => size === sizes[0]);
  }
  function placeSyncLines() {
    const head = document.getElementById("linesHead");
    const sc = document.scrollingElement || document.documentElement;
    if (!head) return;
    const sys = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sys-top")) || 0;
    const y = Math.max(0, Math.round(head.getBoundingClientRect().top + sc.scrollTop - sys - 12));
    sc.scrollTop = y;
    document.documentElement.scrollTop = y;
    document.body.scrollTop = y;
  }
  function linesHeadOk() {
    const head = document.getElementById("linesHead");
    if (!head) return false;
    const sys = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sys-top")) || 0;
    const rect = head.getBoundingClientRect();
    const dock = document.querySelector(".dock").getBoundingClientRect();
    if (rect.height < 10 || rect.top < sys - 1 || rect.bottom > dock.top - 1) return false;
    if (rect.left < -1 || rect.right > window.innerWidth + 1) return false;
    const hit = document.elementFromPoint(Math.round(rect.left + Math.min(28, rect.width / 2)), Math.round(rect.top + rect.height / 2));
    if (!hit || hit.id === "safebar" || (hit !== head && !head.contains(hit))) return false;
    const edited = lineEdits().find((el) => /edited/i.test(el.textContent));
    if (!edited) return false;
    const editedRect = edited.getBoundingClientRect();
    const visible = Math.min(editedRect.bottom, dock.top) - Math.max(editedRect.top, sys);
    return visible >= 20 && editedRect.left >= -1 && editedRect.right <= window.innerWidth + 1;
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
    const dockLabel = el.querySelector && el.querySelector(".docklabel");
    if (dockLabel && dockLabel.textContent) return "dock-" + dockLabel.textContent.trim();
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
        if (el.closest(".tlscroll") && !el.classList.contains("tlscroll")) return;
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
    const sel = ".brand, .tag, .themes button, .screen.on button, .screen.on h1, .screen.on h2, .screen.on .sum, .screen.on .lcd, .screen.on small, .screen.on .hint, .screen.on .lead, .screen.on .fx span, .screen.on .colors label";
    const bad = [];
    document.querySelectorAll(sel).forEach((el) => {
      if (el.closest("#dock") || el.clientWidth < 2) return;
      const wide = el.scrollWidth > el.clientWidth + 2;
      const single = el.matches("button, .brand, .tag, .lcd, .sum, h1, h2");
      const tall = single && el.scrollHeight > el.clientHeight + 4;
      if (wide || tall) bad.push(describe(el));
    });
    document.querySelectorAll("#dock button").forEach((el) => {
      if (labelOverflow(el)) bad.push(describe(el) + (el.dataset.dockWhy ? "[" + el.dataset.dockWhy + "]" : ""));
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
      const canvases = cards.map((b) => b.querySelector("canvas")).filter(Boolean);
      const grid = $("#looks");
      let firstOk = false;
      let lastOk = false;
      let gridOk = false;
      if (grid && canvases.length === 13) {
        grid.scrollTop = 0;
        const first = canvases[0];
        const fr = first.getBoundingClientRect();
        firstOk = canvasBusy(first) && fr.height >= 16 && fr.width >= 16;
        try { cards[12].scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
        const lr = canvases[12].getBoundingClientRect();
        const gr = grid.getBoundingClientRect();
        lastOk = lr.height >= 16 && lr.width >= 16 && lr.bottom > gr.top + 2 && lr.top < gr.bottom - 2;
        gridOk = inView(grid, 24, false);
      }
      const bitmaps = canvases.length === 13 && canvases.every((cv) => cv.width >= 80 && cv.height >= 80);
      expect.stage = canvasBusy(stage) && inView(stage, 24) ? 1 : 0;
      expect.looks = bitmaps && firstOk && lastOk && gridOk ? 13 : 0;
      const pals = document.querySelectorAll("#palettes button");
      const anims = document.querySelectorAll("#anims button");
      expect.palettes = pals.length === 12 && inView($("#palettes"), 20) ? 12 : pals.length;
      expect.anims = anims.length === 15 && inView($("#anims"), 20) ? 15 : anims.length;
      if (!expect.stage) flags.push("stage");
      if (expect.looks !== 13) flags.push("looks" + [bitmaps ? 1 : 0, firstOk ? 1 : 0, lastOk ? 1 : 0, gridOk ? 1 : 0, canvases.length].join(""));
      if (expect.palettes !== 12) flags.push("palettes");
      if (expect.anims !== 15) flags.push("anims");
    } else if (screen === "time") {
      expect.timeline = canvasBusy($("#tl")) && inView($("#tlview"), 16, false) ? 1 : 0;
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
  function leadFits() {
    const lead = document.querySelector("#screen-sync .lead");
    const bar = document.getElementById("safebar");
    if (!lead || !bar) return false;
    const sc = document.scrollingElement || document.documentElement;
    const saved = sc.scrollTop;
    sc.scrollTop = 0;
    const sys = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sys-top")) || 0;
    const r = lead.getBoundingClientRect();
    const wide = lead.scrollWidth > lead.clientWidth + 2;
    const xBad = r.left < 4 || r.right > window.innerWidth - 4;
    const yBad = r.top < sys - 1 || r.height <= 8;
    const textBad = lead.textContent.indexOf("Paste the lyrics") === -1;
    const br = bar.getBoundingClientRect();
    const barOk = br.top <= 1 && br.height + 0.5 >= sys && br.left <= 1 && br.right >= window.innerWidth - 1;
    sc.scrollTop = 360;
    const y = Math.max(4, Math.round(Math.min(sys, br.height) / 2));
    const hit = document.elementFromPoint(Math.round(window.innerWidth / 2), y);
    sc.scrollTop = saved;
    const why = [];
    if (wide) why.push("wide");
    if (xBad) why.push("x" + Math.round(r.left) + "-" + Math.round(r.right));
    if (yBad) why.push("y" + Math.round(r.top));
    if (textBad) why.push("text");
    if (!barOk) why.push("bar" + Math.round(br.height));
    if (hit !== bar) why.push("hit" + (hit ? describe(hit) : "none"));
    leadWhy = why.join("/");
    return why.length === 0;
  }
  function activeWordAt(t) {
    draw(t);
    let hit = "";
    for (const g of (stage && stage.groups) || []) {
      for (const w of g.words || []) {
        if (t >= w.s && t < w.e) hit = String(w.text || "");
      }
    }
    return hit;
  }
  function frameSig() {
    const cv = $("#stage");
    if (!cv || cv.width < 2) return 0;
    const data = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 48) n = (n + data[i] * 3 + data[i + 1] * 5 + data[i + 2]) >>> 0;
    return n;
  }
  function framePair(lines) {
    const aWord = lines[0] && lines[0].words[0];
    const bWord = lines[1] && lines[1].words[0];
    if (!aWord || !bWord) return ["active", "frames"];
    const tA = aWord.start + Math.min(0.04, Math.max(0.01, (aWord.end - aWord.start) / 2));
    const tB = bWord.start + Math.min(0.04, Math.max(0.01, (bWord.end - bWord.start) / 2));
    const wordA = activeWordAt(tA).toLowerCase();
    const sigA = frameSig();
    const wordB = activeWordAt(tB).toLowerCase();
    const sigB = frameSig();
    const problems = [];
    if (!wordA || !wordB || wordA === wordB) problems.push("active");
    if (sigA === sigB) problems.push("frames");
    return problems;
  }
  function syncedFromFixture() {
    const sync = LS();
    const words = sync.mergeTokens(sync.fixtureTokens());
    const res = sync.alignLyrics(sync.PASTED_FIXTURE, words, 12);
    return { sync, words, res };
  }
  function proveSync() {
    const sync = LS();
    const saved = {
      lines: state.lines, hyp: state.hyp, length: state.length, screen: state.screen,
      lyrics: $("#lyrics").value, status: $("#syncStatus").textContent,
    };
    const problems = [];
    try {
      const built = syncedFromFixture();
      if (!sync.timingsLookReal(built.words)) problems.push("times");
      const got = (built.res.lines || []).map((ln) => ln.words.map((w) => w.text).join(" "));
      if (built.res.error || got.length !== 4) problems.push("align");
      if (got[0] !== "Sing me, far away, there's") problems.push("line1");
      if (got[3] !== "beavers") problems.push("beavers");
      if (got.some((ln) => ln.indexOf(" '") >= 0 || ln.indexOf(" ,") >= 0)) problems.push("space");
      const grouped = sync.groupLines(built.words).flatMap((ln) => ln.words.map((w) => w.text));
      if (grouped.indexOf("avers") >= 0 || grouped.indexOf("'s") >= 0) problems.push("split");
      if (!sync.alignLyrics("unrelated zucchini orchestra", built.words, 12).error) problems.push("silent");
      if (got.length >= 2) {
        state.length = 12;
        state.hyp = built.words;
        state.lines = built.res.lines;
        const kept = state.lines[0].words[0].start;
        if (!sync.applyLineText(state.lines[0], "Sing me, far away, there's")) problems.push("edit");
        if (state.lines[0].words[0].start !== kept) problems.push("keeptime");
        if (!sync.applyLineText(state.lines[1], "voices edited live")) problems.push("rewrite");
        paintLines();
        const shown = document.querySelectorAll("#lineList .lineedit")[1];
        if (!shown || shown.getAttribute("contenteditable") !== "true" || !/edited/.test(shown.textContent)) problems.push("shown");
        show("look");
        show("sync");
        const again = document.querySelectorAll("#lineList .lineedit")[1];
        if (!again || !/edited/.test(again.textContent)) problems.push("persist");
        framePair(state.lines).forEach((p) => problems.push(p));
      }
    } catch (e) {
      problems.push("throw");
    } finally {
      state.lines = saved.lines;
      state.hyp = saved.hyp;
      state.length = saved.length;
      $("#lyrics").value = saved.lyrics;
      $("#syncStatus").textContent = saved.status;
      paintLines();
      show(saved.screen);
    }
    return problems;
  }
  function shotProblems() {
    const problems = [];
    try {
      const edits = [...document.querySelectorAll("#lineList .lineedit")];
      if (!edits.length || edits.some((el) => el.getAttribute("contenteditable") !== "true")) problems.push("shown");
      if (!edits.some((el) => /edited/i.test(el.textContent))) problems.push("edited");
      const flat = state.lines.flatMap((ln) => ln.words);
      if (!LS().timingsLookReal(flat)) problems.push("times");
      const text = state.lines.map((ln) => ln.words.map((w) => w.text).join(" ")).join("\n");
      if (text.indexOf("there's") < 0 || text.indexOf("beavers") < 0) problems.push("line1");
      if (/\s[,']/.test(text)) problems.push("space");
      show("look");
      show("sync");
      if (![...document.querySelectorAll("#lineList .lineedit")].some((el) => /edited/i.test(el.textContent))) problems.push("persist");
      framePair(state.lines).forEach((p) => problems.push(p));
    } catch (e) {
      problems.push("throw");
    }
    return problems;
  }
  function measure(screen) {
    const logical = screen === "syncshot" ? "sync" : screen === "videocheck" ? "look" : screen;
    const sc = document.scrollingElement || document.documentElement;
    sc.scrollTop = 0;
    sc.scrollLeft = 0;
    sizePreview();
    fitAll();
    const { expect, flags } = contentFlags(logical);
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
    let lead = 0, wordsOk = 0, editOk = 0, framesOk = 0, editedOk = 0;
    if (logical === "sync") {
      lead = leadFits() ? 1 : 0;
      if (!lead) flags.push("lead" + (leadWhy ? ":" + leadWhy : ""));
      const problems = screen === "syncshot" ? shotProblems() : proveSync();
      const wordBad = ["times", "align", "line1", "beavers", "space", "split", "silent", "throw"];
      const editBad = ["edit", "keeptime", "shown", "persist", "rewrite", "edited"];
      wordsOk = problems.some((p) => wordBad.indexOf(p) >= 0) ? 0 : 1;
      editOk = problems.some((p) => editBad.indexOf(p) >= 0) ? 0 : 1;
      framesOk = problems.some((p) => p === "active" || p === "frames") ? 0 : 1;
      editedOk = screen === "syncshot" ? (problems.indexOf("edited") >= 0 ? 0 : 1) : 1;
      if (!wordsOk) flags.push("words");
      if (!editOk) flags.push("edit");
      if (!framesOk) flags.push("frames");
      if (screen === "syncshot" && !editedOk) flags.push("edited");
      sc.scrollTop = 0;
      sc.scrollLeft = 0;
    }
    fitDock();
    fitLines();
    const dockFit = dockFits() ? 1 : 0;
    if (!dockFit) flags.push("dockfit");
    const edits = lineEdits();
    const maxRows = edits.reduce((max, el) => Math.max(max, lineRows(el)), 0);
    const lineOk = edits.every((el) => lineRows(el) <= 2.35) ? 1 : 0;
    if (!lineOk) flags.push("linerows");
    let headOk = 1;
    if (screen === "syncshot") {
      placeSyncLines();
      headOk = linesHeadOk() ? 1 : 0;
      if (!headOk) flags.push("lineshead");
    }
    let pinOk = 0;
    if (logical === "look" || logical === "time" || logical === "render") {
      pinOk = previewPinned() ? 1 : 0;
      if (!pinOk) flags.push("previewpin" + (state.pinWhy ? ":" + state.pinWhy : ""));
    }
    const themeName = document.documentElement.dataset.theme || "aero";
    const zoom = parseInt(document.documentElement.dataset.textZoom || "100", 10) || 100;
    const checks = state.checks || {};
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
      "dock=" + dockOk,
      "dockfit=" + dockFit,
      "linerows=" + lineOk,
      "lineshead=" + headOk,
      "rows=" + maxRows.toFixed(2),
      "lead=" + lead,
      "words=" + wordsOk,
      "edit=" + editOk,
      "frames=" + framesOk,
      "edited=" + editedOk,
      "previewpin=" + pinOk,
      "bgvideo=" + (checks.bgvideo || 0),
      "split=" + (checks.split || 0),
      "trim=" + (checks.trim || 0),
      "lyricdrag=" + (checks.lyricdrag || 0),
      "renderframes=" + (checks.renderframes || 0)
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
  function scene(t) {
    const r = resolved();
    const groups = window.LL.prepare(state.lines, r.style, r.anim, state.length);
    const keys = state.zoomId === "custom" ? state.keys : (window.LL.zoomPreset(state.zoomId, state.length, groups) || []);
    const at = Math.max(0, t || 0);
    const src = state.bg === "video" ? sourceAt(at) : null;
    return {
      style: r.style, anim: r.anim, lines: state.lines, title: state.title, artist: state.artist,
      clipLen: state.length, visualizer: true, bgMode: state.bg, grad: r.lk.grad, wave: r.lk.wave,
      zoom: { keys, target: "bg" }, fx: state.fx.filter((f) => f.on), fps: 30,
      video: src ? state.videoEl : null,
      clip: src,
      darken: state.bg === "video" ? 0.35 : 0.35, blur: 0,
    };
  }
  function draw(t) {
    if (!stage) return;
    const w = 360, h = 640;
    const at = Math.max(0, Math.min(state.length - 0.05, t || 0));
    stage.setSize(w, h, 1080);
    const slice = audioSlice();
    if (slice) stage.setAudio(slice, 8000);
    seekVideo(at);
    stage.setScene(scene(at));
    stage.drawFrame(at);
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
      ck.onchange = () => { f.on = ck.checked; draw(state.t || 1); };
      const name = document.createElement("span");
      name.textContent = f.label;
      const range = document.createElement("input");
      range.type = "range"; range.min = 0; range.max = 100; range.value = f.amount;
      range.oninput = () => { f.amount = +range.value; f.on = true; ck.checked = true; draw(state.t || 1); };
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
      b.onclick = () => { state.quality = id; paintQuality(); updatePreviewChrome(); draw(state.t || 1); };
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
  function writeLyrics(text) {
    const box = $("#lyrics");
    if (box && box.value !== text) box.value = text;
  }
  function paintLines() {
    const ol = $("#lineList");
    ol.innerHTML = "";
    state.lines.forEach((ln, i) => {
      const li = document.createElement("li");
      const edit = document.createElement("span");
      edit.className = "lineedit";
      edit.contentEditable = "true";
      edit.spellcheck = false;
      edit.setAttribute("role", "textbox");
      edit.setAttribute("aria-label", "Line " + (i + 1));
      edit.textContent = ln.words.map((w) => w.text).join(" ");
      edit.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); edit.blur(); }
      });
      edit.addEventListener("input", () => {
        if (LS().applyLineText(state.lines[i], edit.textContent)) {
          draw(state.t || 1.2);
          $("#syncStatus").textContent = "Line updated.";
        }
      });
      edit.addEventListener("blur", () => {
        if (!LS().applyLineText(state.lines[i], edit.textContent)) {
          edit.textContent = state.lines[i].words.map((w) => w.text).join(" ");
        }
        writeLyrics(state.lines.map((row) => row.words.map((w) => w.text).join(" ")).join("\n"));
        paintLines();
        draw(state.t || 1.2);
      });
      li.append(edit);
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
    const pps = state.pxPerSec || 46;
    const span = Math.max(1, state.length || 20);
    const cssW = Math.max(320, Math.round(span * pps));
    cv.width = cssW;
    cv.height = 64;
    cv.style.width = cssW + "px";
    cv.style.height = "52px";
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(0, 0, w, h);
    const peaks = state.peaks.length ? state.peaks : new Array(240).fill(0).map((_, i) => 0.2 + 0.6 * Math.abs(Math.sin(i / 9)));
    const dur = Math.max(state.duration, state.start + state.length, span);
    const a = state.start / dur;
    const b = (state.start + state.length) / dur;
    ctx.fillStyle = cssVar("--wave-off", "#8aa0ad");
    peaks.forEach((p, i) => {
      const x = i / peaks.length * w;
      const bh = Math.max(2, p * (h - 18));
      ctx.fillRect(x, (h - bh) / 2, Math.max(1, w / peaks.length - 1), bh);
    });
    ctx.fillStyle = cssVar("--wave-on", "#1aa9d6");
    peaks.forEach((p, i) => {
      const frac = i / peaks.length;
      if (frac < a || frac > b) return;
      const x = (frac - a) / Math.max(0.001, b - a) * w;
      const bh = Math.max(2, p * (h - 18));
      ctx.fillRect(x, (h - bh) / 2, Math.max(1, w / peaks.length), bh);
    });
    ctx.fillStyle = cssVar("--wave-sel", "rgba(32,180,220,.28)");
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = cssVar("--ink", "#f4fffd");
    ctx.font = "12px sans-serif";
    ctx.fillText("Lyric section", 8, 14);
  }
  function stopPlay() {
    state.playing = false;
    try { $("#audio").pause(); } catch (e) {}
    updatePreviewChrome();
  }
  function play(loop) {
    stopPlay();
    state.playing = true;
    state.loopPreview = !!loop;
    state.animLive = true;
    const audio = $("#audio");
    let origin = state.t || 0;
    let stamp = performance.now();
    if (audio && audio.src) { try { audio.currentTime = state.start + origin; audio.play(); } catch (e) {} }
    const step = (now) => {
      if (!state.playing) return;
      let t = origin + (now - stamp) / 1000;
      if (t >= state.length) {
        if (state.loopPreview) {
          origin = 0;
          stamp = now;
          t = 0;
          if (audio && audio.src) { try { audio.currentTime = state.start; } catch (e) {} }
        } else {
          state.t = state.length;
          state.playing = false;
          try { audio.pause(); } catch (e) {}
          draw(Math.max(0, state.length - 0.05));
          updatePreviewChrome();
          mascot("happy");
          return;
        }
      }
      state.t = t;
      draw(state.t);
      followPlayhead();
      updatePreviewChrome();
      requestAnimationFrame(step);
    };
    updatePreviewChrome();
    requestAnimationFrame(step);
  }
  function applyWords(words) {
    const sync = LS();
    const cleaned = sync.gluePunct(words);
    if (!cleaned.length) {
      $("#syncStatus").textContent = "Nothing was heard in this section.";
      mascot("crying");
      return;
    }
    if (!sync.timingsLookReal(cleaned)) {
      $("#syncStatus").textContent = "Heard the words, but they came back without timings. Try the section again.";
      mascot("crying");
      return;
    }
    state.hyp = cleaned;
    const pasted = $("#lyrics").value;
    const clip = state.length || cleaned[cleaned.length - 1].end;
    if (pasted.trim()) {
      const res = sync.alignLyrics(pasted, cleaned, clip);
      if (res.error) {
        state.lines = sync.linesFromText(pasted, clip);
        paintLines();
        $("#syncStatus").textContent = res.error;
        mascot("crying");
        draw(Math.min(1.2, Math.max(0.2, state.length - 0.05)));
        return;
      }
      state.lines = res.lines;
    } else {
      state.lines = sync.groupLines(cleaned);
    }
    if (!state.lines.length) {
      $("#syncStatus").textContent = "No lyric lines came out of that section.";
      mascot("crying");
      return;
    }
    paintLines();
    $("#syncStatus").textContent = state.lines.length + " lines ready.";
    mascot("happy");
    show("look");
    draw(Math.min(1.2, Math.max(0.2, state.length - 0.05)));
  }
  function installSyncShot() {
    const built = syncedFromFixture();
    state.length = 12;
    state.hyp = built.words;
    state.lines = built.res.lines;
    LS().applyLineText(state.lines[1], "voices, voicing me my name, edited");
    $("#lyrics").value = state.lines.map((ln) => ln.words.map((w) => w.text).join(" ")).join("\n");
    $("#syncStatus").textContent = state.lines.length + " lines ready.";
    paintLines();
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
    state.hyp = state.lines.flatMap((ln) => ln.words.map((w) => Object.assign({}, w)));
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

  function frameUnderPin(el) {
    if (!el) return;
    const sc = document.scrollingElement || document.documentElement;
    const pin = $("#previewPin");
    const host = pin && pin.parentElement;
    if (!pin || !host) return;
    sc.scrollTop = Math.max(sc.scrollHeight, document.documentElement.scrollHeight, document.body.scrollHeight);
    pinPreview();
    if (!pin.classList.contains("stuck")) return;
    const sys = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sys-top")) || 0;
    const pinBottom = pin.getBoundingClientRect().bottom;
    const delta = el.getBoundingClientRect().top - (pinBottom + 8);
    const hostTop = host.getBoundingClientRect().top;
    const maxUp = (sys - 1) - hostTop;
    let shift = delta;
    if (shift < 0) shift = Math.max(shift, -Math.max(0, maxUp));
    sc.scrollTop += shift;
    pinPreview();
  }
  function pinPreview() {
    const pin = $("#previewPin");
    const host = pin && pin.parentElement;
    if (!pin || !host || !host.classList.contains("pinhost")) return;
    const sys = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sys-top")) || 0;
    const top = host.getBoundingClientRect().top;
    pin.classList.toggle("stuck", top < sys - 1);
    sizePreview();
  }
  function sizePreview() {
    const pin = $("#previewPin");
    const canvas = $("#stage");
    if (!pin || !canvas || pin.clientHeight < 48 || pin.clientWidth < 48) return;
    const bar = pin.querySelector(".previewbar");
    const cs = getComputedStyle(pin);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const availH = Math.max(48, pin.clientHeight - padY - (bar ? bar.offsetHeight : 0));
    const availW = Math.max(48, pin.clientWidth - padX);
    let h = availH;
    let w = Math.round(h * 9 / 16);
    if (w > availW) {
      w = availW;
      h = Math.round(w * 16 / 9);
    }
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  }
  function previewPinned() {
    const pin = $("#previewPin");
    const stageEl = $("#stage");
    if (!pin || !stageEl) return false;
    const sc = document.scrollingElement || document.documentElement;
    const saved = sc.scrollTop;
    const max = Math.max(sc.scrollHeight, document.documentElement.scrollHeight, document.body.scrollHeight);
    sc.scrollTop = max;
    document.documentElement.scrollTop = max;
    document.body.scrollTop = max;
    pinPreview();
    const sys = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sys-top")) || 0;
    const dock = document.querySelector(".dock").getBoundingClientRect();
    const r = pin.getBoundingClientRect();
    const sr = stageEl.getBoundingClientRect();
    const why = [];
    if (r.height < 48) why.push("h" + Math.round(r.height));
    if (r.top < sys - 2) why.push("top" + Math.round(r.top));
    if (r.bottom > dock.top + 2) why.push("bot" + Math.round(r.bottom) + "/" + Math.round(dock.top));
    if (r.left < -1 || r.right > window.innerWidth + 1) why.push("x" + Math.round(r.left) + "-" + Math.round(r.right));
    const stageIn = sr.height >= 24 && sr.top >= r.top - 1 && sr.bottom <= r.bottom + 1 && sr.left >= r.left - 1 && sr.right <= r.right + 1;
    if (!stageIn) why.push("stage" + Math.round(sr.height));
    state.pinWhy = why.join("/");
    sc.scrollTop = saved;
    document.documentElement.scrollTop = saved;
    document.body.scrollTop = saved;
    pinPreview();
    return why.length === 0;
  }
  window.addEventListener("scroll", () => { pinPreview(); }, { passive: true });
  window.addEventListener("resize", () => { sizePreview(); });

  function videoDuration() {
    const v = state.videoEl;
    const d = v && Number.isFinite(v.duration) ? v.duration : 0;
    return d > 0.05 ? d : 0;
  }
  function freshClip(t0, t1, srcIn, speed) {
    const a = Math.max(0, +t0 || 0);
    return {
      id: state.nextClipId++,
      t0: a,
      t1: Math.max(a + 0.25, +t1 || 0),
      srcIn: Math.max(0, +srcIn || 0),
      speed: speed > 0 ? +speed : 1,
    };
  }
  function sourceAt(t) {
    if (!state.videoEl || state.bg !== "video") return null;
    const clips = state.clips || [];
    let hit = null;
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      if (c && t >= c.t0 - 1e-3 && t < c.t1 - 1e-4) { hit = c; break; }
    }
    if (!hit) return null;
    const speed = hit.speed > 0 ? hit.speed : 1;
    const dur = videoDuration();
    let at = (hit.srcIn || 0) + Math.max(0, t - hit.t0) * speed;
    if (dur > 0.05) {
      const origin = Math.max(0, Math.min(dur - 0.02, hit.srcIn || 0));
      const span = Math.max(0.05, dur - origin);
      const rel = at - origin;
      at = origin + ((rel % span) + span) % span;
    }
    return { in: at, start: t };
  }
  function seekTo(video, t) {
    return new Promise((resolve) => {
      if (!video) { resolve(); return; }
      const target = Math.max(0, t || 0);
      if (Math.abs((video.currentTime || 0) - target) < 0.04 && video.readyState >= 2) { resolve(); return; }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        video.removeEventListener("seeked", finish);
        resolve();
      };
      video.addEventListener("seeked", finish);
      try { video.currentTime = target; } catch (e) { finish(); return; }
      setTimeout(finish, 800);
    });
  }
  let seekGen = 0;
  function seekVideo(t) {
    const src = state.bg === "video" ? sourceAt(t) : null;
    const v = state.videoEl;
    if (!v || !src || !stage) return;
    const want = src.in || 0;
    if (Math.abs((v.currentTime || 0) - want) <= 0.045 && v.readyState >= 2) return;
    const gen = ++seekGen;
    const finish = () => {
      if (gen !== seekGen) return;
      v.removeEventListener("seeked", finish);
      if (!stage) return;
      const at = Math.max(0, Math.min((state.length || 20) - 0.05, state.t || 0));
      stage.setScene(scene(at));
      stage.drawFrame(at);
    };
    v.addEventListener("seeked", finish);
    try { v.currentTime = want; } catch (e) { finish(); }
  }
  function saveEditor() {
    state.videoIn = state.clips[0] ? state.clips[0].srcIn : 0;
    try {
      localStorage.setItem("lc-editor", JSON.stringify({
        bg: state.bg,
        clips: state.clips,
        videoIn: state.videoIn,
        videoName: state.videoName,
        keys: state.keys,
        zoomId: state.zoomId,
      }));
    } catch (e) {}
  }
  function loadEditor() {
    try {
      const raw = localStorage.getItem("lc-editor");
      if (!raw) return;
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object") return;
      if (o.bg === "gradient" || o.bg === "video" || o.bg === "black" || o.bg === "green") state.bg = o.bg;
      if (Array.isArray(o.clips)) {
        state.clips = o.clips.filter((c) => c && typeof c === "object").map((c) => freshClip(c.t0, c.t1, c.srcIn, c.speed));
      }
      if (typeof o.videoName === "string") state.videoName = o.videoName;
      if (typeof o.videoIn === "number") state.videoIn = o.videoIn;
      if (Array.isArray(o.keys)) state.keys = o.keys.filter((k) => k && typeof k.t === "number");
      if (typeof o.zoomId === "string") state.zoomId = o.zoomId;
    } catch (e) {}
  }
  function syncBgPills() {
    document.querySelectorAll("#bgModes button").forEach((b) => b.classList.toggle("on", b.dataset.bg === state.bg));
  }
  function updatePreviewChrome() {
    const len = state.length || 20;
    const t = Math.max(0, Math.min(len, state.t || 0));
    const time = $("#previewTime");
    if (time) time.textContent = t.toFixed(1) + " / " + len.toFixed(1) + "s";
    const label = state.playing ? "Pause" : "Play";
    const toggle = $("#previewToggle");
    if (toggle) toggle.textContent = label;
    const previewBtn = $("#previewBtn");
    if (previewBtn) previewBtn.textContent = label;
    const meta = $("#previewMeta");
    if (meta) {
      if (state.screen === "render") {
        const q = QUALITY[state.quality] || QUALITY.standard;
        meta.textContent = q.w + "×" + q.h;
      } else if (state.videoName) meta.textContent = state.videoName;
      else meta.textContent = "9:16";
    }
    const labelEl = $("#clipLabel");
    if (labelEl) labelEl.textContent = state.videoName || "No video yet";
    const rm = $("#removeVideo");
    if (rm) rm.hidden = !state.videoName;
    const tn = $("#timeClipName");
    if (tn) tn.textContent = state.videoName || "No background video yet";
    const speedBtn = $("#tlSpeed");
    if (speedBtn) {
      const c = state.clips[state.selectedClip];
      const sp = c && c.speed && c.speed !== 1 ? (c.speed === 2 ? "2×" : "0.5×") : "Speed";
      speedBtn.textContent = sp;
    }
    syncBgPills();
  }
  function togglePreview() {
    if (state.playing) stopPlay();
    else play(true);
  }
  function followPlayhead() {
    const sc = $("#tlscroll");
    if (!sc || state.screen !== "time") return;
    state.lockScroll = true;
    sc.scrollLeft = (state.t || 0) * (state.pxPerSec || 46);
    requestAnimationFrame(() => { state.lockScroll = false; });
  }
  function requestVideo() {
    if (window.Luciel && Luciel.pickVideo) Luciel.pickVideo();
    else {
      const status = $("#clipStatus");
      if (status) status.textContent = "Upload runs in the Luciel Lyric app.";
    }
  }
  function clearVideoLocal() {
    state.videoEl = null;
    state.videoName = "";
    state.videoReady = false;
    state.clips = [];
    state.thumbs = [];
    state.bg = "gradient";
    state.videoIn = 0;
    saveEditor();
    syncBgPills();
    paintEditor();
    updatePreviewChrome();
    draw(state.t || 1);
  }
  function removeClip() {
    if (window.Luciel && Luciel.removeVideo) Luciel.removeVideo();
    else clearVideoLocal();
  }
  function attachVideo(name, reset) {
    state.videoName = name || "video";
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.loop = true;
    v.preload = "auto";
    const pending = params.get("videoPending") === "1";
    v.onloadeddata = async () => {
      state.videoEl = v;
      state.bg = "video";
      if (reset || pending || !state.clips.length) {
        state.clips = [freshClip(0, state.length || 20, 0, 1)];
        state.videoIn = 0;
        state.selectedClip = 0;
      }
      try { await grabThumbs(); } catch (e) {}
      state.videoReady = true;
      saveEditor();
      syncBgPills();
      if (state.screen === "time") paintEditor();
      updatePreviewChrome();
      seekVideo(state.t || 0.45);
      draw(state.t > 0.05 ? state.t : 0.45);
      const status = $("#clipStatus");
      if (status) status.textContent = "";
    };
    v.onerror = () => {
      state.videoReady = false;
      const status = $("#clipStatus");
      if (status) status.textContent = "Couldn't play that video.";
    };
    v.src = "https://appassets.androidplatform.net/files/bg.mp4?t=" + Date.now();
  }
  function waitForVideo() {
    if (params.get("videoPending") !== "1") return Promise.resolve();
    const deadline = performance.now() + 20000;
    return new Promise((resolve) => {
      const step = () => {
        if (state.videoReady && state.videoEl && state.videoEl.videoWidth) { resolve(); return; }
        const status = $("#clipStatus");
        const failed = status && /could not|couldn't|try a shorter|didn't include/i.test(status.textContent || "");
        if (failed || performance.now() > deadline) { resolve(); return; }
        setTimeout(step, 100);
      };
      step();
    });
  }
  async function grabThumbs() {
    const v = state.videoEl;
    if (!v || !v.videoWidth) { state.thumbs = []; return; }
    const n = 6;
    const dur = videoDuration() || 2;
    const thumbs = [];
    for (let i = 0; i < n; i++) {
      await seekTo(v, Math.min(dur - 0.05, (i + 0.5) / n * dur));
      const c = document.createElement("canvas");
      c.width = 48;
      c.height = 64;
      c.getContext("2d").drawImage(v, 0, 0, 48, 64);
      thumbs.push(c);
    }
    state.thumbs = thumbs;
  }
  function splitAt(t) {
    const i = state.clips.findIndex((c) => t > c.t0 + 0.12 && t < c.t1 - 0.12);
    if (i < 0) return false;
    const c = state.clips[i];
    const speed = c.speed > 0 ? c.speed : 1;
    const left = freshClip(c.t0, t, c.srcIn, speed);
    const right = freshClip(t, c.t1, (c.srcIn || 0) + (t - c.t0) * speed, speed);
    state.clips.splice(i, 1, left, right);
    state.selectedClip = i + 1;
    saveEditor();
    return true;
  }
  function deleteClip() {
    if (!state.clips.length) return;
    const i = state.selectedClip >= 0 && state.selectedClip < state.clips.length ? state.selectedClip : 0;
    state.clips.splice(i, 1);
    state.selectedClip = Math.max(0, Math.min(i, state.clips.length - 1));
    saveEditor();
    paintEditor();
    draw(state.t || 0);
  }
  function addClip() {
    if (!state.videoEl && !state.videoName) { requestVideo(); return; }
    const len = state.length || 20;
    const t0 = Math.max(0, Math.min(len - 0.25, state.t || 0));
    const t1 = Math.min(len, Math.max(t0 + 0.25, t0 + 3));
    state.clips.push(freshClip(t0, t1, 0, 1));
    state.selectedClip = state.clips.length - 1;
    saveEditor();
    paintEditor();
    draw(state.t || t0);
  }
  function cycleSpeed() {
    const c = state.clips[state.selectedClip];
    if (!c) return;
    c.speed = c.speed === 1 ? 2 : c.speed === 2 ? 0.5 : 1;
    saveEditor();
    updatePreviewChrome();
    draw(state.t || 0);
  }
  function nudgeLine(index, delta) {
    const ln = state.lines[index];
    if (!ln || !ln.words || !ln.words.length) return false;
    const end = ln.words[ln.words.length - 1];
    end.end = Math.max(end.start + 0.05, end.end + delta);
    paintLines();
    return true;
  }
  function commitLyricInput() {
    const i = state.selectedLine;
    const input = $("#lyricInput");
    if (i < 0 || !input || !state.lines[i]) return;
    if (!LS().applyLineText(state.lines[i], input.value)) return;
    paintLines();
    layoutEditor();
    draw(state.t || 1);
  }
  function zoomKeys() {
    if (state.zoomId === "custom") return state.keys || [];
    try {
      const r = resolved();
      const groups = window.LL.prepare(state.lines, r.style, r.anim, state.length);
      return window.LL.zoomPreset(state.zoomId, state.length, groups) || [];
    } catch (e) {
      return [];
    }
  }
  function addZoomAt(t) {
    state.zoomId = "custom";
    state.keys.push({ t: +(+t || 0).toFixed(2), z: 1.15, x: 0.5, y: 0.5, ease: "inOutSine" });
    saveEditor();
    paintKeys();
    paintZooms();
    layoutEditor();
    draw(state.t || t || 0);
  }
  function layoutEditor() {
    const inner = $("#tlinner");
    const scroll = $("#tlscroll");
    if (!inner || !scroll) return;
    const pps = state.pxPerSec || 46;
    const span = Math.max(1, state.length || 20);
    const view = scroll.clientWidth || scroll.offsetWidth || 280;
    const cssW = Math.max(160, Math.round(span * pps));
    const origin = view / 2;
    state.tlOrigin = origin;
    inner.style.width = (view + cssW) + "px";
    paintRuler(origin, span, pps);
    paintVideoTrack(origin, cssW, pps);
    paintLyricTrack(origin, pps);
    paintZoomTrack(origin, pps);
    const cv = $("#tl");
    if (cv) {
      cv.style.position = "absolute";
      cv.style.left = origin + "px";
      cv.style.bottom = "0";
      cv.style.top = "auto";
    }
    paintTimeline();
    syncLyricInput();
  }
  function paintEditor() {
    layoutEditor();
    updatePreviewChrome();
  }
  function syncLyricInput() {
    const input = $("#lyricInput");
    if (!input) return;
    const ln = state.selectedLine >= 0 ? state.lines[state.selectedLine] : null;
    if (!ln || !ln.words) { input.hidden = true; return; }
    input.hidden = false;
    const text = ln.words.map((w) => w.text).join(" ");
    if (document.activeElement !== input && input.value !== text) input.value = text;
  }
  function paintRuler(origin, span, pps) {
    const ruler = $("#ruler");
    if (!ruler) return;
    ruler.innerHTML = "";
    const step = pps >= 40 ? 1 : pps >= 24 ? 2 : 5;
    for (let s = 0; s <= span + 0.01; s += step) {
      const b = document.createElement("b");
      b.textContent = Math.round(s) + "s";
      b.style.left = (origin + s * pps) + "px";
      ruler.append(b);
    }
  }
  function paintFilm(canvas, clip) {
    const pps = state.pxPerSec || 46;
    const w = Math.max(48, Math.round((clip.t1 - clip.t0) * pps));
    canvas.width = w;
    canvas.height = 44;
    const ctx = canvas.getContext("2d");
    const thumbs = state.thumbs || [];
    if (!thumbs.length) {
      ctx.fillStyle = "#143044";
      ctx.fillRect(0, 0, w, 44);
      return;
    }
    const tw = 36;
    for (let x = 0; x < w; x += tw) {
      ctx.drawImage(thumbs[Math.floor(x / tw) % thumbs.length], x, 0, tw, 44);
    }
  }
  function watchDrag(el, onDown, onMove) {
    let drag = null;
    el.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      e.stopPropagation();
      drag = onDown(e);
      if (!drag) return;
      state.lockScroll = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      onMove(drag, (e.clientX - drag.x0) / (state.pxPerSec || 46));
      draw(state.t || 0);
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      state.lockScroll = false;
      saveEditor();
      paintEditor();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }
  function paintVideoTrack(origin, cssW, pps) {
    const track = $("#videoTrack");
    if (!track) return;
    track.innerHTML = "";
    if (!state.clips.length) {
      const empty = document.createElement("div");
      empty.className = "vclip";
      empty.style.left = origin + "px";
      empty.style.width = Math.max(120, Math.min(cssW, 220)) + "px";
      const name = document.createElement("span");
      name.className = "vname";
      name.textContent = "No clip";
      empty.append(name);
      track.append(empty);
      return;
    }
    state.clips.forEach((clip, i) => {
      const el = document.createElement("div");
      el.className = "vclip" + (i === state.selectedClip ? " on" : "");
      el.style.left = (origin + clip.t0 * pps) + "px";
      el.style.width = Math.max(44, (clip.t1 - clip.t0) * pps) + "px";
      const film = document.createElement("canvas");
      paintFilm(film, clip);
      const name = document.createElement("span");
      name.className = "vname";
      const speed = clip.speed && clip.speed !== 1 ? " · " + clip.speed + "×" : "";
      name.textContent = (state.videoName || "Clip") + " · " + (clip.srcIn || 0).toFixed(1) + "s" + speed;
      const left = document.createElement("button");
      left.type = "button";
      left.className = "trim left";
      left.setAttribute("aria-label", "Trim start");
      const right = document.createElement("button");
      right.type = "button";
      right.className = "trim right";
      right.setAttribute("aria-label", "Trim end");
      el.append(film, name, left, right);
      watchDrag(el, (e) => {
        state.selectedClip = i;
        const handle = e.target.closest && e.target.closest(".trim");
        return {
          x0: e.clientX,
          mode: handle ? (handle.classList.contains("left") ? "left" : "right") : "slip",
          t0: clip.t0,
          t1: clip.t1,
          src0: clip.srcIn || 0,
          speed: clip.speed > 0 ? clip.speed : 1,
        };
      }, (drag, dt) => {
        if (drag.mode === "slip") clip.srcIn = Math.max(0, drag.src0 - dt * drag.speed);
        else if (drag.mode === "left") {
          const nt = Math.max(0, Math.min(drag.t1 - 0.25, drag.t0 + dt));
          clip.t0 = nt;
          clip.srcIn = Math.max(0, drag.src0 + (nt - drag.t0) * drag.speed);
          state.t = nt;
        } else {
          clip.t1 = Math.max(drag.t0 + 0.25, Math.min(state.length || 20, drag.t1 + dt));
          state.t = clip.t1;
        }
        el.style.left = (origin + clip.t0 * pps) + "px";
        el.style.width = Math.max(44, (clip.t1 - clip.t0) * pps) + "px";
        name.textContent = (state.videoName || "Clip") + " · " + (clip.srcIn || 0).toFixed(1) + "s";
        updatePreviewChrome();
      });
      el.addEventListener("click", () => { state.selectedClip = i; });
      track.append(el);
    });
  }
  function paintLyricTrack(origin, pps) {
    const track = $("#lyricTrack");
    if (!track) return;
    track.innerHTML = "";
    state.lines.forEach((ln, i) => {
      const words = ln.words || [];
      if (!words.length) return;
      const a = words[0].start;
      const b = words[words.length - 1].end;
      const el = document.createElement("div");
      el.className = "lblock" + (state.selectedLine === i ? " on" : "");
      el.style.left = (origin + a * pps) + "px";
      el.style.width = Math.max(44, (b - a) * pps) + "px";
      const name = document.createElement("span");
      name.className = "lname";
      name.textContent = words.map((w) => w.text).join(" ");
      const left = document.createElement("button");
      left.type = "button";
      left.className = "trim left";
      left.setAttribute("aria-label", "Line start");
      const right = document.createElement("button");
      right.type = "button";
      right.className = "trim right";
      right.setAttribute("aria-label", "Line end");
      el.append(name, left, right);
      let moved = false;
      watchDrag(el, (e) => {
        const handle = e.target.closest && e.target.closest(".trim");
        moved = false;
        state.selectedLine = i;
        return {
          x0: e.clientX,
          mode: handle ? (handle.classList.contains("left") ? "left" : "right") : "tap",
          snap: words.map((w) => ({ start: w.start, end: w.end })),
        };
      }, (drag, dt) => {
        if (drag.mode === "tap") return;
        if (Math.abs(dt) < 0.02) return;
        moved = true;
        const snap = drag.snap;
        const a0 = snap[0].start;
        const b0 = snap[snap.length - 1].end;
        let na = a0;
        let nb = b0;
        if (drag.mode === "left") na = Math.max(0, Math.min(b0 - 0.2, a0 + dt));
        else nb = Math.max(a0 + 0.2, Math.min(state.length || 20, b0 + dt));
        const span0 = Math.max(0.05, b0 - a0);
        const span = Math.max(0.05, nb - na);
        words.forEach((w, wi) => {
          w.start = na + (snap[wi].start - a0) / span0 * span;
          w.end = na + (snap[wi].end - a0) / span0 * span;
        });
        const na2 = words[0].start;
        const nb2 = words[words.length - 1].end;
        el.style.left = (origin + na2 * pps) + "px";
        el.style.width = Math.max(44, (nb2 - na2) * pps) + "px";
        paintLines();
      });
      el.addEventListener("click", () => {
        if (moved) return;
        state.selectedLine = i;
        syncLyricInput();
        const input = $("#lyricInput");
        if (input) input.focus();
      });
      track.append(el);
    });
  }
  function paintZoomTrack(origin, pps) {
    const track = $("#zoomTrack");
    if (!track) return;
    track.innerHTML = "";
    zoomKeys().forEach((k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "diamond";
      b.style.left = (origin + k.t * pps) + "px";
      b.setAttribute("aria-label", "Zoom " + (+k.t).toFixed(1) + "s");
      b.addEventListener("click", (e) => e.stopPropagation());
      track.append(b);
    });
    track.onclick = (e) => {
      if (e.target.closest && e.target.closest(".diamond")) return;
      addZoomAt(state.t || 0);
    };
  }
  function sampleEdge(pred) {
    const cv = $("#stage");
    if (!cv || cv.width < 2) return false;
    const ctx = cv.getContext("2d");
    const w = cv.width;
    const h = cv.height;
    const pts = [[6, 6], [w - 7, 6], [6, Math.floor(h * 0.32)], [w - 7, Math.floor(h * 0.32)]];
    let hit = 0;
    pts.forEach((p) => {
      const d = ctx.getImageData(p[0], p[1], 1, 1).data;
      if (pred(d[0], d[1], d[2])) hit++;
    });
    return hit >= 2;
  }
  function isRedPx(r, g, b) { return r > 80 && r > g * 1.5 && r > b * 1.5; }
  function isBluePx(r, g, b) { return b > 80 && b > r * 1.5 && b > g * 1.5; }
  function pushStrips(rs, w, h) {
    const data = rs.cv.getContext("2d").getImageData(0, 0, w, h).data;
    const rowBytes = w * 4;
    const rows = Math.max(8, Math.min(32, Math.floor(180000 / rowBytes)));
    for (let y = 0; y < h; y += rows) {
      const rh = Math.min(rows, h - y);
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
  }
  async function renderProbe() {
    if (!window.Luciel || !Luciel.beginRender) return 0;
    state.renderResult = null;
    const w = 160;
    const h = 284;
    const fps = 10;
    const started = Luciel.beginRender(JSON.stringify({
      width: w, height: h, fps: fps, bitrate: 400000, start: 0, length: 1,
    }));
    if (started && started !== "ok") return 0;
    const canvas = document.createElement("canvas");
    const rs = new LLStage.Stage(canvas);
    rs.setSize(w, h, 1080);
    const slice = audioSlice();
    if (slice) rs.setAudio(slice, 8000);
    let colored = 0;
    for (let f = 0; f < 2; f++) {
      const t = f / fps;
      const src = sourceAt(t);
      if (state.videoEl && state.bg === "video" && src) await seekTo(state.videoEl, src.in);
      rs.setScene(scene(t));
      rs.drawFrame(t);
      const data = rs.cv.getContext("2d").getImageData(0, 0, w, h).data;
      const probe = (x, y) => {
        const o = (y * w + x) * 4;
        return isRedPx(data[o], data[o + 1], data[o + 2]);
      };
      if (probe(4, 4) || probe(w - 5, 4) || probe(4, 48) || probe(w - 5, 48)) colored++;
      pushStrips(rs, w, h);
    }
    Luciel.finishRender();
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
      if (state.renderResult) break;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    const bytes = state.renderResult && state.renderResult.bytes;
    return colored >= 1 && bytes > 1000 ? 1 : 0;
  }
  async function runVideoChecks() {
    const checks = { bgvideo: 0, split: 0, trim: 0, lyricdrag: 0, renderframes: 0 };
    const v = state.videoEl;
    try {
      if (!v || !v.videoWidth) return checks;
      state.bg = "video";
      state.clips = [freshClip(0, state.length || 20, 0, 1)];
      state.videoIn = 0;
      await seekTo(v, 0);
      draw(0.05);
      await seekTo(v, (sourceAt(0.05) || { in: 0 }).in);
      draw(0.05);
      if (sampleEdge(isRedPx)) checks.bgvideo = 1;
      const before = state.clips.length;
      if (splitAt((state.length || 20) / 2) && state.clips.length === before + 1) checks.split = 1;
      state.clips = [freshClip(0, state.length || 20, 1.4, 1)];
      state.videoIn = 1.4;
      const blueAt = (sourceAt(0.05) || { in: 1.45 }).in;
      await seekTo(v, blueAt);
      draw(0.05);
      await seekTo(v, (sourceAt(0.05) || { in: blueAt }).in);
      draw(0.05);
      if (!sampleEdge(isBluePx)) {
        await new Promise((ok) => setTimeout(ok, 250));
        await seekTo(v, (sourceAt(0.05) || { in: blueAt }).in);
        draw(0.05);
      }
      if (sampleEdge(isBluePx)) checks.trim = 1;
      const ln = state.lines[0];
      const end0 = ln && ln.words.length ? ln.words[ln.words.length - 1].end : 0;
      if (nudgeLine(0, 0.5)) {
        const end1 = state.lines[0].words[state.lines[0].words.length - 1].end;
        if (end1 - end0 > 0.3) checks.lyricdrag = 1;
        state.lines[0].words[state.lines[0].words.length - 1].end = end0;
        paintLines();
      }
      state.clips = [freshClip(0, state.length || 20, 0, 1)];
      state.videoIn = 0;
      state.bg = "video";
      checks.renderframes = await renderProbe();
      state.clips = [freshClip(0, state.length || 20, 0, 1)];
      state.selectedClip = 0;
      state.t = 0.45;
      saveEditor();
      await seekTo(v, 0.45);
      draw(0.45);
    } catch (e) {
      const status = $("#clipStatus");
      if (status) status.textContent = e && e.message ? e.message : "video check failed";
    }
    return checks;
  }

  async function boot() {
    loadEditor();
    const pendingVideo = params.get("videoPending") === "1";
    if (demo && !pendingVideo) {
      state.bg = "gradient";
      state.clips = [];
      state.videoName = "";
      state.videoEl = null;
      state.videoReady = false;
      state.thumbs = [];
      state.keys = [];
      state.zoomId = "none";
    }
    const res = await fetch("engine/presets.json");
    P = await res.json();
    if (window.LLFX) LLFX.setDefs(P.fx);
    state.fx = P.fx.map((f) => ({ id: f.id, label: f.label, amount: f.def || 40, on: false, option: (f.options || [null])[0] }));
    stage = new LLStage.Stage($("#stage"));
    try { await LLStage.loadFonts({}); } catch (e) {}
    if (demo) demoFill();
    paintLooks(); paintAnims(); paintPalettes(); paintZooms(); paintFx(); paintQuality(); paintTimeline();
    syncColors();
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((ok) => setTimeout(ok, 2500)),
      ]);
    } catch (e) {}
    await waitForVideo();
    if (pendingVideo && state.videoEl) state.t = 0.45;
    window.__audits = [];
    async function publish(screen) {
      if (screen === "look" || screen === "videocheck") paintLooks();
      await settle();
      fitAll();
      const msg = measure(screen);
      document.documentElement.dataset.scroll = String((document.scrollingElement || document.documentElement).scrollTop);
      window.__audits.push(msg);
      document.documentElement.dataset.audit = msg;
      if (demo !== "audit") {
        if (screen === "time") frameUnderPin(document.querySelector("#screen-time .editorcard"));
        if (screen === "render") frameUnderPin($("#quality"));
      }
      const log = document.getElementById("auditlog");
      if (log) log.textContent += msg + "\n";
      if (window.Luciel && Luciel.ready) Luciel.ready(msg);
    }
    if (demo === "videocheck") {
      state.checks = await runVideoChecks();
      show("look");
      draw(state.t > 0.05 ? state.t : 0.45);
      await publish("videocheck");
      return;
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
    if (demo === "syncshot") {
      theme(document.documentElement.dataset.theme || "aero");
      show("sync");
      installSyncShot();
      await publish("syncshot");
      return;
    }
    theme(document.documentElement.dataset.theme || "aero");
    const screen = ["track", "sync", "look", "time", "render"].includes(demo) ? demo : "track";
    show(screen);
    if (screen === "look" || screen === "time" || screen === "render") draw(state.t > 0.05 ? state.t : 1.35);
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
    updatePreviewChrome();
    if (state.screen === "time") paintEditor();
  };
  $("#title").oninput = () => { state.title = $("#title").value; draw(state.t || 1.2); };
  $("#artist").oninput = () => { state.artist = $("#artist").value; draw(state.t || 1.2); };
  $("#lyrics").addEventListener("input", () => {
    const sync = LS();
    const text = $("#lyrics").value;
    const clip = state.length || 20;
    if (!text.trim()) {
      state.lines = [];
      paintLines();
      draw(state.t || 1.2);
      $("#syncStatus").textContent = "Lyrics cleared.";
      return;
    }
    if (state.hyp && state.hyp.length) {
      const res = sync.alignLyrics(text, state.hyp, clip);
      if (res.error) {
        state.lines = sync.linesFromText(text, clip);
        $("#syncStatus").textContent = res.error;
      } else {
        state.lines = res.lines;
        $("#syncStatus").textContent = state.lines.length + " lines ready.";
      }
    } else {
      state.lines = sync.linesFromText(text, clip);
      $("#syncStatus").textContent = state.lines.length + " lines from your lyrics.";
    }
    paintLines();
    draw(state.t || 1.2);
  });
  $("#playClip").onclick = () => { mascot("music"); play(false); };
  $("#previewBtn").onclick = () => { togglePreview(); };
  $("#previewToggle").onclick = () => { togglePreview(); };
  $("#pickAudio").onclick = () => { if (window.Luciel) Luciel.pickAudio(); else $("#trackHint").textContent = "Song picking runs in the Android app."; };
  $("#pickVideo").onclick = () => { requestVideo(); };
  $("#uploadVideo").onclick = () => { requestVideo(); };
  $("#removeVideo").onclick = () => { removeClip(); };
  $("#tlSplit").onclick = () => { if (splitAt(state.t)) paintEditor(); };
  $("#tlDelete").onclick = () => { deleteClip(); };
  $("#tlAdd").onclick = () => { addClip(); };
  $("#tlReplace").onclick = () => { requestVideo(); };
  $("#tlSpeed").onclick = () => { cycleSpeed(); };
  $("#lyricInput").addEventListener("change", () => { commitLyricInput(); });
  $("#lyricInput").addEventListener("input", () => { commitLyricInput(); });
  $("#fontBtn").onclick = () => { if (window.Luciel) Luciel.pickFont(); };
  $("#getModel").onclick = () => {
    if (window.Luciel) { $("#modelText").textContent = "Downloading the speech model…"; Luciel.downloadModel(); }
    else $("#modelText").textContent = "The speech model downloads inside the Android app.";
  };
  $("#syncBtn").onclick = () => {
    if (!window.Luciel) { applyWords(DEMO.flatMap((l) => l.words)); return; }
    let info = {};
    try { info = JSON.parse(Luciel.info()); } catch (e) {}
    if (!info.whisper) {
      $("#syncStatus").textContent = "Speech recognition isn't in this build.";
      mascot("crying");
      return;
    }
    if (!info.model) {
      $("#syncStatus").textContent = "The speech model isn't on this phone yet. Downloading it now — tap Sync again when it finishes.";
      $("#modelText").textContent = "Downloading the speech model…";
      mascot("confused");
      Luciel.downloadModel();
      return;
    }
    mascot("confused");
    $("#syncStatus").textContent = "Listening to the section…";
    Luciel.transcribe(state.start, state.length);
  };
  $("#bgModes").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.bg = b.dataset.bg;
    document.querySelectorAll("#bgModes button").forEach((x) => x.classList.toggle("on", x === b));
    if (state.bg === "video" && !state.videoEl) {
      const status = $("#clipStatus");
      if (status && !state.videoName) status.textContent = "Upload a video to use this background.";
    }
    saveEditor();
    draw(state.t || 1);
  };
  $("#addKey").onclick = () => { addZoomAt(state.t || 0); };
  const tlscroll = $("#tlscroll");
  if (tlscroll) {
    tlscroll.addEventListener("scroll", () => {
      if (state.lockScroll || state.playing) return;
      state.t = Math.max(0, Math.min(state.length, tlscroll.scrollLeft / state.pxPerSec));
      draw(state.t);
      updatePreviewChrome();
    }, { passive: true });
    const pointers = new Map();
    tlscroll.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    tlscroll.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size < 2) return;
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (!state.pinch) { state.pinch = dist; return; }
      const ratio = dist / state.pinch;
      if (Math.abs(ratio - 1) < 0.02) return;
      state.pxPerSec = Math.max(24, Math.min(160, state.pxPerSec * ratio));
      state.pinch = dist;
      layoutEditor();
      followPlayhead();
    });
    const endPointer = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) state.pinch = 0; };
    tlscroll.addEventListener("pointerup", endPointer);
    tlscroll.addEventListener("pointercancel", endPointer);
  }
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
      const src = sourceAt(t);
      if (state.videoEl && state.bg === "video" && src) {
        if (Math.abs((state.videoEl.currentTime || 0) - src.in) > 0.05) {
          await seekTo(state.videoEl, src.in);
        }
      }
      rs.setScene(scene(t));
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
        else if (msg.ready) {
          $("#modelText").textContent = "Speech model is on this phone. Sync works offline.";
          const status = $("#syncStatus").textContent;
          if (status.indexOf("Downloading") >= 0 || status.indexOf("isn't on this phone") >= 0) {
            $("#syncStatus").textContent = "Speech model is ready. Tap Sync lyrics.";
          }
          mascot("happy");
        }
        else $("#modelText").textContent = "Downloading… " + Math.round((msg.progress || 0) * 100) + "%";
      } else if (msg.type === "sync" && msg.phase === "words") {
        const words = msg.words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
        applyWords(words);
      } else if (msg.type === "sync" && msg.error) {
        $("#syncStatus").textContent = msg.error; mascot("crying");
      } else if (msg.type === "sync") {
        $("#syncStatus").textContent = "Listening…";
      } else if (msg.type === "video" && msg.phase === "convert") {
        const status = $("#clipStatus");
        if (status) status.textContent = "Converting this video so it can play…";
      } else if (msg.type === "video" && msg.phase === "read") {
        const status = $("#clipStatus");
        if (status) status.textContent = "Reading the video…";
      } else if (msg.type === "video" && msg.ok) {
        attachVideo(msg.name, !msg.restored);
      } else if (msg.type === "video" && msg.removed) {
        clearVideoLocal();
      } else if (msg.type === "video" && msg.error) {
        const status = $("#clipStatus");
        if (status) status.textContent = msg.error;
        mascot("crying");
      } else if (msg.type === "font" && msg.ok) {
        const face = new FontFace("lc-custom", "url(https://appassets.androidplatform.net/files/custom.ttf)");
        face.load().then(() => { document.fonts.add(face); state.fontId = "custom"; draw(state.t || 1.2); mascot("happy"); });
      } else if (msg.type === "render" && msg.path) {
        state.renderResult = msg;
        $("#renderStatus").textContent = "Saved on this phone (" + Math.round(msg.bytes / 1000000) + " MB).";
        $("#shareBtn").hidden = false;
        mascot("happy");
      } else if (msg.type === "render" && msg.error) {
        state.renderResult = msg;
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
