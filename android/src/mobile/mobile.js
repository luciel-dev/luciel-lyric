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
    standard: { label: "Std", name: "Standard", w: 720, h: 1280, fps: 30, bitrate: 6000000 },
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
    aspect: "9:16", vfit: "fill", vscale: 1, vx: 0.5, vy: 0.5, tier: "fast", frameCv: null,
    selectedClip: 0, selectedLine: -1, selectedWord: -1, pxPerSec: 46, thumbs: [],
    overlays: [], nextOverlayId: 1,
    textStyle: null, textScope: "all",
    zoomId: "none", keys: [], quality: "standard", fx: [], playing: false, loopPreview: false, t: 0,
    checks: null,
  };
  const libs = {
    ws: null, regions: null, atl: null, mv: null, mute: false, ready: false,
    settled: false, syncSettled: false, span: 0, url: "", waiters: [], syncWaiters: [], pinchBase: 1,
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
    if (!canOpen(id)) return;
    state.screen = id;
    document.documentElement.dataset.screen = id;
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
    if (id === "look" || id === "time" || id === "render" || id === "video" || id === "sync") draw(state.t > 0.05 ? state.t : 1.2);
    if (id === "video") { paintEditor(); mountMoveable(); }
    if (id === "sync") { mountSyncWave(); syncRegions(); }
    layoutVidHandle();
    if (id !== "video") {
      const videoHost = document.getElementById("pin-video");
      if (videoHost) { videoHost.style.height = ""; videoHost.style.maxHeight = ""; }
      document.documentElement.style.removeProperty("--pin-h");
    }
    updatePreviewChrome();
    paintFlow();
    fitAll();
    if (id === "video") fitVideoFold();
    else if (id === "look" || id === "render" || id === "time" || id === "sync") fitPinClear();
    saveProject();
  }
  const STEP_ORDER = ["track", "sync", "video", "look", "time", "render"];
  function audioReady() {
    return !!state.audioReady && state.duration > 0 && state.peaks && state.peaks.length > 0;
  }
  function videoStepReady() {
    return !!(state.videoEl && (state.videoReady || state.videoEl.videoWidth));
  }
  function syncReady() {
    return (!!state.synced && state.lines && state.lines.length > 0) || (state.lines && state.lines.length > 0 && tapMarks.length >= state.lines.length);
  }
  function stepDone(id) {
    if (id === "track") return audioReady();
    if (id === "sync") return syncReady();
    if (id === "video") return videoStepReady();
    if (id === "look") return videoStepReady() && !!state.look;
    if (id === "time") return stepDone("look");
    if (id === "render") return !!(state.renderResult && state.renderResult.path);
    return false;
  }
  function stepOpen(id) {
    if (demo) return true;
    const i = STEP_ORDER.indexOf(id);
    if (i <= 0) return true;
    for (let k = 0; k < i; k++) if (!stepDone(STEP_ORDER[k])) return false;
    return true;
  }
  function canOpen(id) {
    if (id === "home" || id === "intro") return true;
    return stepOpen(id);
  }
  function stepHint(id) {
    if (id === "track") return audioReady() ? "Song ready." : "Choose a song to continue.";
    if (id === "sync") return syncReady() ? "Timings are locked." : "Line up the lyrics to continue.";
    if (id === "video") return videoStepReady() ? "Video ready." : "Add a video to continue.";
    if (id === "look") return state.look ? "Look chosen." : "Pick a look to continue.";
    if (id === "time") return "Set a zoom, or continue.";
    if (id === "render") return stepDone("render") ? "Ready to share." : "Make the video to finish.";
    return "";
  }
  function paintFlow() {
    STEP_ORDER.forEach((id) => {
      const done = stepDone(id);
      const open = stepOpen(id);
      const current = state.screen === id;
      document.querySelectorAll("#stepper button[data-screen='" + id + "'], #dock button[data-screen='" + id + "']").forEach((el) => {
        el.classList.toggle("done", done && !current);
        el.classList.toggle("current", current);
        el.classList.toggle("locked", !open && !current);
        el.setAttribute("aria-disabled", !open && !current ? "true" : "false");
      });
    });
    const emptyAudio = $("#audioEmpty");
    const workAudio = $("#audioWork");
    if (emptyAudio && workAudio) {
      emptyAudio.hidden = audioReady();
      workAudio.hidden = !audioReady();
    }
    const emptySync = $("#syncEmpty");
    if (emptySync) emptySync.hidden = syncReady();
    const emptyVideo = $("#videoEmpty");
    if (emptyVideo) emptyVideo.hidden = videoStepReady();
    document.querySelectorAll(".stepnext").forEach((btn) => {
      const id = btn.closest(".screen") && btn.closest(".screen").dataset.screen;
      const ready = id === "render" ? stepDone("render") : stepDone(id);
      btn.disabled = !ready;
      if (id === "render") btn.textContent = "Share";
    });
    const hints = { track: "#trackHint", sync: "#hintSync", video: "#hintVideo", look: "#hintLook", time: "#hintTime", render: "#hintRender" };
    const hint = hints[state.screen] ? $(hints[state.screen]) : null;
    if (hint && state.screen !== "track") hint.textContent = stepHint(state.screen);
    else if (state.screen === "track" && $("#trackHint") && !audioReady()) $("#trackHint").textContent = stepHint("track");
    const syncBtn = $("#syncBtn");
    if (syncBtn) syncBtn.textContent = syncReady() ? "Re-sync" : "Line up lyrics";
    const homeBtn = $("#continueProject");
    if (homeBtn) {
      const saved = hasProject();
      homeBtn.disabled = !saved;
      const homeHint = $("#homeHint");
      if (homeHint) homeHint.textContent = saved ? "Your last clip is saved on this phone." : "No saved project yet.";
    }
  }
  function hasProject() {
    try {
      const raw = localStorage.getItem("lc-project");
      if (!raw) return false;
      const o = JSON.parse(raw);
      return !!(o && (o.lyrics || o.audioName || o.videoName || (o.lines && o.lines.length)));
    } catch (e) { return false; }
  }
  let saveTimer = 0;
  function saveProject() {
    if (demo) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeProject, 250);
  }
  function writeProject() {
    if (demo) return;
    try {
      const lyrics = $("#lyrics") ? $("#lyrics").value : "";
      localStorage.setItem("lc-project", JSON.stringify({
        lyrics: lyrics,
        lines: state.lines,
        hyp: state.hyp,
        title: state.title,
        artist: state.artist,
        start: state.start,
        length: state.length,
        look: state.look,
        animId: state.animId,
        palette: state.palette,
        colorOv: state.colorOv,
        textStyle: state.textStyle,
        textScope: state.textScope,
        quality: state.quality,
        tier: state.tier,
        synced: !!state.synced,
        audioReady: !!state.audioReady,
        audioName: state.audioName || "",
        videoName: state.videoName || "",
        screen: state.screen,
        bg: state.bg,
      }));
    } catch (e) {}
    saveEditor();
  }
  function loadProject() {
    try {
      const raw = localStorage.getItem("lc-project");
      if (!raw) return false;
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object") return false;
      if (typeof o.lyrics === "string" && $("#lyrics")) $("#lyrics").value = o.lyrics;
      if (Array.isArray(o.lines)) state.lines = o.lines;
      if (Array.isArray(o.hyp)) state.hyp = o.hyp;
      if (typeof o.title === "string") { state.title = o.title; if ($("#title")) $("#title").value = o.title; }
      if (typeof o.artist === "string") { state.artist = o.artist; if ($("#artist")) $("#artist").value = o.artist; }
      if (typeof o.start === "number") state.start = o.start;
      if (typeof o.length === "number") state.length = o.length;
      if (typeof o.look === "string") state.look = o.look;
      if (typeof o.animId === "string") state.animId = o.animId;
      if (o.palette) state.palette = o.palette;
      if (o.colorOv) state.colorOv = o.colorOv;
      if (o.textStyle && typeof o.textStyle === "object") state.textStyle = o.textStyle;
      if (o.textScope === "line" || o.textScope === "all") state.textScope = o.textScope;
      if (typeof o.quality === "string") state.quality = o.quality;
      if (o.tier === "accurate" || o.tier === "fast") state.tier = o.tier;
      state.synced = !!o.synced;
      state.audioReady = !!o.audioReady;
      state.audioName = o.audioName || "";
      if (state.audioName && $("#trackName")) $("#trackName").textContent = state.audioName;
      if (o.bg === "gradient" || o.bg === "video" || o.bg === "black" || o.bg === "green") state.bg = o.bg;
      paintLines();
      paintTier();
      return true;
    } catch (e) { return false; }
  }
  function startNewProject() {
    try { localStorage.removeItem("lc-project"); localStorage.removeItem("lc-editor"); } catch (e) {}
    state.lines = [];
    state.hyp = [];
    state.title = "";
    state.artist = "";
    state.synced = false;
    state.audioReady = false;
    state.audioName = "";
    state.videoName = "";
    state.videoEl = null;
    state.videoReady = false;
    state.duration = 0;
    state.peaks = [];
    state.renderResult = null;
    state.bg = "gradient";
    state.clips = [];
    if ($("#lyrics")) $("#lyrics").value = "";
    if ($("#title")) $("#title").value = "";
    if ($("#artist")) $("#artist").value = "";
    if ($("#trackName")) $("#trackName").textContent = "No song yet";
    tapMarks.length = 0;
    show("track");
  }
  function showIntro(page) {
    const n = page === "intro3" ? 3 : page === "intro2" ? 2 : (state.introPage || 1);
    state.introPage = n;
    document.querySelectorAll(".intropage").forEach((el) => el.classList.toggle("on", el.dataset.intro === String(n)));
    const next = $("#introNext");
    if (next) next.textContent = n >= 3 ? "Start" : "Next";
    show("intro");
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
    if (stage && (state.screen === "look" || state.screen === "time" || state.screen === "render" || state.screen === "video" || state.screen === "sync")) {
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
      ".screen.on .colors label", "#previewTime", "#previewMeta"
    ].join(", ");
    document.querySelectorAll(sel).forEach((el) => {
      if (el.closest("#dock") || el.closest(".tlactions") || el.clientWidth < 2) return;
      el.style.letterSpacing = "";
      el.style.setProperty("--fit", "1");
      const floor = el.matches(".themes button, .brand, .tag") ? 0.4 : 0.5;
      let fit = 1;
      let guard = 0;
      while (guard++ < 18 && fit > floor && visualTooWide(el)) {
        if (!el.style.letterSpacing) el.style.letterSpacing = "0px";
        fit = Math.round((fit - 0.04) * 100) / 100;
        el.style.setProperty("--fit", String(fit));
      }
    });
    fitThemes();
    fitDock();
    fitStepper();
    fitActions();
    fitLines();
  }
  function fitStepper() {
    const buttons = [...document.querySelectorAll("#stepper button")];
    if (!buttons.length || buttons.some((b) => b.clientWidth < 2)) return;
    applyDockFit(buttons, 1);
    let fit = 1;
    let guard = 0;
    while (guard++ < 24 && fit > 0.4 && buttons.some(labelOverflow)) {
      fit = Math.round((fit - 0.03) * 100) / 100;
      applyDockFit(buttons, fit);
    }
  }
  function visualTooWide(el) {
    if (!el || el.clientWidth < 2) return false;
    if (el.closest(".hscroll") || el.closest(".tlscroll")) return false;
    const wide = overflowsX(el);
    const cs = getComputedStyle(el);
    const single = cs.whiteSpace === "nowrap" || el.matches("button, .brand, .tag, #previewTime");
    if (!single) return wide;
    const box = contentBox(el);
    const inner = box.right - box.left;
    if (inner < 8) return wide;
    return wide || measuredGlyph(el).width > inner + 1;
  }
  function fitThemes() {
    const buttons = [...document.querySelectorAll("#themes button")];
    // Time hides the header, so the theme buttons have no box to fit.
    if (!buttons.length || buttons.some((b) => b.clientWidth < 2)) return;
    buttons.forEach((b) => {
      b.style.letterSpacing = "0px";
      b.style.setProperty("--fit", "1");
    });
    const tooWide = (b) => {
      const inner = contentBox(b).right - contentBox(b).left;
      return measuredGlyph(b).width > inner - 6 || labelOverflow(b);
    };
    let fit = 1;
    let guard = 0;
    while (guard++ < 22 && fit > 0.4 && buttons.some(tooWide)) {
      fit = Math.round((fit - 0.03) * 100) / 100;
      buttons.forEach((b) => b.style.setProperty("--fit", String(fit)));
    }
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
    const maxR = Math.min(rect.width, rect.height) / 2;
    const radii = [
      parseFloat(cs.borderTopLeftRadius) || 0,
      parseFloat(cs.borderTopRightRadius) || 0,
      parseFloat(cs.borderBottomRightRadius) || 0,
      parseFloat(cs.borderBottomLeftRadius) || 0,
    ].map((r) => Math.min(r, maxR));
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
  function paintedWidth(label) {
    const text = (label.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return 0;
    const cs = getComputedStyle(label);
    const probe = paintedWidth.probe || (paintedWidth.probe = document.createElement("span"));
    if (!probe.parentNode) {
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;white-space:nowrap;pointer-events:none;margin:0;padding:0;border:0;";
      document.body.appendChild(probe);
    }
    // A live span picks up WebView textZoom. Canvas measureText does not, and
    // scaling it by 1.3 still undershoots Istok Web, so Winamp and Render
    // were clipped while the fitter thought they fit.
    probe.style.font = cs.font;
    probe.style.fontWeight = cs.fontWeight;
    probe.style.fontFamily = cs.fontFamily;
    probe.style.letterSpacing = "0px";
    probe.style.textTransform = cs.textTransform;
    probe.textContent = text;
    return probe.getBoundingClientRect().width;
  }
  function measuredGlyph(label) {
    const width = paintedWidth(label);
    return { advance: width, pastLeft: 0, pastRight: 0, width: width };
  }
  function glyphBox(label) {
    const text = textBounds(label);
    const glyph = measuredGlyph(label);
    const labelRect = label.getBoundingClientRect();
    if (!text && glyph.width < 1) return null;
    const mid = (labelRect.left + labelRect.right) / 2;
    const half = glyph.width / 2;
    return {
      left: mid - half,
      right: mid + half,
      top: text ? text.top : labelRect.top,
      bottom: text ? text.bottom : labelRect.bottom,
    };
  }
  function labelOverflow(btn) {
    const label = btn.querySelector(".docklabel, .steplabel") || btn;
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
  function fitActions() {
    const buttons = [...document.querySelectorAll("#screen-video .tlactions button")];
    if (buttons.length !== 5) return;
    applyDockFit(buttons, 1);
    let fit = 1;
    let guard = 0;
    while (guard++ < 28 && fit > 0.28 && buttons.some(labelOverflow)) {
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
    if (buttons.length !== 6 || buttons.some(labelOverflow)) return false;
    const sizes = buttons.map((b) => getComputedStyle(b.querySelector(".docklabel") || b).fontSize);
    return sizes.every((size) => size === sizes[0]);
  }
  function themeFits() {
    const buttons = [...document.querySelectorAll("#themes button")];
    if (buttons.length !== 3 || buttons.some(labelOverflow)) return false;
    const sizes = buttons.map((b) => getComputedStyle(b).fontSize);
    return sizes.every((size) => size === sizes[0]);
  }
  function actionsFit() {
    if (state.screen !== "video") return true;
    const buttons = [...document.querySelectorAll("#screen-video .tlactions button")];
    if (buttons.length !== 5 || buttons.some(labelOverflow)) return false;
    const sizes = buttons.map((b) => getComputedStyle(b).fontSize);
    return sizes.every((size) => size === sizes[0]);
  }
  function dockButtonsMiss() {
    const buttons = [...document.querySelectorAll("#dock button")];
    if (buttons.length !== 6) return "count";
    const bad = [];
    buttons.forEach((btn) => {
      const r = btn.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) { bad.push((btn.dataset.screen || "?") + ":size"); return; }
      const x = Math.round(Math.min(window.innerWidth - 2, Math.max(2, r.left + r.width / 2)));
      const y = Math.round(Math.min(window.innerHeight - 2, Math.max(2, r.top + r.height / 2)));
      const hit = document.elementFromPoint(x, y);
      if (hit !== btn) bad.push((btn.dataset.screen || "?") + ":" + (hit ? (hit.id || hit.className || hit.tagName) : "none"));
    });
    return bad.join("/");
  }
  function pinCoversDock() {
    const pin = document.getElementById("previewPin");
    const dock = document.querySelector(".dock");
    if (!pin || !dock) return false;
    const pr = pin.getBoundingClientRect();
    const dr = dock.getBoundingClientRect();
    if (pr.width < 2 || pr.height < 2) return false;
    return pr.bottom > dr.top + 1 && pr.top < dr.bottom - 1 && pr.left < dr.right && pr.right > dr.left;
  }
  function dockHitOk() {
    const bad = [];
    const miss = dockButtonsMiss();
    if (miss) bad.push(miss);
    if (pinCoversDock()) bad.push("overlap");
    const sc = document.scrollingElement || document.documentElement;
    const saved = sc.scrollTop;
    const max = Math.max(sc.scrollHeight, document.documentElement.scrollHeight, document.body.scrollHeight);
    if (max > 8) {
      sc.scrollTop = max;
      document.documentElement.scrollTop = max;
      document.body.scrollTop = max;
      pinPreview();
      const stuckMiss = dockButtonsMiss();
      if (stuckMiss) bad.push("stuck:" + stuckMiss);
      if (pinCoversDock()) bad.push("stuckoverlap");
      sc.scrollTop = saved;
      document.documentElement.scrollTop = saved;
      document.body.scrollTop = saved;
      pinPreview();
    }
    state.dockHitWhy = bad.join("/");
    return bad.length === 0;
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
    let min = 1e9, max = 0, n = 0;
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
          n++;
        }
      });
    } catch (e) { return false; }
    // A gradient has range. A flat video frame (the red/blue test clip) does not,
    // but it is still painted. An empty canvas stays near black and fails both.
    return max - min > 18 || (n > 0 && min > 24 && max > 48);
  }
  function inView(el, minH, full) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch (e) {}
    const r = el.getBoundingClientRect();
    const dockEl = document.querySelector(".dock");
    const dockTop = (!dockEl || getComputedStyle(dockEl).display === "none")
      ? window.innerHeight
      : dockEl.getBoundingClientRect().top;
    const dock = { top: dockTop };
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
    const roots = [document.querySelector(".top"), document.querySelector(".dock"), document.querySelector(".screen.on"), document.getElementById("textSheet")];
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
    const sel = ".brand, .tag, .themes button, .screen.on button, .screen.on h1, .screen.on h2, .screen.on .sum, .screen.on .lcd, .screen.on small, .screen.on .hint, .screen.on .lead, .screen.on .fx span, .screen.on .colors label, #previewTime, #previewMeta, #textSheet button, #textSheet h2, #textSheet .hint, #textSheet label";
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
    const dockEl = document.querySelector(".dock");
    const dockHidden = !dockEl || getComputedStyle(dockEl).display === "none";
    const dock = dockHidden ? { top: window.innerHeight } : dockEl.getBoundingClientRect();
    const r = last.getBoundingClientRect();
    const ok = r.height > 8 && r.bottom <= dock.top + 2 && r.left >= -1 && r.right <= window.innerWidth + 1;
    sc.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    return ok;
  }
  function contentFlags(screen) {
    const expect = { wave: 0, start: 0, play: 0, lyrics: 0, syncbtn: 0, syncregions: 0, stage: 0, looks: 0, palettes: 0, anims: 0, timeline: 0, zooms: 0, quality: 0, fx: 0, renderbtn: 0, title: 0, upload: 0, aspects: 0, fits: 0, vzoom: 0, overlay: 0, next: 0, steps: 0, intronext: 0, skip: 0, continuebtn: 0, startnew: 0, sheet: 0, fonts: 0, swatches: 0, tsize: 0, outline: 0, shadow: 0, alignn: 0, scope: 0, nudge: 0, linemerge: 0, undo: 0, preset: 0 };
    const flags = [];
    const kind = screen === "intro2" || screen === "intro3" ? "intro" : screen === "sheet" ? "sync" : screen;
    const titleEl = [...document.querySelectorAll(".screen.on h1")].find((el) => el.getClientRects().length);
    if (!inView(titleEl, 12)) flags.push("title");
    else expect.title = 1;
    if (kind === "track") {
      expect.wave = canvasBusy($("#wave")) ? 1 : 0;
      expect.start = inView($("#start"), 12) ? 1 : 0;
      expect.play = inView($("#playClip"), 28) ? 1 : 0;
      if (!expect.wave) flags.push("wave");
      if (!expect.start) flags.push("start");
      if (!expect.play) flags.push("play");
    } else if (kind === "sync") {
      expect.lyrics = inView($("#lyrics"), 32) ? 1 : 0;
      expect.syncbtn = inView($("#syncBtn"), 28) ? 1 : 0;
      if (!expect.lyrics) flags.push("lyrics");
      if (!expect.syncbtn) flags.push("syncbtn");
      if (screen !== "sheet") {
        const box = $("#syncWsBox");
        if (box) { try { box.scrollIntoView({ block: "center", inline: "nearest" }); } catch (e) {} }
        if (!handlesReady()) syncRegions();
        const handles = regionHandles();
        const sized = handles.length >= 2 && handles.every((h) => {
          const hr = h.getBoundingClientRect();
          return hr.width >= 48 && hr.height >= 48;
        });
        expect.syncregions = sized ? 1 : 0;
        if (!sized) flags.push("syncregions" + handles.length);
      }
    } else if (kind === "look") {
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
      const stageBusy = canvasBusy(stage);
      const stageSeen = inView(stage, 24);
      expect.stage = stageBusy && stageSeen ? 1 : 0;
      expect.looks = bitmaps && firstOk && lastOk && gridOk ? 13 : 0;
      const pals = document.querySelectorAll("#palettes button");
      const anims = document.querySelectorAll("#anims button");
      expect.palettes = pals.length === 12 && inView($("#palettes"), 20) ? 12 : pals.length;
      expect.anims = anims.length === 15 && inView($("#anims"), 20) ? 15 : anims.length;
      if (!expect.stage) flags.push(stageBusy ? "stageview" : stageSeen ? "stagepx" : "stage");
      if (expect.looks !== 13) flags.push("looks" + [bitmaps ? 1 : 0, firstOk ? 1 : 0, lastOk ? 1 : 0, gridOk ? 1 : 0, canvases.length].join(""));
      if (expect.palettes !== 12) flags.push("palettes");
      if (expect.anims !== 15) flags.push("anims");
    } else if (kind === "video") {
      const stageEl = $("#stage");
      const stageBusy = canvasBusy(stageEl);
      const stageSeen = inView(stageEl, 24);
      expect.stage = stageBusy && stageSeen ? 1 : 0;
      expect.upload = inView($("#uploadVideo"), 28) ? 1 : 0;
      const aspects = document.querySelectorAll("#aspects button");
      const fits = document.querySelectorAll("#vfit button");
      expect.aspects = aspects.length === 4 && inView($("#aspects"), 16) ? 4 : 0;
      expect.fits = fits.length === 3 && inView($("#vfit"), 16) ? 3 : 0;
      expect.vzoom = inView($("#vscale"), 12) ? 1 : 0;
      const atlCv = document.querySelector("#atl canvas");
      const painted = canvasBusy(atlCv) || canvasBusy($("#tl")) || canvasBusy(document.getElementById("film"));
      expect.timeline = painted && inView($("#tlview"), 16, false) ? 1 : 0;
      expect.overlay = inView($("#addOverlay"), 28) ? 1 : 0;
      if (!expect.stage) flags.push(stageBusy ? "stageview" : stageSeen ? "stagepx" : "stage");
      if (!expect.upload) flags.push("upload");
      if (expect.aspects !== 4) flags.push("aspects");
      if (expect.fits !== 3) flags.push("fits");
      if (!expect.vzoom) flags.push("vzoom");
      if (!expect.timeline) flags.push("timeline");
      if (!expect.overlay) flags.push("overlay");
      const syncLeak = document.querySelector("#screen-video #syncBtn, #screen-video #syncWsBox, #screen-video #lyrics");
      if (syncLeak) flags.push("lyricsync");
    } else if (kind === "time") {
      const zooms = document.querySelectorAll("#zooms button");
      expect.zooms = zooms.length === 5 && inView($("#zooms"), 16) ? 5 : zooms.length;
      if (expect.zooms !== 5) flags.push("zooms");
    } else if (kind === "render") {
      const q = document.querySelectorAll("#quality button");
      const fx = document.querySelectorAll("#fx label");
      expect.quality = q.length;
      expect.fx = fx.length;
      expect.renderbtn = inView($("#renderBtn"), 28) ? 1 : 0;
      if (q.length !== 4 || !inView($("#quality"), 20, false)) flags.push("quality");
      if (fx.length < 1 || !inView($("#fx"), 24, false)) flags.push("fx");
      if (!expect.renderbtn) flags.push("renderbtn");
    } else if (kind === "intro") {
      expect.intronext = inView($("#introNext"), 28) ? 1 : 0;
      expect.skip = inView($("#introSkip"), 28) ? 1 : 0;
      if (!expect.intronext) flags.push("intronext");
      if (!expect.skip) flags.push("skip");
    } else if (kind === "home") {
      expect.continuebtn = inView($("#continueProject"), 28) ? 1 : 0;
      expect.startnew = inView($("#startNew"), 28) ? 1 : 0;
      if (!expect.continuebtn) flags.push("continue");
      if (!expect.startnew) flags.push("startnew");
    }
    if (screen === "sheet") {
      const sc = document.scrollingElement || document.documentElement;
      sc.scrollTop = 0;
      reserveSheet();
      placeSheet();
      // The sheet scrolls on its own. Each control is brought into that
      // window so a wrapped row can be taller than the sheet.
      const countShown = (sel, min) => [...document.querySelectorAll(sel)].filter((el) => sheetInView(el, min)).length;
      expect.fonts = countShown("#fontPick button", 36);
      expect.swatches = countShown("#swatches button", 36);
      expect.tsize = sheetInView($("#textSize"), 12) ? 1 : 0;
      expect.outline = sheetInView($("#outlineAmt"), 12) ? 1 : 0;
      expect.shadow = sheetInView($("#shadowAmt"), 12) ? 1 : 0;
      expect.alignn = countShown("#alignPick button", 36);
      expect.scope = countShown("#scopePick button", 36);
      expect.nudge = sheetInView($("#nudgeBack"), 36) && sheetInView($("#nudgeFwd"), 36) ? 2 : 0;
      expect.linemerge = sheetInView($("#splitLine"), 36) && sheetInView($("#mergeLine"), 36) ? 2 : 0;
      expect.undo = sheetInView($("#undoText"), 36) && sheetInView($("#redoText"), 36) && sheetInView($("#sheetClose"), 36) && sheetInView($("#sheetWords"), 28) ? 1 : 0;
      expect.preset = sheetInView($("#savePreset"), 36) ? 1 : 0;
      expect.sheet = expect.fonts === 3 && expect.swatches === 6 && expect.tsize && expect.outline && expect.shadow && expect.alignn === 3 && expect.scope === 2 && expect.nudge === 2 && expect.linemerge === 2 && expect.undo && expect.preset ? 1 : 0;
      if (!expect.sheet) flags.push("sheet");
    }
    if (STEP_ORDER.indexOf(kind) >= 0) {
      const nextBtn = document.querySelector("#screen-" + kind + " .stepnext");
      expect.next = nextBtn && inView(nextBtn, 28) ? 1 : 0;
      const stepBtns = document.querySelectorAll("#stepper button");
      expect.steps = (kind === "video" || (stepBtns.length === 6 && inView($("#stepper"), 28))) ? 6 : 0;
      if (!expect.next) flags.push("next");
      if (expect.steps !== 6) flags.push("steps");
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
    const textBad = lead.textContent.indexOf("Paste the words") === -1;
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
  function fitVideoFold() {
    const host = document.getElementById("pin-video");
    const actions = document.querySelector("#screen-video .tlactions");
    const dock = document.querySelector(".dock");
    if (!host || !actions || !dock || state.screen !== "video") return;
    host.style.height = "";
    host.style.maxHeight = "";
    document.documentElement.style.removeProperty("--pin-h");
    sizePreview();
    let guard = 0;
    const timeline = document.getElementById("tlview");
    while (guard++ < 24) {
      const dockLimit = dock.getBoundingClientRect().top - 4;
      const barTop = actions.getBoundingClientRect().top - 4;
      const limit = Math.min(dockLimit, barTop);
      const bottom = timeline ? timeline.getBoundingClientRect().bottom : actions.getBoundingClientRect().bottom;
      if (bottom <= limit && actions.getBoundingClientRect().bottom <= dockLimit + 4) break;
      const h = host.getBoundingClientRect().height;
      const next = Math.floor(h - (bottom - limit) - 1);
      if (!(next < h - 0.5)) break;
      const clamped = Math.max(72, next);
      host.style.height = clamped + "px";
      host.style.maxHeight = clamped + "px";
      sizePreview();
      if (clamped <= 72) break;
    }
    const fitted = Math.round(host.getBoundingClientRect().height);
    if (fitted > 48) document.documentElement.style.setProperty("--pin-h", fitted + "px");
    refreshMoveable();
  }
  function labelNodes() {
    const sel = "button, h1, h2, .sum, .brand, .tag, .docklabel, .lead, .hint, .lcd, #previewTime, #previewMeta, .clipname, .colors label, .lookgrid small, .fx span";
    return [...document.querySelectorAll(sel)].filter((el) => {
      if (el.closest(".tlscroll") || el.closest(".hscroll") || el.closest(".lineedit")) return false;
      return el.clientWidth >= 2 && el.clientHeight >= 2;
    });
  }
  function splitWord(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent || "";
      const re = /[^\s\u00ad\-–—/]+/g;
      let m;
      while ((m = re.exec(text))) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const tops = [];
        [...range.getClientRects()].forEach((r) => {
          if (r.width > 1 && r.height > 1 && !tops.some((t) => Math.abs(t - r.top) < 2)) tops.push(r.top);
        });
        if (tops.length > 1) return m[0];
      }
      node = walker.nextNode();
    }
    return "";
  }
  function midWordWraps() {
    const bad = [];
    labelNodes().forEach((el) => {
      const word = splitWord(el);
      if (word) bad.push(describe(el) + ":" + word);
    });
    return bad;
  }
  function ellipsisHits() {
    const bad = [];
    labelNodes().forEach((el) => {
      const cs = getComputedStyle(el);
      const clipped = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      if (cs.textOverflow === "ellipsis" && clipped) bad.push(describe(el));
      if (el.id === "previewTime" && el.scrollWidth > el.clientWidth + 1) bad.push("time");
    });
    return bad;
  }
  function headingClear() {
    const head = document.querySelector(".screen.on .screenhead");
    let h1 = head && head.querySelector("h1");
    let lead = head && head.querySelector(".lead");
    if (!h1) {
      h1 = [...document.querySelectorAll(".screen.on h1")].find((el) => el.getClientRects().length) || null;
      lead = h1 && h1.parentElement ? h1.parentElement.querySelector(".lead") : null;
    }
    if (!h1) return false;
    const leadShown = !!(lead && getComputedStyle(lead).display !== "none" && lead.getClientRects().length);
    const sys = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sys-top")) || 0;
    const dockEl = document.querySelector(".dock");
    const dock = (dockEl && getComputedStyle(dockEl).display !== "none")
      ? dockEl.getBoundingClientRect()
      : { top: window.innerHeight, bottom: window.innerHeight, left: 0, right: 0, width: 0, height: 0 };
    const blockers = [document.getElementById("safebar"), document.querySelector(".dock"), document.querySelector(".dockplate"), document.getElementById("previewPin")];
    function problem(el) {
      const r = el.getBoundingClientRect();
      if (r.height < 8 || r.width < 8) return "size";
      if (r.top < sys - 1) return "top";
      if (r.bottom > dock.top + 1) return "dock";
      if (r.left < -1 || r.right > window.innerWidth + 1) return "x";
      for (let i = 0; i < blockers.length; i++) {
        const b = blockers[i];
        if (!b) continue;
        const br = b.getBoundingClientRect();
        if (br.width < 2 || br.height < 2) continue;
        const overlap = r.left < br.right - 1 && r.right > br.left + 1 && r.top < br.bottom - 1 && r.bottom > br.top + 1;
        if (overlap) return b.id || "plate";
      }
      const x = Math.round(Math.min(window.innerWidth - 2, Math.max(2, r.left + 12)));
      const y = Math.round(r.top + Math.min(10, r.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (!hit) return "miss";
      if (hit.id === "safebar" || (hit.closest && (hit.closest(".dock") || hit.closest(".dockplate") || hit.closest("#previewPin")))) return "hit";
      if (hit !== el && !el.contains(hit) && !(head && head.contains(hit))) return "cover";
      return "";
    }
    const why = [problem(h1), leadShown ? problem(lead) : ""].filter(Boolean).join("/");
    state.headWhy = why;
    return !why;
  }
  function videoFoldOk() {
    const why = (msg) => { document.documentElement.dataset.foldWhy = msg; return false; };
    const dockTop = document.querySelector(".dock").getBoundingClientRect().top;
    const view = document.getElementById("tlview");
    const bar = document.querySelector("#screen-video .tlactions");
    if (!view) return why("view");
    const vr = view.getBoundingClientRect();
    const barTop = bar ? bar.getBoundingClientRect().top : dockTop;
    const limit = Math.min(dockTop, barTop);
    if (vr.height < 80 || vr.top < -1 || vr.bottom > limit + 1) return why("viewbox" + Math.round(vr.top) + "-" + Math.round(vr.bottom) + "/" + Math.round(limit));
    if (vr.left < -1 || vr.right > window.innerWidth + 1) return why("viewx");
    if (document.documentElement.dataset.editor === "libs") {
      const el = document.querySelector("#atl");
      if (!el) return why("miss#atl");
      const r = el.getBoundingClientRect();
      if (r.height < 12 || r.top < -1 || r.bottom > limit + 1) return why("#atlout" + Math.round(r.top) + "-" + Math.round(r.bottom));
      if (r.top < vr.top - 2 || r.bottom > vr.bottom + 2) return why("#atlclip" + Math.round(r.bottom) + "/" + Math.round(vr.bottom));
      if (r.height < 64 || r.height > 110) return why("band" + Math.round(r.height));
      const controls = [...document.querySelectorAll(".moveable-control")];
      if (controls.length < 2) return why("controls" + controls.length);
      for (let i = 0; i < controls.length; i++) {
        const cr = controls[i].getBoundingClientRect();
        if (cr.width < 48 || cr.height < 48) return why("control" + Math.round(cr.width) + "x" + Math.round(cr.height));
      }
    } else {
      const rows = ["#ruler", "#videoTrack"];
      for (let i = 0; i < rows.length; i++) {
        const el = document.querySelector(rows[i]);
        if (!el) return why("miss" + rows[i]);
        const r = el.getBoundingClientRect();
        if (r.height < 12 || r.top < -1 || r.bottom > limit + 1) return why(rows[i]);
        if (r.top < vr.top - 2 || r.bottom > vr.bottom + 2) return why(rows[i] + "clip");
      }
    }
    const actions = ["#tlSplit", "#tlDelete", "#tlAdd", "#tlReplace", "#tlSpeed"];
    for (let i = 0; i < actions.length; i++) {
      const el = document.querySelector(actions[i]);
      if (!el) return why("act");
      const r = el.getBoundingClientRect();
      if (r.height < 48 || r.width < 28 || r.top < -1 || r.bottom > dockTop + 1) return why(actions[i] + Math.round(r.height) + "x" + Math.round(r.width) + "b" + Math.round(r.bottom) + "/" + Math.round(dockTop));
      if (r.left < -1 || r.right > window.innerWidth + 1) return why(actions[i] + "x");
    }
    document.documentElement.dataset.foldWhy = "";
    return true;
  }
  function filmReady() {
    const cv = document.getElementById("film")
      || document.querySelector("#atl canvas")
      || document.querySelector("#videoTrack canvas");
    if (!cv || cv.width < 48 || cv.height < 20) return false;
    const rect = cv.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 16) return false;
    let prev = -1;
    let changes = 0;
    try {
      const ctx = cv.getContext("2d");
      const y = Math.max(1, Math.floor(cv.height * 0.3));
      const step = Math.max(8, Math.floor(cv.width / 36));
      for (let x = 1; x < cv.width; x += step) {
        const p = ctx.getImageData(x, y, 1, 1).data;
        const lum = p[0] + p[1] + p[2];
        if (prev >= 0 && Math.abs(lum - prev) > 18) changes++;
        prev = lum;
      }
    } catch (e) { return false; }
    return changes >= 1;
  }
  function measure(screen) {
    const logical = screen === "syncshot" || screen === "sheet" ? "sync" : screen === "videocheck" ? "look" : screen;
    const sc = document.scrollingElement || document.documentElement;
    sc.scrollTop = 0;
    sc.scrollLeft = 0;
    sizePreview();
    fitAll();
    const sheetEl = document.getElementById("textSheet");
    if (sheetEl && !sheetEl.hidden) document.documentElement.dataset.sheet = "1";
    else document.documentElement.removeAttribute("data-sheet");
    if (logical === "video") fitVideoFold();
    else if (logical === "look" || logical === "render" || logical === "time" || logical === "sync") fitPinClear();
    reserveSheet();
    placeSheet();
    dropOverflowMeta();
    const dockHidden = getComputedStyle(document.querySelector(".dock")).display === "none";
    const hitOk = dockHidden ? 1 : (dockHitOk() ? 1 : 0);
    const actionOk = actionsFit() ? 1 : 0;
    const wrapHits = midWordWraps();
    const ellHits = ellipsisHits();
    const headVisible = headingClear() ? 1 : 0;
    const foldOk = logical === "video" ? (videoFoldOk() ? 1 : 0) : 1;
    const filmOk = logical === "video" ? (filmReady() ? 1 : 0) : 1;
    const { expect, flags } = contentFlags(screen === "sheet" ? "sheet" : logical);
    if (wrapHits.length) flags.push("wrap:" + wrapHits.slice(0, 2).join("|").replace(/\s+/g, ""));
    if (ellHits.length) flags.push("ellipsis:" + ellHits.slice(0, 2).join("|").replace(/\s+/g, ""));
    if (!headVisible) flags.push("headclear" + (state.headWhy ? ":" + state.headWhy : ""));
    if (!foldOk) flags.push("fold");
    if (!filmOk) flags.push("film");
    if (!hitOk) flags.push("dockhit" + (state.dockHitWhy ? ":" + state.dockHitWhy : ""));
    if (!actionOk) flags.push("actionfit");
    const wide = pageWide();
    const box = textWide();
    const clear = clearsDock() ? 1 : 0;
    sc.scrollTop = 0;
    sc.scrollLeft = 0;
    if (!clear) flags.push("clear");
    wide.slice(0, 4).forEach((w) => flags.push("wide:" + w));
    box.slice(0, 4).forEach((w) => flags.push("box:" + w));
    const labels = [...document.querySelectorAll("#themes button")].map((b) => b.textContent.trim()).join("/");
    const dockWords = [...document.querySelectorAll("#dock .docklabel")].map((b) => b.textContent.trim()).join("/");
    const dockNums = [...document.querySelectorAll("#dock .dockn")].map((b) => b.textContent.trim()).join("");
    const themesOk = labels === "Aero/Y2K/Winamp" ? 1 : 0;
    const dockOk = dockWords === "Audio/Sync/Video/Look/Time/Render" && dockNums === "123456" ? 1 : 0;
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
    const themeFit = themeFits() ? 1 : 0;
    if (!themeFit) flags.push("themefit");
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
    if (logical === "look" || logical === "time" || logical === "render" || logical === "video" || logical === "sync") {
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
      "syncregions=" + expect.syncregions,
      "stage=" + expect.stage,
      "looks=" + expect.looks,
      "palettes=" + expect.palettes,
      "anims=" + expect.anims,
      "timeline=" + expect.timeline,
      "zooms=" + expect.zooms,
      "quality=" + expect.quality,
      "fx=" + expect.fx,
      "renderbtn=" + expect.renderbtn,
      "upload=" + expect.upload,
      "aspects=" + expect.aspects,
      "fits=" + expect.fits,
      "vzoom=" + expect.vzoom,
      "overlay=" + expect.overlay,
      "next=" + expect.next,
      "steps=" + expect.steps,
      "intronext=" + expect.intronext,
      "skip=" + expect.skip,
      "continue=" + expect.continuebtn,
      "startnew=" + expect.startnew,
      "sheet=" + expect.sheet,
      "fonts=" + expect.fonts,
      "swatches=" + expect.swatches,
      "tsize=" + expect.tsize,
      "outline=" + expect.outline,
      "shadow=" + expect.shadow,
      "alignn=" + expect.alignn,
      "scope=" + expect.scope,
      "nudge=" + expect.nudge,
      "linemerge=" + expect.linemerge,
      "undo=" + expect.undo,
      "preset=" + expect.preset,
      "clear=" + clear,
      "fit=" + (box.length ? 0 : 1),
      "overflow=" + wide.length,
      "box=" + box.length,
      "inset=" + inset,
      "themes=" + themesOk,
      "dock=" + dockOk,
      "dockfit=" + dockFit,
      "themefit=" + themeFit,
      "linerows=" + lineOk,
      "lineshead=" + headOk,
      "rows=" + maxRows.toFixed(2),
      "lead=" + lead,
      "words=" + wordsOk,
      "edit=" + editOk,
      "frames=" + framesOk,
      "edited=" + editedOk,
      "previewpin=" + pinOk,
      "wrap=" + wrapHits.length,
      "ellipsis=" + ellHits.length,
      "headclear=" + headVisible,
      "fold=" + foldOk,
      "film=" + filmOk,
      "dockhit=" + hitOk,
      "actionfit=" + actionOk,
      "bgvideo=" + (checks.bgvideo || 0),
      "split=" + (checks.split || 0),
      "trim=" + (checks.trim || 0),
      "lyricdrag=" + (checks.lyricdrag || 0),
      "renderframes=" + (checks.renderframes || 0),
      "layers=" + (checks.layers || 0)
    ];
    if (flags.length) parts.push("missing=" + flags.slice(0, 8).join(","));
    const scEnd = document.scrollingElement || document.documentElement;
    scEnd.scrollTop = 0;
    reserveSheet();
    placeSheet();
    return parts.join(" ");
  }
  function resolved() {
    const lk = P.looks[state.look] || P.looks.noir;
    const anim = P.anims.find((a) => a.id === state.animId) || P.anims[0];
    const style = Object.assign({}, P.styleDefaults, lk.style, anim.style || {}, (state.palette && state.palette.colors) || {}, state.colorOv || {}, state.textStyle || {});
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
  function aspectParts() {
    const raw = state.aspect || "9:16";
    const bits = raw.split(":");
    const w = +bits[0] || 9;
    const h = +bits[1] || 16;
    return { w: w, h: h, label: raw };
  }
  function frameWH(base) {
    const a = aspectParts();
    if (a.w >= a.h) {
      const h = base;
      const w = Math.round(h * a.w / a.h / 2) * 2;
      return { w: w, h: h };
    }
    const w = base;
    const h = Math.round(w * a.h / a.w / 2) * 2;
    return { w: w, h: h };
  }
  function outputSize(q) {
    return frameWH(q.w);
  }
  function placeWord(label, value) {
    if (value < 0.35) return label === "x" ? "Left" : "Up";
    if (value > 0.65) return label === "x" ? "Right" : "Down";
    return "Center";
  }
  function framedVideo(W, H) {
    const v = state.videoEl;
    if (!v || !v.videoWidth || state.bg !== "video") return null;
    if (!state.frameCv) state.frameCv = document.createElement("canvas");
    const cv = state.frameCv;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    cv.videoWidth = W;
    cv.videoHeight = H;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const vw = v.videoWidth, vh = v.videoHeight;
    const contain = Math.min(W / vw, H / vh);
    const cover = Math.max(W / vw, H / vh);
    let base = state.vfit === "fit" ? contain : cover;
    if (state.vfit === "crop") base = cover * 1.18;
    base *= Math.max(1, +state.vscale || 1);
    const rw = vw * base;
    const rh = vh * base;
    const x = (W - rw) * (state.vx == null ? 0.5 : state.vx);
    const y = (H - rh) * (state.vy == null ? 0.5 : state.vy);
    ctx.drawImage(v, x, y, rw, rh);
    return cv;
  }
  function activeLineAt(t) {
    const lines = state.lines || [];
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      const ws = lines[i] && lines[i].words;
      if (!ws || !ws.length) continue;
      if (idx < 0) idx = i;
      if (t + 0.001 >= ws[0].start) idx = i;
      if (t >= ws[0].start && t < ws[ws.length - 1].end) return i;
    }
    return idx;
  }
  function scene(t, size) {
    const r = resolved();
    const style = Object.assign({}, r.style);
    const live = state.lines[activeLineAt(t || 0)];
    if (live && live.style) Object.assign(style, live.style);
    const groups = window.LL.prepare(state.lines, style, r.anim, state.length);
    const keys = state.zoomId === "custom" ? state.keys : (window.LL.zoomPreset(state.zoomId, state.length, groups) || []);
    const at = Math.max(0, t || 0);
    const src = state.bg === "video" ? sourceAt(at) : null;
    const W = size ? size.w : (stage && stage.W) || 360;
    const H = size ? size.h : (stage && stage.H) || 640;
    return {
      style: style, anim: r.anim, lines: state.lines, title: state.title, artist: state.artist,
      clipLen: state.length, visualizer: true, bgMode: state.bg, grad: r.lk.grad, wave: r.lk.wave,
      zoom: { keys, target: "bg" }, fx: state.fx.filter((f) => f.on), fps: 30,
      video: src ? framedVideo(W, H) : null,
      clip: src,
      darken: state.bg === "video" ? 0.35 : 0.35, blur: 0,
    };
  }
  function paintOverlays(t, canvas) {
    const cv = canvas || $("#stage");
    if (!cv || cv.width < 2) return;
    const active = (state.overlays || []).filter((o) => o && o.text && t >= o.start && t < o.end);
    if (!active.length) return;
    const ctx = cv.getContext("2d");
    const W = cv.width;
    const H = cv.height;
    ctx.save();
    ctx.font = Math.round(H * 0.045) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2, H * 0.004);
    ctx.strokeStyle = "rgba(16,32,40,0.85)";
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    active.forEach((o, i) => {
      const y = H * 0.16 + i * H * 0.055;
      ctx.strokeText(o.text, W * 0.5, y);
      ctx.fillText(o.text, W * 0.5, y);
    });
    ctx.restore();
  }
  function draw(t) {
    if (!stage) return;
    const px = frameWH(360);
    const at = Math.max(0, Math.min(state.length - 0.05, t || 0));
    stage.setSize(px.w, px.h, 1080);
    const slice = audioSlice();
    if (slice) stage.setAudio(slice, 8000);
    seekVideo(at);
    stage.setScene(scene(at));
    stage.drawFrame(at);
    paintOverlays(at, $("#stage"));
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
        state.textStyle = null;
        state.lines.forEach((ln) => { if (ln) delete ln.style; });
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
    const out = outputSize(q);
    $("#qualityHint").textContent = (q.name || q.label) + ": " + out.w + "×" + out.h + " · " + q.fps + " fps. Phone Max is 1080p30.";
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
  function editLineText(ln, text) {
    return LS().applyLineText(ln, text, { lock: syncReady() });
  }
  const SWATCHES = [
    ["#ffffff", "White"], ["#1d2a33", "Ink"], ["#f2d7a2", "Sand"],
    ["#7eb8c9", "Sky"], ["#d4a24a", "Gold"], ["#c47a6a", "Rose"],
  ];
  let undoStack = [];
  let redoStack = [];
  let undoArmed = false;
  function lineText(ln) {
    return (ln && ln.words ? ln.words : []).map((w) => w.text).join(" ");
  }
  function snapshotText() {
    return JSON.stringify({
      lines: state.lines,
      textStyle: state.textStyle,
      textScope: state.textScope,
      colorOv: state.colorOv,
      fontId: state.fontId,
    });
  }
  function paintUndo() {
    const undoBtn = $("#undoText");
    const redoBtn = $("#redoText");
    if (undoBtn) undoBtn.disabled = !undoStack.length;
    if (redoBtn) redoBtn.disabled = !redoStack.length;
  }
  function armUndo() {
    if (undoArmed) return;
    undoArmed = true;
    undoStack.push(snapshotText());
    if (undoStack.length > 40) undoStack.shift();
    redoStack = [];
    paintUndo();
  }
  function restoreText(raw) {
    const o = JSON.parse(raw);
    state.lines = o.lines || [];
    state.textStyle = o.textStyle || null;
    state.textScope = o.textScope === "line" ? "line" : "all";
    state.colorOv = o.colorOv || null;
    state.fontId = o.fontId || "";
    writeLyrics(state.lines.map(lineText).join("\n"));
    paintLines();
    syncColors();
    draw(state.t || 1);
    paintSheet();
    saveProject();
  }
  function undoText() {
    if (!undoStack.length) return;
    redoStack.push(snapshotText());
    undoArmed = false;
    restoreText(undoStack.pop());
  }
  function redoText() {
    if (!redoStack.length) return;
    undoStack.push(snapshotText());
    undoArmed = false;
    restoreText(redoStack.pop());
  }
  function effectiveStyle() {
    const base = resolved().style;
    const ln = state.selectedLine >= 0 ? state.lines[state.selectedLine] : null;
    return Object.assign({}, base, (ln && ln.style) || {});
  }
  function setStyleKey(key, value) {
    armUndo();
    if (state.textScope === "line" && state.selectedLine >= 0 && state.lines[state.selectedLine]) {
      const ln = state.lines[state.selectedLine];
      ln.style = Object.assign({}, ln.style, { [key]: value });
    } else {
      state.textStyle = Object.assign({}, state.textStyle || {}, { [key]: value });
      state.lines.forEach((ln) => { if (ln && ln.style) delete ln.style[key]; });
      if (key === "color") {
        state.colorOv = Object.assign({}, state.colorOv || {}, { color: value, active: value, sung: value });
      }
      if (key === "font") state.fontId = "";
    }
    draw(state.t || 1);
    paintSheet();
    saveProject();
  }
  function sizeWord(n) {
    if (n < 0.07) return "Small";
    if (n < 0.1) return "Medium";
    return "Large";
  }
  function amountWord(n, soft) {
    if (n <= 0.001) return "Off";
    return n < soft ? "Soft" : "Strong";
  }
  function paintSheet() {
    const sheet = $("#textSheet");
    if (!sheet || sheet.hidden) return;
    const s = effectiveStyle();
    const words = $("#sheetWords");
    const ln = state.selectedLine >= 0 ? state.lines[state.selectedLine] : null;
    if (words && document.activeElement !== words) words.value = ln ? lineText(ln) : "";
    $("#sizeVal").textContent = sizeWord(+s.size || 0.085);
    $("#textSize").value = String(s.size || 0.085);
    $("#outlineVal").textContent = amountWord(+s.strokeWidth || 0, 0.04);
    $("#outlineAmt").value = String(s.strokeWidth || 0);
    $("#shadowVal").textContent = amountWord(+s.shadowAlpha || 0, 0.4);
    $("#shadowAmt").value = String(s.shadowAlpha || 0);
    document.querySelectorAll("#fontPick button").forEach((b) => b.classList.toggle("on", b.dataset.font === (s.font || "Poppins") && !state.fontId));
    document.querySelectorAll("#alignPick button").forEach((b) => b.classList.toggle("on", b.dataset.align === (s.align || "center")));
    document.querySelectorAll("#scopePick button").forEach((b) => b.classList.toggle("on", b.dataset.scope === state.textScope));
    const sw = $("#swatches");
    if (sw && !sw.childElementCount) {
      SWATCHES.forEach((pair) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.color = pair[0];
        b.setAttribute("aria-label", pair[1]);
        b.style.background = pair[0];
        sw.append(b);
      });
    }
    sw.querySelectorAll("button").forEach((b) => b.classList.toggle("on", (s.color || "").toLowerCase() === b.dataset.color));
    $("#undoText").disabled = !undoStack.length;
    $("#redoText").disabled = !redoStack.length;
    const row = $("#presetRow");
    row.innerHTML = "";
    let presets = [];
    try { presets = JSON.parse(localStorage.getItem("lc-text-presets") || "[]"); } catch (e) { presets = []; }
    presets.forEach((p, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = p.name || ("Look " + (i + 1));
      b.onclick = () => {
        armUndo();
        undoArmed = false;
        if (state.textScope === "line" && state.lines[state.selectedLine]) state.lines[state.selectedLine].style = Object.assign({}, p.style);
        else {
          state.textStyle = Object.assign({}, p.style);
          state.lines.forEach((rowLn) => { if (rowLn) delete rowLn.style; });
          if (p.style && p.style.color) state.colorOv = Object.assign({}, state.colorOv || {}, { color: p.style.color, active: p.style.color, sung: p.style.color });
          if (p.style && p.style.font) state.fontId = "";
        }
        draw(state.t || 1);
        paintSheet();
        saveProject();
      };
      row.append(b);
    });
    const hint = $("#sheetHint");
    if (hint && !presets.length) hint.textContent = "Drag the words on the preview to move them.";
  }
  function reserveSheet() {
    const sheet = $("#textSheet");
    const pin = $("#previewPin");
    const host = pin && pin.parentElement;
    if (!sheet || sheet.hidden || !host || !host.classList.contains("pinhost")) return;
    const dock = document.querySelector(".dock");
    if (!dock) return;
    fitPinClear();
    const dockTop = dock.getBoundingClientRect().top;
    const top = host.getBoundingClientRect().top;
    const available = Math.floor(dockTop - 8 - top);
    const pinMin = 56;
    const roomForSheet = available - pinMin;
    if (roomForSheet < 64) return;
    const sheetH = Math.min(240, Math.max(88, Math.min(Math.floor(available * 0.62), roomForSheet)));
    const pinH = available - sheetH;
    host.style.height = pinH + "px";
    host.style.maxHeight = pinH + "px";
    sizePreview();
  }
  function placeSheet() {
    const sheet = $("#textSheet");
    if (!sheet) return;
    if (sheet.hidden) { sheet.style.maxHeight = ""; sheet.style.bottom = ""; return; }
    const dock = document.querySelector(".dock");
    const dockTop = !dock || getComputedStyle(dock).display === "none" ? window.innerHeight : dock.getBoundingClientRect().top;
    const pin = document.getElementById("previewPin");
    const pinBox = pin && pin.getBoundingClientRect().height > 8 ? pin.getBoundingClientRect() : null;
    const head = document.querySelector(".screen.on .screenhead");
    const headBottom = head && head.getBoundingClientRect().height > 8 ? head.getBoundingClientRect().bottom : 96;
    const limit = pinBox ? Math.max(headBottom, pinBox.bottom) : headBottom;
    const top = limit + 8;
    const room = Math.floor(dockTop - 8 - top);
    sheet.style.bottom = Math.max(0, Math.round(window.innerHeight - dockTop + 8)) + "px";
    sheet.style.maxHeight = Math.max(0, room) + "px";
  }
  function sheetInView(el, minH) {
    const sheet = document.getElementById("textSheet");
    if (!el || !sheet) return false;
    const sr0 = sheet.getBoundingClientRect();
    const er0 = el.getBoundingClientRect();
    sheet.scrollTop += (er0.top + er0.height / 2) - (sr0.top + sr0.height / 2);
    const r = el.getBoundingClientRect();
    const sr = sheet.getBoundingClientRect();
    const dockEl = document.querySelector(".dock");
    const dockTop = !dockEl ? window.innerHeight : dockEl.getBoundingClientRect().top;
    if (r.left < -1 || r.right > window.innerWidth + 1) return false;
    return r.width >= 8 && r.height >= minH && r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1 && r.bottom <= dockTop + 1;
  }
  function openSheet() {
    const sheet = $("#textSheet");
    if (!sheet) return;
    if (state.selectedLine < 0 && state.lines.length) state.selectedLine = 0;
    sheet.hidden = false;
    document.documentElement.dataset.sheet = "1";
    const ln = state.lines[state.selectedLine];
    if (ln && ln.words && ln.words.length) {
      const w = ln.words[Math.max(0, state.selectedWord)] || ln.words[0];
      state.t = Math.min(state.length - 0.05, Math.max(0.05, w.start + 0.04));
      draw(state.t);
    }
    placeSheet();
    paintSheet();
    document.querySelectorAll("#lineList li").forEach((li, i) => {
      li.querySelectorAll(".wordchip").forEach((chip, wi) => {
        chip.classList.toggle("on", i === state.selectedLine && wi === state.selectedWord);
      });
    });
  }
  function closeSheet() {
    const sheet = $("#textSheet");
    if (sheet) sheet.hidden = true;
    document.documentElement.removeAttribute("data-sheet");
    undoArmed = false;
    fitPinClear();
  }
  function nudgeLineTime(delta) {
    const ln = state.lines[state.selectedLine];
    if (!ln || !ln.words || !ln.words.length) return;
    armUndo();
    undoArmed = false;
    if (!LS().nudgeWords(ln.words, delta, state.length || 20)) return;
    paintLines();
    syncRegions();
    paintTimeline();
    draw(state.t || ln.words[0].start);
    saveProject();
  }
  function splitSelectedLine() {
    const i = state.selectedLine;
    const ln = state.lines[i];
    if (!ln || !ln.words || ln.words.length < 2) return;
    armUndo();
    undoArmed = false;
    let at = state.selectedWord > 0 ? state.selectedWord : Math.ceil(ln.words.length / 2);
    if (at <= 0 || at >= ln.words.length) at = Math.ceil(ln.words.length / 2);
    const next = { words: ln.words.slice(at), low_confidence: !!ln.low_confidence };
    if (ln.style) next.style = Object.assign({}, ln.style);
    ln.words = ln.words.slice(0, at);
    state.lines.splice(i + 1, 0, next);
    state.selectedWord = 0;
    writeLyrics(state.lines.map(lineText).join("\n"));
    paintLines();
    syncRegions();
    paintTimeline();
    draw(state.t || 1);
    paintSheet();
    saveProject();
  }
  function mergeSelectedLine() {
    const i = state.selectedLine;
    if (i < 0 || state.lines.length < 2) return;
    const j = i < state.lines.length - 1 ? i + 1 : i - 1;
    armUndo();
    undoArmed = false;
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    state.lines[a].words = state.lines[a].words.concat(state.lines[b].words);
    state.lines.splice(b, 1);
    state.selectedLine = a;
    state.selectedWord = 0;
    writeLyrics(state.lines.map(lineText).join("\n"));
    paintLines();
    syncRegions();
    paintTimeline();
    draw(state.t || 1);
    paintSheet();
    saveProject();
  }
  function saveTextPreset() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem("lc-text-presets") || "[]"); } catch (e) { list = []; }
    const s = effectiveStyle();
    const keep = ["font", "size", "color", "active", "sung", "strokeWidth", "strokeColor", "shadowAlpha", "shadowBlur", "shadowY", "shadowColor", "align", "posY", "posX"];
    const snap = {};
    keep.forEach((k) => { if (s[k] != null) snap[k] = s[k]; });
    list.push({ name: "Look " + (list.length + 1), style: snap });
    if (list.length > 6) list = list.slice(list.length - 6);
    try { localStorage.setItem("lc-text-presets", JSON.stringify(list)); } catch (e) {}
    paintSheet();
  }
  function hitPreviewWord(ev) {
    const cv = $("#stage");
    if (!cv || !stage || !stage.groups) return null;
    const r = cv.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const x = (ev.clientX - r.left) / r.width * cv.width;
    const y = (ev.clientY - r.top) / r.height * cv.height;
    for (let gi = stage.groups.length - 1; gi >= 0; gi--) {
      const g = stage.groups[gi];
      const lay = g._lay;
      if (!lay) continue;
      const fs = lay.fs || 16;
      for (let wi = 0; wi < g.words.length; wi++) {
        const p = lay.pos[wi];
        if (!p) continue;
        if (x >= p.x - 6 && x <= p.x + p.w + 6 && y >= p.y - fs && y <= p.y + fs * 0.35) {
          const line = g.line || 0;
          const start = g.words[wi].s;
          const words = (state.lines[line] && state.lines[line].words) || [];
          let word = words.findIndex((w) => Math.abs(w.start - start) < 0.03);
          if (word < 0) word = wi;
          return { line, word };
        }
      }
    }
    return null;
  }
  function paintLines() {
    const ol = $("#lineList");
    ol.innerHTML = "";
    state.lines.forEach((ln, i) => {
      const li = document.createElement("li");
      const edit = document.createElement("span");
      edit.className = "lineedit" + (ln.low_confidence ? " low" : "");
      edit.contentEditable = "true";
      edit.spellcheck = false;
      edit.setAttribute("role", "textbox");
      edit.setAttribute("aria-label", "Line " + (i + 1));
      edit.textContent = lineText(ln);
      edit.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); edit.blur(); }
      });
      edit.addEventListener("focus", () => {
        state.selectedLine = i;
        state.selectedWord = -1;
        armUndo();
        openSheet();
      });
      edit.addEventListener("input", () => {
        armUndo();
        if (editLineText(state.lines[i], edit.textContent)) {
          draw(state.t || 1.2);
          const words = $("#sheetWords");
          if (words && document.activeElement !== words) words.value = lineText(state.lines[i]);
          $("#syncStatus").textContent = "Line updated.";
          syncRegions();
        }
      });
      edit.addEventListener("blur", () => {
        setTimeout(() => {
          const active = document.activeElement;
          if (active && active.classList && (active.classList.contains("wordchip") || active.classList.contains("lineedit") || active.id === "sheetWords")) return;
          undoArmed = false;
          if (!state.lines[i]) return;
          if (!editLineText(state.lines[i], edit.textContent)) edit.textContent = lineText(state.lines[i]);
          writeLyrics(state.lines.map(lineText).join("\n"));
          paintLines();
          draw(state.t || 1.2);
        }, 0);
      });
      const row = document.createElement("div");
      row.className = "wordrow";
      (ln.words || []).forEach((w, wi) => {
        const chip = document.createElement("span");
        chip.className = "wordchip" + (state.selectedLine === i && state.selectedWord === wi ? " on" : "");
        chip.contentEditable = "true";
        chip.spellcheck = false;
        chip.setAttribute("role", "textbox");
        chip.setAttribute("aria-label", w.text);
        chip.textContent = w.text;
        chip.addEventListener("focus", () => {
          state.selectedLine = i;
          state.selectedWord = wi;
          armUndo();
          openSheet();
        });
        chip.addEventListener("input", () => {
          armUndo();
          const parts = (ln.words || []).map((word, k) => (k === wi ? chip.textContent : word.text));
          if (editLineText(ln, parts.join(" "))) {
            edit.textContent = lineText(ln);
            const words = $("#sheetWords");
            if (words && document.activeElement !== words) words.value = lineText(ln);
            draw(state.t || w.start || 1);
          }
        });
        chip.addEventListener("blur", () => { undoArmed = false; });
        row.append(chip);
      });
      li.append(edit, row);
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
    cv.style.height = "16px";
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
    // Pause only stops the clock. Word timings stay where sync left them.
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
      if (res.lines && res.lines.length) {
        state.lines = res.lines;
      } else {
        state.synced = false;
        state.lines = sync.linesFromText(pasted, clip);
        paintLines();
        $("#syncStatus").textContent = res.error || "Couldn't match these lyrics.";
        mascot("crying");
        draw(Math.min(1.2, Math.max(0.2, state.length - 0.05)));
        return;
      }
    } else {
      state.lines = sync.groupLines(cleaned);
      state.lines.forEach((ln) => {
        const cs = ln.words.map((w) => (w.confidence == null ? 1 : +w.confidence));
        const mean = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 0;
        ln.confidence = Math.round(mean * 1000) / 1000;
        ln.low_confidence = mean < 0.35;
      });
    }
    if (!state.lines.length) {
      $("#syncStatus").textContent = "No lyric lines came out of that section.";
      mascot("crying");
      return;
    }
    state.synced = true;
    paintLines();
    paintFlow();
    const low = state.lines.filter((ln) => ln.low_confidence).length;
    $("#syncStatus").textContent = low
      ? low + (low === 1 ? " line needs" : " lines need") + " a look. Tap Mark to fix them."
      : state.lines.length + " lines ready.";
    mascot(low ? "confused" : "happy");
    if (!low) show("video");
    draw(Math.min(1.2, Math.max(0.2, state.length - 0.05)));
  }
  function installSyncShot() {
    const built = syncedFromFixture();
    state.length = 12;
    state.hyp = built.words;
    state.lines = built.res.lines;
    LS().applyLineText(state.lines[1], "voices, voicing me my name, edited", { lock: true });
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
    state.audioReady = true;
    state.synced = true;
    state.audioName = "sample · glass-static";
    const sr = 8000, n = sr * 8;
    samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = 0.4 * Math.sin(i / 18) * (0.5 + 0.5 * Math.sin(i / 400));
    paintWave();
    paintLines();
    if (!state.videoEl && !state.clips.length) {
      state.clips = [freshClip(0, state.length || 20, 0, 1)];
      state.thumbs = syntheticThumbs();
      if (!state.videoName) state.videoName = "glass-static";
      state.overlays = [];
    }
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
  function pinAnchor() {
    const sys = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sys-top")) || 0;
    const header = document.querySelector(".top");
    if (!header || getComputedStyle(header).display === "none") return sys;
    const r = header.getBoundingClientRect();
    if (r.height > 8 && r.bottom > sys + 8) return Math.ceil(r.bottom);
    return sys;
  }
  function pinPreview() {
    const pin = $("#previewPin");
    const host = pin && pin.parentElement;
    if (!pin || !host || !host.classList.contains("pinhost")) return;
    const anchor = pinAnchor();
    const top = host.getBoundingClientRect().top;
    const stuck = top < anchor - 1;
    pin.classList.toggle("stuck", stuck);
    document.documentElement.style.setProperty("--pin-top", anchor + "px");
    sizePreview();
  }
  function stageRoom() {
    const wrap = document.querySelector("#previewPin .stagewrap");
    if (!wrap) return 0;
    return wrap.getBoundingClientRect().height;
  }
  function pictureRoom() {
    const wrap = document.querySelector("#previewPin .stagewrap");
    const bar = document.querySelector("#previewPin .previewbar");
    if (!wrap) return 0;
    const wr = wrap.getBoundingClientRect();
    if (!bar || getComputedStyle(bar).position !== "absolute") return wr.height;
    const br = bar.getBoundingClientRect();
    const top = Math.max(wr.top, br.top);
    const bot = Math.min(wr.bottom, br.bottom);
    const covered = bot > top ? bot - top : 0;
    return Math.max(0, wr.height - covered);
  }
  function fitPinClear() {
    const pin = $("#previewPin");
    const host = pin && pin.parentElement;
    const dock = document.querySelector(".dock");
    if (!host || !host.classList.contains("pinhost") || !dock || state.screen === "video") return;
    const lead = document.querySelector(".screen.on .screenhead .lead");
    const root = document.documentElement;
    root.removeAttribute("data-compact");
    if (lead) lead.style.display = "";
    const tighten = () => {
      host.style.height = "";
      host.style.maxHeight = "";
      pin.classList.remove("stuck");
      sizePreview();
      const sc = document.scrollingElement || document.documentElement;
      let guard = 0;
      while (guard++ < 16) {
        const hostDocTop = host.getBoundingClientRect().top + sc.scrollTop;
        const limit = dock.getBoundingClientRect().top - 8;
        const bottomAtRest = hostDocTop + host.getBoundingClientRect().height;
        if (bottomAtRest <= limit) break;
        const h = host.getBoundingClientRect().height;
        const next = Math.floor(h - (bottomAtRest - limit) - 1);
        if (!(next < h - 0.5)) break;
        // Stay above the dock. A 48px floor used to overlap it once the
        // stepper and the lyrics line were on screen.
        const clamped = Math.max(0, next);
        host.style.height = clamped + "px";
        host.style.maxHeight = clamped + "px";
        sizePreview();
        if (clamped <= 20) break;
      }
    };
    const cramped = () => {
      const dockTop = dock.getBoundingClientRect().top;
      const leadShown = lead && getComputedStyle(lead).display !== "none";
      const leadR = leadShown ? lead.getBoundingClientRect() : null;
      const leadBad = state.screen === "sync" && (!leadR || leadR.height < 8 || leadR.bottom > dockTop - 2);
      return pictureRoom() < 36 || stageRoom() < 28 || host.getBoundingClientRect().bottom > dockTop - 4 || leadBad;
    };
    tighten();
    if (cramped() || root.dataset.sheet === "1") {
      root.dataset.compact = "1";
      if (lead) lead.style.display = "";
      tighten();
    }
    // Lyrics keeps its line. Other steps drop the line so the picture stays.
    if (state.screen !== "sync" && lead && (pictureRoom() < 36 || stageRoom() < 28)) {
      lead.style.display = "none";
      tighten();
    }
  }
  function sizePreview() {
    const pin = $("#previewPin");
    const canvas = $("#stage");
    if (!pin || !canvas) return;
    const host = pin.parentElement && pin.parentElement.classList.contains("pinhost") ? pin.parentElement : null;
    const stuck = pin.classList.contains("stuck");
    const fitted = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pin-h")) || 0;
    if (stuck) {
      const dockEl = document.querySelector(".dock");
      const anchor = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pin-top")) || 0;
      const dockTop = dockEl ? dockEl.getBoundingClientRect().top : window.innerHeight;
      const cap = Math.max(48, dockTop - anchor - 8);
      const vh = window.innerHeight * 0.3;
      const want = fitted > 48 ? fitted : vh;
      const used = Math.max(48, Math.min(want, cap, window.innerHeight * 0.32));
      pin.style.height = Math.round(used) + "px";
      pin.style.maxHeight = Math.round(used) + "px";
    } else {
      pin.style.height = "";
      pin.style.maxHeight = "";
    }
    // API 30 WebView ignores `inset`, so an absolute pin otherwise shrinks to a
    // zero-height canvas. Stretch it to the host with the longhand edges.
    if (!stuck) {
      pin.style.top = "0";
      pin.style.right = "0";
      pin.style.bottom = "0";
      pin.style.left = "0";
    } else {
      pin.style.top = "";
      pin.style.right = "";
      pin.style.bottom = "";
      pin.style.left = "";
    }
    const box = stuck ? pin : (host || pin);
    if (box.clientHeight < 20 || box.clientWidth < 20) return;
    const bar = pin.querySelector(".previewbar");
    const barFloat = bar && getComputedStyle(bar).position === "absolute";
    const cs = getComputedStyle(pin);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const availH = Math.max(16, box.clientHeight - padY - (barFloat ? 0 : (bar ? bar.offsetHeight : 0)));
    const availW = Math.max(16, box.clientWidth - padX);
    const a = aspectParts();
    let h = availH;
    let w = Math.round(h * a.w / a.h);
    if (w > availW) {
      w = availW;
      h = Math.round(w * a.h / a.w);
    }
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    layoutVidHandle();
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
  window.addEventListener("scroll", () => { pinPreview(); placeSheet(); }, { passive: true });
  window.addEventListener("resize", () => {
    sizePreview();
    if (state.screen === "video") fitVideoFold();
    else if (state.screen === "look" || state.screen === "render" || state.screen === "time" || state.screen === "sync") fitPinClear();
  });

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
  function readVideo() {
    return {
      aspect: state.aspect,
      vfit: state.vfit,
      vscale: state.vscale,
      vx: state.vx,
      vy: state.vy,
      videoName: state.videoName,
      length: state.length || 20,
      clips: (state.clips || []).map((c) => ({
        t0: c.t0, t1: c.t1, srcIn: c.srcIn || 0, speed: c.speed > 0 ? c.speed : 1,
      })),
    };
  }
  function commitVideo(edit) {
    const layers = window.LucielLayers;
    const before = layers.lyricStamp(state.lines, state.textStyle);
    const next = layers.applyVideoEdit(readVideo(), edit);
    state.aspect = next.aspect;
    state.vfit = next.vfit;
    state.vscale = next.vscale;
    state.vx = next.vx;
    state.vy = next.vy;
    state.videoName = next.videoName;
    if (edit && edit.inplace && next.clips.length === state.clips.length) {
      next.clips.forEach((c, i) => {
        state.clips[i].t0 = c.t0;
        state.clips[i].t1 = c.t1;
        state.clips[i].srcIn = c.srcIn;
        state.clips[i].speed = c.speed;
      });
    } else {
      state.clips = next.clips.map((c) => freshClip(c.t0, c.t1, c.srcIn, c.speed));
      if (state.selectedClip >= state.clips.length) state.selectedClip = Math.max(0, state.clips.length - 1);
    }
    if (layers.lyricStamp(state.lines, state.textStyle) !== before) {
      throw new Error("video edit changed lyric text");
    }
    return next;
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
      paintOverlays(at, $("#stage"));
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
        aspect: state.aspect,
        vfit: state.vfit,
        vscale: state.vscale,
        vx: state.vx,
        vy: state.vy,
        overlays: state.overlays,
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
      if (o.aspect === "9:16" || o.aspect === "1:1" || o.aspect === "16:9" || o.aspect === "4:5") state.aspect = o.aspect;
      if (o.vfit === "fit" || o.vfit === "fill" || o.vfit === "crop") state.vfit = o.vfit;
      if (typeof o.vscale === "number") state.vscale = Math.max(1, Math.min(2.5, o.vscale));
      if (typeof o.vx === "number") state.vx = Math.max(0, Math.min(1, o.vx));
      if (typeof o.vy === "number") state.vy = Math.max(0, Math.min(1, o.vy));
      if (Array.isArray(o.overlays)) {
        state.overlays = o.overlays.filter((item) => item && typeof item.text === "string").map((item) => ({
          id: item.id != null ? item.id : state.nextOverlayId++,
          text: String(item.text).slice(0, 48),
          start: Math.max(0, +item.start || 0),
          end: Math.max(0.12, +item.end || 0),
        }));
        const maxId = state.overlays.reduce((m, item) => Math.max(m, +item.id || 0), 0);
        if (maxId >= state.nextOverlayId) state.nextOverlayId = maxId + 1;
      }
    } catch (e) {}
  }
  function syncBgPills() {
    document.querySelectorAll("#bgModes button").forEach((b) => b.classList.toggle("on", b.dataset.bg === state.bg));
  }
  function clockText(t) {
    const whole = Math.floor(Math.max(0, t) + 1e-3);
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function dropOverflowMeta() {
    const meta = document.getElementById("previewMeta");
    if (!meta) return;
    if (!meta.textContent) { meta.hidden = true; return; }
    meta.hidden = false;
    if (meta.clientWidth > 8 && meta.scrollWidth > meta.clientWidth + 1) meta.hidden = true;
    const pin = document.getElementById("previewPin");
    const bar = pin && pin.querySelector(".previewbar");
    if (pin && bar && !meta.hidden) {
      const cs = getComputedStyle(pin);
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const borderY = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      const room = pin.getBoundingClientRect().height - borderY - padY - bar.offsetHeight;
      if (room < 28) meta.hidden = true;
    }
    sizePreview();
  }
  function updatePreviewChrome() {
    const len = state.length || 20;
    const t = Math.max(0, Math.min(len, state.t || 0));
    const time = $("#previewTime");
    if (time) time.textContent = clockText(t) + " / " + clockText(len);
    const playing = !!state.playing;
    const toggle = $("#previewToggle");
    if (toggle) {
      toggle.classList.toggle("on", playing);
      toggle.setAttribute("aria-label", playing ? "Pause" : "Play");
    }
    const previewBtn = $("#previewBtn");
    if (previewBtn) previewBtn.textContent = playing ? "Pause" : "Play";
    const meta = $("#previewMeta");
    if (meta) {
      if (state.screen === "render") {
        const q = QUALITY[state.quality] || QUALITY.standard;
        const out = outputSize(q);
        meta.textContent = out.w + "×" + out.h;
      } else meta.textContent = aspectParts().label;
      dropOverflowMeta();
    }
    const labelEl = $("#clipLabel");
    if (labelEl) labelEl.textContent = state.videoName || "No video yet";
    const rm = $("#removeVideo");
    if (rm) rm.hidden = !state.videoName;
    const tn = $("#timeClipName");
    if (tn) tn.textContent = state.videoName ? state.videoName : "Upload the MP4 on Video.";
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
    if (!sc || state.screen !== "video") return;
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
    state.videoReady = false;
    state.thumbs = [];
    state.bg = "gradient";
    state.videoIn = 0;
    commitVideo({ op: "clear" });
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
        commitVideo({ op: "swap", name: state.videoName || "video" });
        state.videoIn = 0;
        state.selectedClip = 0;
      }
      try { await grabThumbs(); } catch (e) {}
      state.videoReady = true;
      saveEditor();
      paintFlow();
      syncBgPills();
      if (state.screen === "video") paintEditor();
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
    const before = state.clips.length;
    commitVideo({ op: "split", t: t });
    if (state.clips.length !== before + 1) return false;
    const i = state.clips.findIndex((c) => Math.abs(c.t0 - t) < 0.001);
    state.selectedClip = i >= 0 ? i : before;
    saveEditor();
    return true;
  }
  function deleteClip() {
    if (!state.clips.length) return;
    const i = state.selectedClip >= 0 && state.selectedClip < state.clips.length ? state.selectedClip : 0;
    commitVideo({ op: "delete", index: i });
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
    commitVideo({ op: "add", t0: t0, t1: t1 });
    state.selectedClip = state.clips.length - 1;
    saveEditor();
    paintEditor();
    draw(state.t || t0);
  }
  function cycleSpeed() {
    const c = state.clips[state.selectedClip];
    if (!c) return;
    const speed = c.speed === 1 ? 2 : c.speed === 2 ? 0.5 : 1;
    commitVideo({ op: "speed", index: state.selectedClip, speed: speed });
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
    if (!editLineText(state.lines[i], input.value)) return;
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
  function settleEditor() {
    libs.settled = true;
    const waiters = libs.waiters.splice(0);
    waiters.forEach((fn) => fn());
  }
  function whenEditor() {
    if (libs.settled) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 1800);
      libs.waiters.push(() => { clearTimeout(timer); resolve(); });
    });
  }
  function handlesReady() {
    const handles = regionHandles();
    if (handles.length < 2) return false;
    return handles.every((h) => {
      const r = h.getBoundingClientRect();
      return r.width >= 48 && r.height >= 48;
    });
  }
  function settleSync() {
    if (libs.syncSettled || !handlesReady()) return;
    libs.syncSettled = true;
    const waiters = libs.syncWaiters.splice(0);
    waiters.forEach((fn) => fn());
  }
  function whenSync() {
    if (handlesReady()) {
      libs.syncSettled = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 1800);
      libs.syncWaiters.push(() => { clearTimeout(timer); resolve(); });
      const poll = () => {
        if (libs.syncSettled) return;
        syncRegions();
        if (handlesReady()) settleSync();
        else setTimeout(poll, 80);
      };
      poll();
    });
  }
  function libCanvas(sel) {
    const host = document.querySelector(sel);
    if (!host) return null;
    if (host.tagName === "CANVAS") return host;
    const inner = host.querySelector("canvas");
    if (inner) return inner;
    const root = host.shadowRoot;
    return root ? root.querySelector("canvas") : null;
  }
  function regionHandles() {
    const out = [];
    const regions = libs.regions && libs.regions.getRegions ? libs.regions.getRegions() : [];
    regions.forEach((region) => {
      if (!region.element) return;
      region.element.querySelectorAll('[part*="region-handle"]').forEach((h) => out.push(h));
    });
    return out;
  }
  function tuneRegionHandles() {
    regionHandles().forEach((h) => {
      h.style.width = "48px";
      h.style.minWidth = "48px";
      h.style.height = "48px";
      h.style.minHeight = "48px";
      h.style.touchAction = "none";
    });
    const wrap = libs.ws && libs.ws.getWrapper && libs.ws.getWrapper();
    const root = wrap && wrap.getRootNode ? wrap.getRootNode() : null;
    if (root && root.appendChild && root !== document && !root.querySelector("[data-touch='1']")) {
      const style = document.createElement("style");
      style.dataset.touch = "1";
      style.textContent = '[part*="region-handle"]{width:48px!important;min-width:48px!important;height:48px!important;min-height:48px!important;touch-action:none;}';
      root.appendChild(style);
    }
  }
  function sectionPeaks() {
    const src = state.peaks && state.peaks.length ? state.peaks : fakePeaks(240);
    const dur = Math.max(state.duration || 0, (state.start || 0) + (state.length || 0), state.length || 1);
    const a = dur > 0 ? (state.start || 0) / dur : 0;
    const b = dur > 0 ? Math.min(1, ((state.start || 0) + (state.length || 0)) / dur) : 1;
    const i0 = Math.max(0, Math.floor(a * src.length));
    const i1 = Math.max(i0 + 8, Math.min(src.length, Math.ceil(b * src.length)));
    const slice = src.slice(i0, i1);
    return slice.length ? slice : src;
  }
  function silentWav(seconds) {
    const sr = 8000;
    const n = Math.max(1, Math.floor(sr * Math.max(0.2, seconds || 1)));
    const buffer = new ArrayBuffer(44 + n * 2);
    const view = new DataView(buffer);
    const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + n * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, n * 2, true);
    return new Blob([buffer], { type: "audio/wav" });
  }
  function atlModel() {
    const video = [];
    const titles = [];
    (state.clips || []).forEach((c) => {
      const a = Math.round((+c.t0 || 0) * 1000);
      const b = Math.round(Math.max((+c.t0 || 0) + 0.12, +c.t1 || 0) * 1000);
      video.push({ val: a, group: "c:" + c.id }, { val: Math.max(a + 120, b), group: "c:" + c.id });
    });
    (state.overlays || []).forEach((o) => {
      const a = Math.round((+o.start || 0) * 1000);
      const b = Math.round(Math.max((+o.start || 0) + 0.12, +o.end || 0) * 1000);
      titles.push({ val: a, group: "o:" + o.id }, { val: Math.max(a + 120, b), group: "o:" + o.id });
    });
    return { rows: [
      { keyframes: video },
      { keyframes: titles },
    ] };
  }
  function pushAtl() {
    if (!libs.atl) return;
    libs.mute = true;
    try {
      libs.atl.setOptions({
        max: Math.max(1000, (state.length || 20) * 1000),
        stepPx: state.pxPerSec || 46,
        stepVal: 1000,
        leftMargin: 0,
      });
      libs.atl.setModel(atlModel());
      lockAtlScroll();
    } catch (e) {}
    libs.mute = false;
  }
  function lockAtlScroll() {
    const root = document.getElementById("atl");
    if (!root) return;
    const sc = root.querySelector("div");
    if (sc) {
      sc.style.overflow = "hidden";
      sc.scrollLeft = 0;
      sc.scrollTop = 0;
    }
    const cv = root.querySelector("canvas");
    if (cv) cv.style.width = "100%";
    if (libs.atl && libs.atl.redraw) {
      try { libs.atl.redraw(); } catch (e) {}
    }
    if (cv) cv.style.width = "100%";
  }
  function readAtl() {
    if (!libs.atl || libs.mute || libs.reading) return;
    libs.reading = true;
    try { readAtlNow(); } finally { libs.reading = false; }
  }
  function readAtlNow() {
    const model = libs.atl.getModel ? libs.atl.getModel() : null;
    if (!model || !model.rows) return;
    const before = window.LucielLayers.lyricStamp(state.lines, state.textStyle);
    const map = {};
    for (const kf of (model.rows[0] && model.rows[0].keyframes) || []) {
      const g = typeof kf.group === "string" ? kf.group : "";
      if (!g.startsWith("c:")) continue;
      (map[g] = map[g] || []).push(kf.val / 1000);
    }
    (state.clips || []).forEach((c, i) => {
      const vals = (map["c:" + c.id] || []).slice().sort((a, b) => a - b);
      if (vals.length < 2) return;
      const t0 = vals[0];
      const t1 = Math.max(t0 + 0.12, vals[1]);
      const span0 = c.t1 - c.t0;
      const span1 = t1 - t0;
      const base = { t0: c.t0, t1: c.t1, srcIn: c.srcIn || 0, speed: c.speed > 0 ? c.speed : 1 };
      if (Math.abs(span1 - span0) < 0.05 && Math.abs(t0 - c.t0) >= 0.02) {
        commitVideo({ op: "shift", index: i, dt: t0 - c.t0, inplace: true });
      } else if (Math.abs(t0 - c.t0) >= 0.02 && Math.abs(t1 - c.t1) < 0.05) {
        commitVideo({ op: "trim", index: i, edge: "left", dt: t0 - base.t0, inplace: true, base: base });
      } else if (Math.abs(t1 - c.t1) >= 0.02) {
        commitVideo({ op: "trim", index: i, edge: "right", dt: t1 - base.t1, inplace: true, base: base });
      }
    });
    const titles = {};
    for (const kf of (model.rows[1] && model.rows[1].keyframes) || []) {
      const g = typeof kf.group === "string" ? kf.group : "";
      if (!g.startsWith("o:")) continue;
      (titles[g] = titles[g] || []).push(kf.val / 1000);
    }
    let list = state.overlays || [];
    list.slice().forEach((o) => {
      const vals = (titles["o:" + o.id] || []).slice().sort((a, b) => a - b);
      if (vals.length < 2) return;
      const t0 = vals[0];
      const t1 = Math.max(t0 + 0.12, vals[1]);
      if (Math.abs(t0 - o.start) < 0.02 && Math.abs(t1 - o.end) < 0.02) return;
      list = window.LucielLayers.applyOverlayEdit(list, { op: "move", id: o.id, start: t0, end: t1 }, state.length || 20);
    });
    state.overlays = list;
    if (window.LucielLayers.lyricStamp(state.lines, state.textStyle) !== before) {
      throw new Error("video edit changed lyric text");
    }
    pushAtl();
    paintOverlayList();
    saveEditor();
    draw(state.t || 0);
  }
  function syncRegions() {
    if (!libs.regions) return;
    libs.mute = true;
    try {
      libs.regions.clearRegions();
      const dur = Math.max(0.2, state.length || libs.span || 20);
      (state.lines || []).forEach((ln, li) => {
        if (!ln.words || !ln.words.length) return;
        const a = Math.max(0, +ln.words[0].start || 0);
        const b = Math.max(a + 0.05, +ln.words[ln.words.length - 1].end || 0);
        libs.regions.addRegion({
          id: "L" + li,
          start: Math.max(0, Math.min(dur - 0.05, a)),
          end: Math.max(0.05, Math.min(dur, b)),
          content: ln.words.map((w) => w.text).join(" "),
          drag: true,
          resize: true,
          color: "rgba(32,180,220,0.28)",
        });
      });
      tuneRegionHandles();
    } catch (e) {}
    libs.mute = false;
  }
  function onRegionUpdated(region) {
    if (libs.mute || !region) return;
    const m = /^L(\d+)$/.exec(region.id || "");
    if (!m) return;
    const ln = state.lines[+m[1]];
    if (!ln || !ln.words || !ln.words.length) return;
    const ws = ln.words;
    const oldA = +ws[0].start;
    const oldB = +ws[ws.length - 1].end;
    const len = state.length || 20;
    const a = Math.max(0, region.start);
    const b = Math.min(len, Math.max(a + 0.05, region.end));
    if (Math.abs(a - oldA) < 0.02 && Math.abs(b - oldB) < 0.02) return;
    const span = Math.max(0.05, oldB - oldA);
    ws.forEach((w) => {
      const u0 = (+w.start - oldA) / span;
      const u1 = (+w.end - oldA) / span;
      w.start = +(a + (b - a) * u0).toFixed(3);
      w.end = +Math.max(w.start + 0.02, a + (b - a) * u1).toFixed(3);
    });
    paintLines();
    saveProject();
  }
  function commitOverlay(edit) {
    const before = window.LucielLayers.lyricStamp(state.lines, state.textStyle);
    state.overlays = window.LucielLayers.applyOverlayEdit(state.overlays, edit, state.length || 20);
    if (window.LucielLayers.lyricStamp(state.lines, state.textStyle) !== before) {
      throw new Error("video edit changed lyric text");
    }
    paintOverlayList();
    pushAtl();
    saveEditor();
    draw(state.t || 0);
  }
  function paintOverlayList() {
    const ul = $("#overlayList");
    if (!ul) return;
    ul.innerHTML = "";
    (state.overlays || []).forEach((o) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = o.text;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill";
      btn.textContent = "Remove";
      btn.addEventListener("click", () => commitOverlay({ op: "remove", id: o.id }));
      li.append(label, btn);
      ul.append(li);
    });
  }
  function paintLibFilm(cssW) {
    const cv = document.getElementById("film");
    if (!cv) return;
    const w = Math.max(48, Math.round(cssW));
    const h = 32;
    cv.width = w;
    cv.height = h;
    cv.style.width = w + "px";
    cv.style.height = h + "px";
    const ctx = cv.getContext("2d");
    const thumbs = state.thumbs && state.thumbs.length ? state.thumbs : syntheticThumbs();
    const tw = 34;
    const gap = 3;
    let i = 0;
    for (let x = 0; x < w; x += tw, i++) {
      const slice = Math.max(1, Math.min(tw - gap, w - x));
      ctx.drawImage(thumbs[i % thumbs.length], x, 0, slice, h);
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.fillRect(x + 2, 3 + (i % 4) * 4, 8, 3);
      if (x + slice < w) {
        ctx.fillStyle = "#07090c";
        ctx.fillRect(x + slice, 0, Math.min(gap, w - x - slice), h);
      }
    }
  }
  function layoutVidHandle() {
    const handle = document.getElementById("vidHandle");
    const canvas = document.getElementById("stage");
    const wrap = document.querySelector("#previewPin .stagewrap");
    if (!handle || !canvas || !wrap) return;
    const show = state.screen === "video";
    handle.hidden = !show;
    document.documentElement.dataset.handles = show ? "1" : "0";
    // A hidden target reports an empty box. updateRect then parks the
    // handles at the corner, and the next theme's audit sees them off-screen.
    if (!show) return;
    const cr = canvas.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    if (cr.width < 8 || cr.height < 8) return;
    const scale = Math.max(1, +state.vscale || 1);
    const w = cr.width * scale;
    const h = cr.height * scale;
    const vx = state.vx == null ? 0.5 : state.vx;
    const vy = state.vy == null ? 0.5 : state.vy;
    handle.style.left = ((cr.left - wr.left) + (cr.width - w) * vx) + "px";
    handle.style.top = ((cr.top - wr.top) + (cr.height - h) * vy) + "px";
    handle.style.width = w + "px";
    handle.style.height = h + "px";
    if (libs.mv) { try { libs.mv.updateRect(); } catch (e) {} }
    parkMoveableControls();
  }
  function refreshMoveable() {
    if (state.screen !== "video") return;
    layoutVidHandle();
    if (libs.mv) {
      try { libs.mv.destroy(); } catch (e) {}
      libs.mv = null;
    }
    document.querySelectorAll(".moveable-control-box").forEach((el) => el.remove());
    mountMoveable();
    layoutVidHandle();
  }
  function parkMoveableControls() {
    const vw = document.documentElement.clientWidth;
    const head = document.querySelector(".screen.on .screenhead h1");
    const minTop = head ? head.getBoundingClientRect().bottom + 1 : 0;
    document.querySelectorAll(".moveable-control").forEach((el) => {
      el.style.marginLeft = "-24px";
      el.style.marginTop = "-24px";
      const r = el.getBoundingClientRect();
      if (r.width < 1) return;
      let dx = 0;
      let dy = 0;
      if (r.left < 1) dx = 1 - r.left;
      else if (r.right > vw - 1) dx = (vw - 1) - r.right;
      if (r.top < minTop) dy = minTop - r.top;
      if (dx || dy) {
        el.style.marginLeft = (-24 + dx) + "px";
        el.style.marginTop = (-24 + dy) + "px";
      }
    });
  }
  function readVidHandle() {
    const handle = document.getElementById("vidHandle");
    const canvas = document.getElementById("stage");
    const wrap = document.querySelector("#previewPin .stagewrap");
    if (!handle || !canvas || !wrap) return;
    const cr = canvas.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const left = parseFloat(handle.style.left) || 0;
    const top = parseFloat(handle.style.top) || 0;
    const w = parseFloat(handle.style.width) || cr.width;
    const h = parseFloat(handle.style.height) || cr.height;
    const scale = Math.max(1, Math.min(2.5, w / Math.max(1, cr.width)));
    let vx = state.vx == null ? 0.5 : state.vx;
    let vy = state.vy == null ? 0.5 : state.vy;
    if (Math.abs(cr.width - w) > 1) vx = (left - (cr.left - wr.left)) / (cr.width - w);
    if (Math.abs(cr.height - h) > 1) vy = (top - (cr.top - wr.top)) / (cr.height - h);
    commitVideo({ op: "zoom", vscale: scale });
    commitVideo({ op: "pan", vx: vx, vy: vy });
    paintFrame();
    draw(state.t || 0);
  }
  function mountMoveable() {
    if (libs.mv || !window.Moveable) return;
    const wrap = document.querySelector("#previewPin .stagewrap");
    const handle = document.getElementById("vidHandle");
    if (!wrap || !handle) return;
    try {
      libs.mv = new Moveable(wrap, {
        target: handle,
        draggable: true,
        resizable: true,
        pinchable: true,
        origin: false,
        snappable: false,
        keepRatio: true,
        renderDirections: ["nw", "ne", "sw", "se", "w", "e"],
      });
    } catch (e) {
      libs.mv = null;
      return;
    }
    const pull = (e) => {
      const h = e.target;
      if (e.drag) {
        h.style.left = e.drag.left + "px";
        h.style.top = e.drag.top + "px";
      } else {
        if (e.left != null) h.style.left = e.left + "px";
        if (e.top != null) h.style.top = e.top + "px";
        if (e.width != null) h.style.width = e.width + "px";
        if (e.height != null) h.style.height = e.height + "px";
      }
      h.style.transform = "";
      readVidHandle();
    };
    libs.mv.on("drag", pull);
    libs.mv.on("resize", pull);
    libs.mv.on("pinchStart", () => { libs.pinchBase = state.vscale || 1; });
    libs.mv.on("pinch", (e) => {
      const scale = e && e.scale ? e.scale : 1;
      commitVideo({ op: "zoom", vscale: libs.pinchBase * scale });
      layoutVidHandle();
      paintFrame();
      draw(state.t || 0);
    });
    libs.mv.on("dragEnd", () => saveEditor());
    libs.mv.on("resizeEnd", () => saveEditor());
    libs.mv.on("pinchEnd", () => saveEditor());
  }
  function mountSyncWave() {
    const box = document.getElementById("syncWsBox");
    if (!box || !window.WaveSurfer || !window.WaveSurfer.Regions || !window.WaveSurfer.Timeline) return;
    if (box.clientWidth < 20) return;
    const span = Math.max(1, state.length || 20);
    if (libs.ws && Math.abs((libs.waveSpan || 0) - span) < 0.2) {
      syncRegions();
      if (regionHandles().length >= 2) settleSync();
      return;
    }
    if (libs.ws) {
      try { libs.ws.destroy(); } catch (e) {}
      libs.ws = null;
      libs.regions = null;
    }
    if (libs.url) {
      try { URL.revokeObjectURL(libs.url); } catch (e) {}
      libs.url = "";
    }
    libs.syncSettled = false;
    try {
      const regions = WaveSurfer.Regions.create();
      libs.regions = regions;
      libs.waveSpan = span;
      libs.url = URL.createObjectURL(silentWav(span));
      const pps = Math.max(8, (box.clientWidth - 8) / span);
      libs.ws = WaveSurfer.create({
        container: box,
        url: libs.url,
        peaks: [sectionPeaks()],
        duration: span,
        height: 48,
        minPxPerSec: pps,
        fillParent: true,
        hideScrollbar: true,
        autoCenter: false,
        autoScroll: false,
        interact: false,
        cursorWidth: 0,
        waveColor: cssVar("--wave-on", "#1aa9d6"),
        progressColor: cssVar("--wave-on", "#1aa9d6"),
        plugins: [regions, WaveSurfer.Timeline.create({ container: "#syncWsTime", height: 20 })],
      });
      regions.on("region-updated", onRegionUpdated);
      const finish = () => {
        try { libs.ws.zoom(pps); } catch (e) {}
        syncRegions();
        settleSync();
      };
      libs.ws.on("ready", finish);
      libs.ws.on("error", () => {});
    } catch (e) {
      libs.ws = null;
      return;
    }
  }
  function mountVideoLibs(span) {
    const atlEl = document.getElementById("atl");
    if (!atlEl || !window.timelineModule) return;
    if (atlEl.clientWidth < 20 && !(document.getElementById("tlview") && document.getElementById("tlview").clientWidth > 20)) return;
    if (!libs.atl) {
      try {
        libs.atl = new timelineModule.Timeline({
          id: atlEl,
          snapEnabled: true,
          snapStep: 100,
          min: 0,
          max: Math.max(1000, span * 1000),
          stepPx: state.pxPerSec || 46,
          stepVal: 1000,
          leftMargin: 0,
          headerHeight: 18,
          rowsStyle: { height: 32, marginBottom: 0, groupsStyle: { fillColor: "#1aa9d6" } },
        });
        libs.atl.onDragFinished(() => { if (!libs.mute) readAtl(); });
        lockAtlScroll();
      } catch (e) {
        libs.atl = null;
      }
    }
    mountMoveable();
    libs.ready = !!libs.atl;
    libs.span = span;
    if (libs.ready) document.documentElement.dataset.editor = "libs";
    else document.documentElement.removeAttribute("data-editor");
    settleEditor();
  }
  function layoutLibs(origin, cssW, pps, span) {
    const host = document.getElementById("librows");
    if (host) {
      host.style.left = origin + "px";
      host.style.width = cssW + "px";
    }
    paintLibFilm(cssW);
    pushAtl();
    lockAtlScroll();
    libs.span = span;
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
    mountVideoLibs(span);
    if (libs.ready) layoutLibs(origin, cssW, pps, span);
    else {
      paintRuler(origin, span, pps);
      paintVideoTrack(origin, cssW, pps);
      const cv = $("#tl");
      if (cv) {
        cv.style.position = "absolute";
        cv.style.left = origin + "px";
        cv.style.bottom = "0";
        cv.style.top = "auto";
      }
      paintTimeline();
    }
    const input = $("#lyricInput");
    if (input) input.hidden = true;
    layoutVidHandle();
    paintOverlayList();
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
  function syntheticThumbs() {
    if (syntheticThumbs.cache) return syntheticThumbs.cache;
    const colors = ["#8d1d2c", "#c23b22", "#d4782a", "#1f6f8b", "#2a4f8f", "#3d2a55"];
    syntheticThumbs.cache = colors.map((color, i) => {
      const c = document.createElement("canvas");
      c.width = 48;
      c.height = 64;
      const ctx = c.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 48, 64);
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.fillRect(6, 8 + (i % 3) * 10, 22 + (i % 2) * 8, 14);
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(0, 52, 48, 12);
      return c;
    });
    return syntheticThumbs.cache;
  }
  function paintFilm(canvas, clip) {
    const pps = state.pxPerSec || 46;
    const w = Math.max(48, Math.round((clip.t1 - clip.t0) * pps));
    const h = 36;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const thumbs = state.thumbs && state.thumbs.length ? state.thumbs : syntheticThumbs();
    const tw = 34;
    const gap = 3;
    let i = 0;
    for (let x = 0; x < w; x += tw, i++) {
      const slice = Math.max(1, Math.min(tw - gap, w - x));
      ctx.drawImage(thumbs[i % thumbs.length], x, 0, slice, h);
      ctx.fillStyle = "rgba(255,255,255,.8)";
      ctx.fillRect(x + 2, 3 + (i % 4) * 4, 8, 3);
      if (x + slice < w) {
        ctx.fillStyle = "#07090c";
        ctx.fillRect(x + slice, 0, Math.min(gap, w - x - slice), h);
      }
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
        const guard = window.LLLayers
          ? LLLayers.textFingerprint(state.lines, state.colorOv || {})
          : JSON.stringify(state.lines);
        return {
          x0: e.clientX,
          mode: handle ? (handle.classList.contains("left") ? "left" : "right") : "slip",
          t0: clip.t0,
          t1: clip.t1,
          src0: clip.srcIn || 0,
          speed: clip.speed > 0 ? clip.speed : 1,
          guard: guard,
          lines: JSON.stringify(state.lines),
          style: JSON.stringify(state.colorOv || {}),
        };
      }, (drag, dt) => {
        commitVideo({
          op: "trim",
          index: i,
          edge: drag.mode,
          dt: dt,
          inplace: true,
          base: { t0: drag.t0, t1: drag.t1, srcIn: drag.src0, speed: drag.speed },
        });
        if (drag.mode === "left") state.t = clip.t0;
        else if (drag.mode === "right") state.t = clip.t1;
        el.style.left = (origin + clip.t0 * pps) + "px";
        el.style.width = Math.max(44, (clip.t1 - clip.t0) * pps) + "px";
        name.textContent = (state.videoName || "Clip") + " · " + (clip.srcIn || 0).toFixed(1) + "s";
        if (JSON.stringify(state.lines) !== drag.lines) state.lines = JSON.parse(drag.lines);
        if (JSON.stringify(state.colorOv || {}) !== drag.style) state.colorOv = JSON.parse(drag.style || "{}");
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
      el.className = "lblock" + (state.selectedLine === i ? " on" : "") + (ln.low_confidence ? " low" : "");
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
        if (!LS().scaleLine(words, drag.snap, drag.mode, dt, state.length || 20)) return;
        moved = true;
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
      paintOverlays(t, rs.cv);
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
    const checks = { bgvideo: 0, split: 0, trim: 0, lyricdrag: 0, renderframes: 0, layers: 0 };
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
      const styleSnap = { posY: 0.62, size: 0.08, color: "#ffffff" };
      const linesSnap = JSON.stringify(state.lines);
      const fp = window.LLLayers ? LLLayers.textFingerprint(state.lines, styleSnap) : linesSnap;
      let video = { clips: state.clips.map((c) => Object.assign({}, c)), place: window.LLLayers ? LLLayers.defaultPlace() : null, aspect: "9:16", overlays: [] };
      const edits = [
        { op: "trim", index: 0, edge: "out", delta: -0.4 },
        { op: "move", index: 0, start: 0.2 },
        { op: "scale", scale: 1.2 },
        { op: "position", x: 0.4, y: 0.6 },
        { op: "fit", fit: "fit" },
        { op: "fit", fit: "crop" },
        { op: "aspect", aspect: "1:1" },
        { op: "aspect", aspect: "16:9" },
        { op: "aspect", aspect: "4:5" },
        { op: "scale", scale: 0.8 },
      ];
      if (window.LLLayers) {
        edits.forEach((edit) => { video = LLLayers.applyVideoEdit(video, edit); });
        checks.layers = LLLayers.textFingerprint(state.lines, styleSnap) === fp && JSON.stringify(state.lines) === linesSnap ? 1 : 0;
      }
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
    paintFrame();
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
      if (screen === "sync" || screen === "syncshot" || screen === "sheet") await whenSync();
      if (screen === "video") await whenEditor();
      fitAll();
      const msg = measure(screen);
      document.documentElement.dataset.scroll = String((document.scrollingElement || document.documentElement).scrollTop);
      window.__audits.push(msg);
      document.documentElement.dataset.audit = msg;
      if (demo !== "audit") {
        if (screen === "video") frameUnderPin(document.querySelector("#screen-video .editorcard"));
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
        for (const sc of ["track", "sync", "video", "look", "time", "render"]) {
          show(sc);
          if (sc === "look" || sc === "time" || sc === "render" || sc === "sync" || sc === "video") draw(1.35);
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
    if (demo === "intro" || demo === "intro2" || demo === "intro3") {
      theme(document.documentElement.dataset.theme || "aero");
      showIntro(demo);
      await publish(demo);
      return;
    }
    if (demo === "sheet") {
      theme(document.documentElement.dataset.theme || "aero");
      show("sync");
      state.selectedLine = 0;
      state.selectedWord = 0;
      draw(state.t > 0.05 ? state.t : 1.2);
      openSheet();
      await publish("sheet");
      return;
    }
    if (demo === "home") {
      try {
        localStorage.setItem("lc-project", JSON.stringify({
          lyrics: "Saved line", audioName: "Saved song",
          lines: [{ words: [{ text: "Saved", start: 0.2, end: 0.6 }] }],
        }));
      } catch (e) {}
      theme(document.documentElement.dataset.theme || "aero");
      show("home");
      await publish("home");
      return;
    }
    if (!demo) {
      theme(document.documentElement.dataset.theme || "aero");
      if (!localStorage.getItem("lc-seen-intro")) showIntro("intro");
      else show("home");
      return;
    }
    theme(document.documentElement.dataset.theme || "aero");
    const screen = ["track", "sync", "video", "look", "time", "render"].includes(demo) ? demo : "track";
    show(screen);
    if (screen === "look" || screen === "time" || screen === "render" || screen === "video" || screen === "sync") draw(state.t > 0.05 ? state.t : 1.35);
    await publish(screen);
    if (window.Luciel && Luciel.info) {
      try {
        const info = JSON.parse(Luciel.info());
        if (info.tier === "accurate" || info.tier === "fast") state.tier = info.tier;
        paintTier();
        paintFrame();
        if (info.model) $("#modelText").textContent = "Listening is saved on this phone.";
      } catch (e) {}
    } else if (!demo) {
      $("#trackHint").textContent = "Open this page in the Luciel Lyric app to pick a song.";
    }
  }

  $("#editText").onclick = () => {
    if (state.selectedLine < 0) state.selectedLine = 0;
    openSheet();
    const words = $("#sheetWords");
    if (words) words.focus();
  };
  $("#sheetClose").onclick = () => closeSheet();
  $("#undoText").onclick = () => undoText();
  $("#redoText").onclick = () => redoText();
  $("#fontPick").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setStyleKey("font", b.dataset.font);
    undoArmed = false;
  };
  $("#alignPick").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setStyleKey("align", b.dataset.align);
    undoArmed = false;
  };
  $("#scopePick").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.textScope = b.dataset.scope === "line" ? "line" : "all";
    if (state.textScope === "line" && state.selectedLine < 0 && state.lines.length) state.selectedLine = 0;
    paintSheet();
  };
  $("#swatches").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const hex = b.dataset.color;
    armUndo();
    if (state.textScope === "line" && state.lines[state.selectedLine]) {
      state.lines[state.selectedLine].style = Object.assign({}, state.lines[state.selectedLine].style, { color: hex, active: hex, sung: hex });
    } else {
      state.textStyle = Object.assign({}, state.textStyle || {}, { color: hex, active: hex, sung: hex });
      state.colorOv = Object.assign({}, state.colorOv || {}, { color: hex, active: hex, sung: hex });
      state.lines.forEach((ln) => {
        if (!ln || !ln.style) return;
        delete ln.style.color;
        delete ln.style.active;
        delete ln.style.sung;
      });
    }
    undoArmed = false;
    syncColors();
    draw(state.t || 1);
    paintSheet();
    saveProject();
  };
  function styleSlider(id, apply) {
    const el = $(id);
    if (!el) return;
    el.addEventListener("pointerdown", () => armUndo());
    el.addEventListener("input", () => apply(+el.value));
    el.addEventListener("pointerup", () => { undoArmed = false; });
    el.addEventListener("change", () => { undoArmed = false; });
  }
  styleSlider("#textSize", (n) => setStyleKey("size", n));
  styleSlider("#outlineAmt", (n) => {
    setStyleKey("strokeWidth", n);
    if (n > 0) setStyleKey("strokeColor", "#102028");
  });
  styleSlider("#shadowAmt", (n) => {
    setStyleKey("shadowAlpha", n);
    setStyleKey("shadowBlur", n > 0 ? 0.06 : 0);
    setStyleKey("shadowY", n > 0 ? 0.04 : 0);
    setStyleKey("shadowColor", "#102028");
  });
  $("#nudgeBack").onclick = () => nudgeLineTime(-0.1);
  $("#nudgeFwd").onclick = () => nudgeLineTime(0.1);
  $("#splitLine").onclick = () => splitSelectedLine();
  $("#mergeLine").onclick = () => mergeSelectedLine();
  $("#savePreset").onclick = () => saveTextPreset();
  $("#sheetWords").addEventListener("focus", () => armUndo());
  $("#sheetWords").addEventListener("input", () => {
    armUndo();
    const i = state.selectedLine;
    if (i < 0 || !state.lines[i]) return;
    if (!editLineText(state.lines[i], $("#sheetWords").value)) return;
    const edit = document.querySelectorAll("#lineList .lineedit")[i];
    if (edit && document.activeElement !== edit) edit.textContent = lineText(state.lines[i]);
    draw(state.t || 1);
  });
  $("#sheetWords").addEventListener("blur", () => {
    undoArmed = false;
    writeLyrics(state.lines.map(lineText).join("\n"));
  });
  const stageCv = $("#stage");
  let wordDrag = null;
  stageCv.addEventListener("pointerdown", (e) => {
    if (state.screen === "video") return;
    wordDrag = { x: e.clientX, y: e.clientY, moved: false };
  });
  stageCv.addEventListener("pointermove", (e) => {
    if (!wordDrag) return;
    const dx = e.clientX - wordDrag.x;
    const dy = e.clientY - wordDrag.y;
    if (!wordDrag.moved && Math.hypot(dx, dy) < 8) return;
    if (!wordDrag.moved) { wordDrag.moved = true; armUndo(); }
    const r = stageCv.getBoundingClientRect();
    const s = effectiveStyle();
    const posX = (s.posX == null ? 0.5 : +s.posX) + dx / Math.max(1, r.width);
    const posY = (s.posY == null ? 0.47 : +s.posY) + dy / Math.max(1, r.height);
    wordDrag.x = e.clientX;
    wordDrag.y = e.clientY;
    setStyleKey("posX", Math.max(0.12, Math.min(0.88, posX)));
    setStyleKey("posY", Math.max(0.18, Math.min(0.86, posY)));
  });
  const endWordDrag = (e) => {
    if (!wordDrag) return;
    const moved = wordDrag.moved;
    wordDrag = null;
    undoArmed = false;
    if (moved) return;
    const hit = hitPreviewWord(e);
    if (!hit) return;
    state.selectedLine = hit.line;
    state.selectedWord = hit.word;
    openSheet();
    const row = document.querySelectorAll("#lineList li")[hit.line];
    const chip = row && row.querySelectorAll(".wordchip")[hit.word];
    if (chip) chip.focus();
  };
  stageCv.addEventListener("pointerup", endWordDrag);
  stageCv.addEventListener("pointercancel", () => { wordDrag = null; undoArmed = false; });
  $("#dock").onclick = (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.screen); };
  $("#stepper").onclick = (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.screen); };
  $("#changeAudio").onclick = () => { if (window.Luciel) Luciel.pickAudio(); };
  $("#introNext").onclick = () => {
    const page = state.introPage || 1;
    if (page >= 3) {
      try { localStorage.setItem("lc-seen-intro", "1"); } catch (e) {}
      show("home");
    } else showIntro(page === 1 ? "intro2" : "intro3");
  };
  $("#introSkip").onclick = () => {
    try { localStorage.setItem("lc-seen-intro", "1"); } catch (e) {}
    show("home");
  };
  $("#startNew").onclick = () => startNewProject();
  $("#continueProject").onclick = () => {
    if (!hasProject()) return;
    loadEditor();
    loadProject();
    const next = STEP_ORDER.find((id) => !stepDone(id)) || "render";
    show(stepOpen(next) ? next : "track");
  };
  document.querySelectorAll(".stepnext").forEach((btn) => {
    btn.onclick = () => {
      if (btn.disabled) return;
      const next = btn.dataset.next;
      if (next) show(next);
      else if (window.Luciel && Luciel.share) Luciel.share();
    };
  });
  window.addEventListener("pagehide", () => { writeProject(); });
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
    if (state.screen === "video") paintEditor();
    if (state.screen === "sync") mountSyncWave();
  };
  $("#title").oninput = () => { state.title = $("#title").value; draw(state.t || 1.2); };
  $("#artist").oninput = () => { state.artist = $("#artist").value; draw(state.t || 1.2); };
  $("#lyrics").addEventListener("input", () => {
    const sync = LS();
    const text = $("#lyrics").value;
    const clip = state.length || 20;
    if (!text.trim()) {
      state.lines = [];
      state.synced = false;
      paintLines();
      paintFlow();
      draw(state.t || 1.2);
      $("#syncStatus").textContent = "Lyrics cleared.";
      saveProject();
      return;
    }
    if (syncReady()) {
      state.lines = sync.applyLockedLines(state.lines, text);
      $("#syncStatus").textContent = "Timings stayed locked.";
    } else if (state.hyp && state.hyp.length) {
      const res = sync.alignLyrics(text, state.hyp, clip);
      if (res.lines && res.lines.length) {
        state.lines = res.lines;
        state.synced = !res.error;
        const low = res.lines.filter((ln) => ln.low_confidence).length;
        $("#syncStatus").textContent = low
          ? low + (low === 1 ? " line needs" : " lines need") + " a look. Tap Mark to fix them."
          : state.lines.length + " lines ready.";
      } else {
        state.lines = sync.linesFromText(text, clip);
        state.synced = false;
        $("#syncStatus").textContent = res.error || "Couldn't match these lyrics.";
      }
    } else {
      state.lines = sync.linesFromText(text, clip);
      state.synced = false;
      $("#syncStatus").textContent = state.lines.length + " lines from your lyrics.";
    }
    paintLines();
    syncRegions();
    paintFlow();
    saveProject();
    draw(state.t || 1.2);
  });
  $("#playClip").onclick = () => { mascot("music"); play(false); };
  $("#previewBtn").onclick = () => { togglePreview(); };
  $("#previewToggle").onclick = () => { togglePreview(); };
  $("#pickAudio").onclick = () => { if (window.Luciel) Luciel.pickAudio(); else $("#trackHint").textContent = "Song picking runs in the Android app."; };
  $("#uploadVideo").onclick = () => { requestVideo(); };
  $("#removeVideo").onclick = () => { removeClip(); };
  $("#tlSplit").onclick = () => { if (splitAt(state.t)) paintEditor(); };
  $("#tlDelete").onclick = () => { deleteClip(); };
  $("#tlAdd").onclick = () => { addClip(); };
  $("#tlReplace").onclick = () => { requestVideo(); };
  $("#tlSpeed").onclick = () => { cycleSpeed(); };
  $("#addOverlay").onclick = () => {
    const text = ($("#overlayText").value || "").trim();
    if (!text) return;
    const len = state.length || 20;
    const start = Math.max(0, Math.min(len - 0.5, state.t || 0));
    commitOverlay({
      op: "add",
      id: state.nextOverlayId++,
      text: text,
      start: start,
      end: Math.min(len, start + 3),
    });
    $("#overlayText").value = "";
  };
  $("#lyricInput").addEventListener("change", () => { commitLyricInput(); });
  $("#lyricInput").addEventListener("input", () => { commitLyricInput(); });
  $("#fontBtn").onclick = () => { if (window.Luciel) Luciel.pickFont(); };
  function paintTier() {
    document.querySelectorAll("#modelTier button").forEach((b) => b.classList.toggle("on", b.dataset.tier === state.tier));
  }
  function paintFrame() {
    document.querySelectorAll("#aspects button").forEach((b) => b.classList.toggle("on", b.dataset.aspect === state.aspect));
    document.querySelectorAll("#vfit button").forEach((b) => b.classList.toggle("on", b.dataset.fit === state.vfit));
    const scale = $("#vscale");
    const vx = $("#vx");
    const vy = $("#vy");
    if (scale) scale.value = String(state.vscale || 1);
    if (vx) vx.value = String(state.vx == null ? 0.5 : state.vx);
    if (vy) vy.value = String(state.vy == null ? 0.5 : state.vy);
    const sv = $("#vscaleVal");
    const xv = $("#vxVal");
    const yv = $("#vyVal");
    if (sv) sv.textContent = (+state.vscale || 1).toFixed(1) + "×";
    if (xv) xv.textContent = placeWord("x", state.vx == null ? 0.5 : state.vx);
    if (yv) yv.textContent = placeWord("y", state.vy == null ? 0.5 : state.vy);
  }
  const tapMarks = [];
  function b64ToF32(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }
  function ensureTapLines() {
    if (state.lines && state.lines.length) return true;
    const text = $("#lyrics").value.trim();
    if (!text) return false;
    state.lines = LS().linesFromText(text, state.length || 20);
    state.lines.forEach((ln) => { ln.low_confidence = true; ln.confidence = 0; });
    paintLines();
    return true;
  }
  function applyTapMarks() {
    const len = state.length || 20;
    state.lines.forEach((ln, i) => {
      const words = ln.words || [];
      if (!words.length || i >= tapMarks.length) return;
      const start = tapMarks[i];
      const next = i + 1 < tapMarks.length ? tapMarks[i + 1] : Math.min(len, start + Math.max(0.35, 0.28 * words.length));
      LS().tapLine(words, start, next, len);
      ln.low_confidence = false;
      ln.confidence = 1;
    });
    paintLines();
    syncRegions();
    draw(state.t || 0);
    const now = $("#tapNow");
    if (now) now.textContent = "Marked " + tapMarks.length + "/" + state.lines.length;
  }
  $("#modelTier").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.tier = b.dataset.tier === "accurate" ? "accurate" : "fast";
    paintTier();
    if (window.Luciel && Luciel.setTier) Luciel.setTier(state.tier);
    $("#modelText").textContent = state.tier === "accurate"
      ? "Clearer hears more of the singing. About 190 MB, saved once."
      : "Quick is the smaller listener. About 75 MB, saved once.";
  };
  $("#aspects").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    commitVideo({ op: "aspect", aspect: b.dataset.aspect });
    paintFrame();
    saveEditor();
    sizePreview();
    layoutVidHandle();
    draw(state.t || 1);
    updatePreviewChrome();
  };
  $("#vfit").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    commitVideo({ op: "fit", fit: b.dataset.fit });
    paintFrame();
    saveEditor();
    layoutVidHandle();
    draw(state.t || 1);
  };
  $("#vscale").oninput = () => {
    commitVideo({ op: "zoom", vscale: +$("#vscale").value });
    paintFrame();
    saveEditor();
    layoutVidHandle();
    draw(state.t || 1);
  };
  $("#vx").oninput = () => {
    commitVideo({ op: "pan", vx: +$("#vx").value });
    paintFrame();
    saveEditor();
    layoutVidHandle();
    draw(state.t || 1);
  };
  $("#vy").oninput = () => {
    commitVideo({ op: "pan", vy: +$("#vy").value });
    paintFrame();
    saveEditor();
    layoutVidHandle();
    draw(state.t || 1);
  };
  $("#tapHear").onclick = () => {
    tapMarks.length = 0;
    if (!ensureTapLines()) { $("#tapNow").textContent = "Paste the lyrics first."; return; }
    $("#tapNow").textContent = "Tap Mark as each line starts.";
    play(false);
  };
  $("#tapMark").onclick = () => {
    if (!ensureTapLines()) { $("#tapNow").textContent = "Paste the lyrics first."; return; }
    const t = Math.max(0, state.t || 0);
    if (tapMarks.length && t < tapMarks[tapMarks.length - 1]) return;
    if (tapMarks.length >= state.lines.length) return;
    tapMarks.push(Math.round(t * 1000) / 1000);
    applyTapMarks();
  };
  $("#getModel").onclick = () => {
    if (window.Luciel) { $("#modelText").textContent = "Saving the listener…"; Luciel.downloadModel(state.tier); }
    else $("#modelText").textContent = "The listener saves inside the Android app.";
  };
  $("#syncBtn").onclick = () => {
    if (syncReady() && !window.confirm("Re-sync replaces the locked word timings. Continue?")) return;
    if (!window.Luciel) { applyWords(DEMO.flatMap((l) => l.words)); return; }
    let info = {};
    try { info = JSON.parse(Luciel.info()); } catch (e) {}
    const lyrics = $("#lyrics").value.trim();
    if (lyrics && Luciel.alignLyrics) {
      mascot("confused");
      $("#syncStatus").textContent = info.aligner ? "Lining up the words…" : "Saving the line-up file, then matching the words…";
      Luciel.alignLyrics(state.start, state.length, lyrics);
      return;
    }
    if (!info.whisper) {
      $("#syncStatus").textContent = "Listening isn't in this build.";
      mascot("crying");
      return;
    }
    if (!info.model) {
      $("#syncStatus").textContent = "The listener isn't on this phone yet. Saving it now. Tap Line up lyrics when it finishes.";
      $("#modelText").textContent = "Saving the listener…";
      mascot("confused");
      Luciel.downloadModel(state.tier);
      return;
    }
    mascot("confused");
    $("#syncStatus").textContent = "Listening to this part…";
    Luciel.transcribe(state.start, state.length, lyrics);
  };
  $("#bgModes").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.bg = b.dataset.bg;
    document.querySelectorAll("#bgModes button").forEach((x) => x.classList.toggle("on", x === b));
    if (state.bg === "video" && !state.videoEl) {
      const status = $("#clipStatus");
      if (status && !state.videoName) status.textContent = "Upload the MP4 on Video.";
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
  const stageWrap = document.querySelector("#previewPin .stagewrap");
  if (stageWrap) {
    const vidPointers = new Map();
    let vidBase = 0;
    let vidScale0 = 1;
    stageWrap.addEventListener("pointerdown", (e) => {
      if (state.screen !== "video") return;
      if (e.target.closest && (e.target.closest("#vidHandle") || e.target.closest(".moveable-control"))) return;
      vidPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (vidPointers.size === 2) vidScale0 = state.vscale || 1;
    });
    stageWrap.addEventListener("pointermove", (e) => {
      if (state.screen !== "video") return;
      if (!vidPointers.has(e.pointerId)) return;
      vidPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (vidPointers.size < 2) return;
      const pts = [...vidPointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (!vidBase) { vidBase = dist; return; }
      const ratio = dist / vidBase;
      if (Math.abs(ratio - 1) < 0.03) return;
      commitVideo({ op: "zoom", vscale: vidScale0 * ratio });
      layoutVidHandle();
      paintFrame();
      draw(state.t || 0);
    });
    const endVid = (e) => {
      vidPointers.delete(e.pointerId);
      if (vidPointers.size < 2) {
        if (vidBase) saveEditor();
        vidBase = 0;
      }
    };
    stageWrap.addEventListener("pointerup", endVid);
    stageWrap.addEventListener("pointercancel", endVid);
  }
  $("#renderBtn").onclick = () => render();
  $("#shareBtn").onclick = () => { if (window.Luciel) Luciel.share(); };

  async function render() {
    if (!window.Luciel) { $("#renderStatus").textContent = "Rendering runs in the Android app."; return; }
    const q = QUALITY[state.quality];
    const out = outputSize(q);
    mascot("music");
    $("#renderStatus").textContent = "Drawing frames…";
    $("#shareBtn").hidden = true;
    const started = Luciel.beginRender(JSON.stringify({
      width: out.w, height: out.h, fps: q.fps, bitrate: q.bitrate, start: state.start, length: state.length,
    }));
    if (started && started !== "ok") { $("#renderStatus").textContent = started; mascot("crying"); return; }
    const canvas = document.createElement("canvas");
    const rs = new LLStage.Stage(canvas);
    rs.setSize(out.w, out.h, out.w);
    const slice = audioSlice();
    if (slice) rs.setAudio(slice, 8000);
    const frames = Math.round(state.length * q.fps);
    const rowBytes = out.w * 4;
    const rows = Math.max(8, Math.min(32, Math.floor(180000 / rowBytes)));
    for (let f = 0; f < frames; f++) {
      const t = f / q.fps;
      const src = sourceAt(t);
      if (state.videoEl && state.bg === "video" && src) {
        if (Math.abs((state.videoEl.currentTime || 0) - src.in) > 0.05) {
          await seekTo(state.videoEl, src.in);
        }
      }
      rs.setScene(scene(t, out));
      rs.drawFrame(t);
      paintOverlays(t, rs.cv);
      const data = rs.cv.getContext("2d").getImageData(0, 0, out.w, out.h).data;
      for (let y = 0; y < out.h; y += rows) {
        const rh = Math.min(rows, out.h - y);
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
    lyricStamp() {
      return window.LucielLayers.lyricStamp(state.lines, state.textStyle);
    },
    back() {
      const order = ["track", "sync", "video", "look", "time", "render"];
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
        state.audioReady = true;
        state.audioName = (msg.name || "song") + " · " + state.duration.toFixed(1) + "s";
        $("#trackName").textContent = state.audioName;
        paintFlow();
        $("#start").max = String(Math.max(0, state.duration - state.length));
        $("#trackHint").textContent = "Drag the part you want. Listening uses only those seconds.";
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
          $("#modelText").textContent = "Listening is saved on this phone.";
          const status = $("#syncStatus").textContent;
          if (status.indexOf("Saving") >= 0 || status.indexOf("isn't on this phone") >= 0) {
            $("#syncStatus").textContent = syncReady() ? "Listening is ready." : "Listening is ready. Tap Line up lyrics.";
          }
          mascot("happy");
        }
        else $("#modelText").textContent = "Saving… " + Math.round((msg.progress || 0) * 100) + "%";
      } else if (msg.type === "sync" && msg.phase === "logits") {
        const flat = b64ToF32(msg.logits || "");
        const res = LS().alignFromLogits(flat, msg.frames, msg.duration || state.length, $("#lyrics").value);
        state.hyp = res.words || [];
        if (!res.lines || !res.lines.length) {
          $("#syncStatus").textContent = res.error || "Couldn't align these lyrics.";
          mascot("crying");
        } else {
          state.lines = res.lines;
          state.synced = true;
          paintLines();
          paintFlow();
          const low = res.lines.filter((ln) => ln.low_confidence).length;
          $("#syncStatus").textContent = low
            ? low + (low === 1 ? " line needs" : " lines need") + " a look. Tap Mark to fix them."
            : res.lines.length + " lines aligned.";
          mascot(res.ok && !low ? "happy" : "confused");
          if (!low) show("video");
          draw(Math.min(1.2, Math.max(0.2, state.length - 0.05)));
        }
      } else if (msg.type === "sync" && msg.phase === "words") {
        const words = msg.words.map((w) => ({ text: w.text, start: w.start, end: w.end, confidence: w.confidence }));
        applyWords(words);
      } else if (msg.type === "sync" && msg.error) {
        const lyrics = $("#lyrics").value.trim();
        if (lyrics && window.Luciel && Luciel.transcribe && /align/i.test(msg.error || "")) {
          $("#syncStatus").textContent = "Line-up file unavailable. Matching the words that were heard…";
          Luciel.transcribe(state.start, state.length, lyrics);
        } else {
          $("#syncStatus").textContent = msg.error; mascot("crying");
        }
      } else if (msg.type === "sync" && msg.phase === "download") {
        $("#syncStatus").textContent = "Saving the line-up file…";
      } else if (msg.type === "sync" && msg.phase === "align") {
        $("#syncStatus").textContent = "Lining up the words…";
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
