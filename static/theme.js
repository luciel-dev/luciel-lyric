/* Theme picker, step tracker, LCD "now playing" readout and mini spectrum (all themes). */
(() => {
  const root = document.documentElement;
  const KEY = 'lc-theme', THEMES = ['aero', 'y2k', 'winamp'];
  function setTheme(t) {
    if (!THEMES.includes(t)) t = 'aero';
    root.dataset.theme = t;
    try { localStorage.setItem(KEY, t); } catch (e) {}
    document.querySelectorAll('#themePick button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.theme === t)));
    // fonts may still be loading: redraw canvases once they are ready
    window.dispatchEvent(new CustomEvent('lc:theme', {detail: t}));
    document.fonts && document.fonts.ready.then(() => window.dispatchEvent(new CustomEvent('lc:theme', {detail: t})));
  }
  document.querySelectorAll('#themePick button').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.theme)));
  setTheme(root.dataset.theme);
  window.LCTheme = {set: setTheme, get: () => root.dataset.theme};

  // ---- step tracker ----
  const done = {1: false, 2: false, 3: false, 4: false, 5: false};
  function refreshSteps() {
    const cur = window.LCFlow ? LCFlow.step() : 1;
    if (window.LCFlow) {
      done[1] = LCFlow.ready(1);
      done[2] = LCFlow.ready(2);
      done[3] = LCFlow.ready(3);
      done[4] = LCFlow.ready(4);
    }
    document.querySelectorAll('#stepper a').forEach(a => {
      const n = +a.dataset.step;
      a.classList.toggle('done', !!done[n] && n !== cur);
      a.classList.toggle('active', n === cur);
      const prevOk = n === 1 || done[n - 1] || n <= cur;
      a.classList.toggle('locked', !prevOk);
    });
  }
  addEventListener('lc:audio', () => { done[1] = true; refreshSteps(); });
  addEventListener('lc:sync-done', () => { done[2] = true; done[4] = true; setTimeout(refreshSteps, 0); });
  addEventListener('lc:render-done', () => { done[5] = true; refreshSteps(); });
  window.LCTheme.refresh = refreshSteps;
  refreshSteps();

  // ---- LCD readout ----
  const lcd = document.getElementById('lcd'), audioEl = document.getElementById('audio');
  const pad = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
  function lcdText() {
    if (typeof S === 'undefined' || !S.audio) return;
    const name = (S.audio.name || 'track').replace(/\.[^.]+$/, '');
    document.getElementById('lcdTitle').textContent =
      `${name.toUpperCase()}  ***  CLIP ${pad(S.start)} - ${pad(Math.min(S.audio.duration, S.start + S.len))} (${S.len}s)  ***  LUCIEL LYRIC`;
    document.getElementById('lcdKbps').textContent = pad(S.audio.duration).replace(/\.\d$/, '') + ' total';
    document.getElementById('lcdClip').textContent = `clip ${S.len}s`;
  }
  function lcdTick() {
    if (typeof S === 'undefined' || !S.audio) return;
    const playing = !audioEl.paused;
    document.getElementById('lcdTime').textContent = pad(playing ? audioEl.currentTime - S.start : S.start);
    document.getElementById('lcdState').textContent = playing ? '▶' : '■';
    lcd.classList.toggle('playing', playing);
  }
  addEventListener('lc:audio', () => { lcd.classList.add('on'); lcdText(); lcdTick(); });
  ['#startIn', '#lenIn'].forEach(s => document.querySelector(s).addEventListener('input', () => { lcdText(); lcdTick(); }));
  document.getElementById('startIn').addEventListener('change', () => { lcdText(); lcdTick(); });
  document.getElementById('wave').addEventListener('mouseup', () => setTimeout(() => { lcdText(); lcdTick(); }, 0));
  setInterval(lcdTick, 100);

  // ---- mini spectrum (WebAudio analyser on the clip player) ----
  const mv = document.getElementById('miniViz'), mc = mv.getContext('2d');
  let actx = null, analyser = null, data = null, raf = 0;
  function ensureAudioGraph() {
    if (actx || !window.AudioContext) return;
    try {
      actx = new AudioContext();
      const src = actx.createMediaElementSource(audioEl);
      analyser = actx.createAnalyser(); analyser.fftSize = 64; analyser.smoothingTimeConstant = .7;
      src.connect(analyser); analyser.connect(actx.destination);
      data = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) { console.warn('analyser unavailable', e); actx = null; }
  }
  function drawViz() {
    const W = mv.width, H = mv.height, th = root.dataset.theme, n = 19, cw = Math.floor(W / n) - 1;
    mc.clearRect(0, 0, W, H);
    for (let i = 0; i < n; i++) {
      const v = data && !audioEl.paused ? data[Math.min(data.length - 1, i + 1)] / 255 : 0.04;
      const bh = Math.max(1, Math.round(v * H));
      if (th === 'winamp') {
        for (let y = 0; y < bh; y += 2) { const f = y / H; mc.fillStyle = f > .75 ? '#e02800' : f > .5 ? '#f7d000' : '#00c000'; mc.fillRect(i * (cw + 1), H - y - 1, cw, 1); }
      } else {
        const g = mc.createLinearGradient(0, H, 0, 0);
        if (th === 'y2k') { g.addColorStop(0, '#6fa9a2'); g.addColorStop(1, '#d4a24a'); } else { g.addColorStop(0, '#2bc0e4'); g.addColorStop(1, '#c9f6ff'); }
        mc.fillStyle = g; mc.fillRect(i * (cw + 1), H - bh, cw, bh);
      }
    }
  }
  function loop() { if (analyser) analyser.getByteFrequencyData(data); drawViz(); if (!audioEl.paused) raf = requestAnimationFrame(loop); }
  audioEl.addEventListener('play', () => { ensureAudioGraph(); actx && actx.state === 'suspended' && actx.resume(); cancelAnimationFrame(raf); loop(); });
  audioEl.addEventListener('pause', () => { cancelAnimationFrame(raf); drawViz(); });
  addEventListener('lc:theme', drawViz);
  drawViz();
})();
