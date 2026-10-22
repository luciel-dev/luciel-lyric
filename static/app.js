const $ = s => document.querySelector(s);
// app events (consumed by theme.js / mascot.js): lc:audio, lc:sync-start, lc:sync-done, lc:render-start, lc:render-done, lc:error, lc:play, lc:stop, lc:font, lc:bgvideo
const emit = (name, detail = {}) => window.dispatchEvent(new CustomEvent('lc:' + name, {detail}));
const S = {audio: null, start: 0, len: 20, lines: [], preset: 'neon', bgId: null, cfg: null, raf: null, fonts: [], fontId: '', bgMode: 'gradient', bgVideo: null, bgImageUrl: null, timingLock: false};
const audio = $('#audio');

async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) { let t = await r.text(); try { t = JSON.parse(t).detail } catch (e) {} throw new Error(t); }
  return r.json();
}
const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

// ---------- config ----------
(async () => {
  S.cfg = await api('/api/config');
  S.tier = S.cfg.default_tier || 'best';
  paintTiers();
  const sep = $('#sepIn'), sepNote = $('#sepNote');
  if (S.cfg.demucs) { sep.checked = true; sep.disabled = false; sepNote.hidden = true; sep.parentElement.title = ''; }
  else { sep.checked = false; sep.disabled = true; sepNote.hidden = false; sep.parentElement.title = 'Vocal isolation not installed'; }
  const pc = $('#presets');
  for (const [k, p] of Object.entries(S.cfg.presets)) {
    const d = document.createElement('div');
    d.className = 'preset' + (k === S.preset ? ' sel' : '');
    d.dataset.id = k;
    d.title = p.label;
    d.innerHTML = `<canvas width="168" height="64" aria-hidden="true"></canvas><small>${esc(p.label)}</small>`;
    d.onclick = () => {
      S.preset = k;
      document.querySelectorAll('.preset').forEach(x => x.classList.remove('sel'));
      d.classList.add('sel');
      S.fontId = '';
      const sel = $('#fontSel'); if (sel) sel.value = '';
      window.ED && ED.onLook();
      applyFont();
    };
    pc.appendChild(d);
  }
  window.ED && ED.init(S.cfg);
  // desktop helpers (only for a browser on the same computer)
  if (S.cfg.can_open_folders) {
    const open = async () => { try { const r = await api('/api/open-folder', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({which: 'renders'})});
      $('#renderStatus').textContent = `📂 ${r.opened}`; } catch (e) { $('#renderStatus').textContent = '❌ ' + e.message; } };
    for (const id of ['#openRenders', '#openRenders2']) { $(id).classList.remove('hidden'); $(id).onclick = open; }
  }
  if (S.cfg.can_quit && S.cfg.desktop_mode === 'browser') {
    $('#quitApp').classList.remove('hidden');
    $('#quitApp').onclick = async () => { if (!confirm('Quit Luciel Lyric?')) return;
      try { await api('/api/shutdown', {method: 'POST'}); } catch (e) {}
      document.body.innerHTML = '<p style="font:16px sans-serif;padding:40px">Luciel Lyric has stopped. You can close this tab.</p>'; };
  }
  await loadFonts();
})();

// ---------- custom fonts ----------
const cssFam = f => `lc-${f.id}`;  // private CSS family name per uploaded font
const loadedFonts = new Set();
async function registerFont(f) {
  if (loadedFonts.has(f.id)) return;
  try { const ff = new FontFace(cssFam(f), `url(${f.url})`); await ff.load(); document.fonts.add(ff); loadedFonts.add(f.id); }
  catch (e) { console.warn('font load failed', f, e); }
}
async function loadFonts(selectId) {
  S.fonts = (await api('/api/fonts')).fonts;
  await Promise.all(S.fonts.map(registerFont));
  const sel = $('#fontSel');
  sel.innerHTML = '<option value="">Look default</option>' + S.fonts.map(f =>
    `<option value="${f.id}" style="font-family:'${cssFam(f)}'">${esc(f.family)}${f.style && f.style !== 'Regular' ? ' ' + esc(f.style) : ''}</option>`).join('');
  if (selectId !== undefined) S.fontId = selectId;
  if (!S.fonts.some(f => f.id === S.fontId)) S.fontId = '';
  sel.value = S.fontId; applyFont();
}
function currentFontCss() {
  const f = S.fonts.find(x => x.id === S.fontId);
  if (f) return {css: `'${cssFam(f)}'`, label: `${f.family} · uploaded${f.converted_from ? ' (' + f.converted_from + ' → ttf)' : ''}`};
  const p = S.cfg?.presets[S.preset];
  return {css: p ? `'${p.font}',Inter,sans-serif` : 'Inter', label: p ? `${p.font} · look default` : ''};
}
function applyFont() {
  const {css, label} = currentFontCss();
  $('#fontPreview .fpsample').style.fontFamily = css; $('#fontPreview .fpname').textContent = label;
  $('#pvLine').style.fontFamily = css; $('#pvNext').style.fontFamily = css;
  $('#fontSel').style.fontFamily = css;
  $('#fontDel').classList.toggle('hidden', !S.fontId);
  window.ED && ED.onFont();
}
$('#fontSel').onchange = e => { S.fontId = e.target.value; applyFont(); };
$('#fontFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  $('#fontStatus').innerHTML = `<span class="spin"></span>Uploading ${esc(f.name)}…`;
  const fd = new FormData(); fd.append('file', f);
  try {
    const m = await api('/api/fonts', {method: 'POST', body: fd});
    await loadFonts(m.id); emit('font', m);
    $('#fontStatus').textContent = `✅ Added “${m.family}”` + (m.shadows_system_font ? ' (same name as an installed system font)' : '');
  } catch (er) { $('#fontStatus').textContent = '❌ ' + er.message; }
  e.target.value = '';
};
$('#fontDel').onclick = async () => {
  const f = S.fonts.find(x => x.id === S.fontId); if (!f || !confirm(`Delete uploaded font “${f.family}”?`)) return;
  try { await api(`/api/fonts/${f.id}`, {method: 'DELETE'}); await loadFonts(''); $('#fontStatus').textContent = `Deleted “${f.family}”`; }
  catch (er) { $('#fontStatus').textContent = '❌ ' + er.message; }
};

// ---------- upload ----------
const drop = $('#drop');
['dragover', 'dragenter'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', ev => { if (ev.dataTransfer.files[0]) uploadAudio(ev.dataTransfer.files[0]); });
$('#audioFile').onchange = e => e.target.files[0] && uploadAudio(e.target.files[0]);

async function uploadAudio(f) {
  $('#trackInfo').innerHTML = `<span class="spin"></span>Uploading ${f.name}…`;
  const fd = new FormData(); fd.append('file', f);
  try {
    S.audio = await api('/api/upload', {method: 'POST', body: fd});
  } catch (e) {
    $('#trackInfo').textContent = e.message;
    if (window.LCFlow) LCFlow.fail('That audio file did not load. Try an mp3 or wav.', 1, 'Back to Audio');
    emit('error', {where: 'upload', message: e.message}); return;
  }
  $('#trackInfo').innerHTML = `🎵 <b>${S.audio.name}</b> · ${fmt(S.audio.duration)}`;
  audio.src = `/api/audio/${S.audio.id}`;
  const picked = clampSection(0, +$('#lenIn').value || 20, S.audio.duration);
  S.start = picked.start; S.len = picked.len;
  $('#waveWrap').classList.remove('hidden'); $('#syncBtn').disabled = false;
  $('#tapBox').classList.remove('hidden'); paintTap();
  drawWave(); emit('audio', S.audio); window.ED && ED.onAudio();
  if (window.LCFlow && LCFlow.placeSongRange) LCFlow.placeSongRange();
  else mountSongWave();
}

// ---------- waveform ----------
const cv = $('#wave');
function cssVar(n, d) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; }
function drawWave() {
  if (!S.audio) return;
  const dpr = devicePixelRatio || 1;
  const w = cv.width = cv.clientWidth * dpr, h = cv.height = 120 * dpr;
  const c = cv.getContext('2d'), pk = S.audio.peaks, D = S.audio.duration;
  const theme = document.documentElement.dataset.theme;
  const col = {on: cssVar('--wave-on', '#1ed760'), off: cssVar('--wave-off', '#45455a'), sel: cssVar('--wave-sel', '#1ed76022'),
               cur: cssVar('--wave-cursor', '#fff'), play: cssVar('--wave-play', '#ff3cac')};
  c.clearRect(0, 0, w, h);
  const x0 = S.start / D * w, x1 = Math.min(1, (S.start + S.len) / D) * w;
  c.fillStyle = col.sel; c.fillRect(x0, 0, x1 - x0, h);
  if (theme === 'winamp') {
    // spectrum-analyzer look: segmented columns, green -> yellow -> red by height, peak caps
    const colW = 5 * dpr, gap = 1 * dpr, seg = 3 * dpr, sgap = 1 * dpr, n = Math.floor(w / (colW + gap));
    for (let k = 0; k < n; k++) {
      const i0 = Math.floor(k / n * pk.length), i1 = Math.max(i0 + 1, Math.floor((k + 1) / n * pk.length));
      let v = 0; for (let i = i0; i < i1; i++) v = Math.max(v, pk[i]);
      const x = k * (colW + gap), inSel = x + colW >= x0 && x <= x1;
      const segs = Math.max(1, Math.round(v * (h - 6 * dpr) / (seg + sgap)));
      for (let s = 0; s < segs; s++) {
        const y = h - (s + 1) * (seg + sgap), fr = (s * (seg + sgap)) / h;
        c.fillStyle = fr > .78 ? '#e02800' : fr > .55 ? '#f7d000' : fr > .3 ? '#7fe000' : '#00c000';
        c.globalAlpha = inSel ? 1 : .28; c.fillRect(x, y, colW, seg);
      }
      c.globalAlpha = inSel ? .9 : .25; c.fillStyle = '#c8c8d8'; c.fillRect(x, h - (segs + 1) * (seg + sgap) - dpr, colW, dpr);
    }
    c.globalAlpha = 1;
  } else {
    const bw = w / pk.length, mirror = theme === 'y2k';
    let grad = null;
    if (mirror) { grad = c.createLinearGradient(0, 0, w, 0); grad.addColorStop(0, '#b08a46'); grad.addColorStop(.5, '#d4a24a'); grad.addColorStop(1, '#6fa9a2'); }
    for (let i = 0; i < pk.length; i++) {
      const x = i * bw, a = Math.max(1, pk[i] * h * .9), inSel = x >= x0 && x <= x1;
      c.fillStyle = inSel ? (grad || col.on) : col.off;
      c.fillRect(x, (h - a) / 2, Math.max(1, bw - .5), a);
    }
    if (mirror) { c.fillStyle = 'rgba(226,221,208,.10)'; c.fillRect(0, h / 2, w, 1); }
  }
  c.fillStyle = col.cur; c.fillRect(x0, 0, 2 * dpr, h);
  if (!audio.paused) { const px = audio.currentTime / D * w; c.fillStyle = col.play; c.fillRect(px, 0, 2 * dpr, h); }
  c.fillStyle = col.cur;
  c.font = theme === 'winamp' ? `${16 * dpr}px VT323` : theme === 'y2k' ? `${13 * dpr}px "Share Tech Mono"` : `${12 * dpr}px ${cssVar('--font', 'Inter')}`;
  c.fillText(`${fmt(S.start)} → ${fmt(Math.min(D, S.start + S.len))}`, x0 + 6, 16 * dpr);
}
window.addEventListener('resize', drawWave);

// The 15–30s window. Lyric lines stay as they are; word times are relative to S.start.
function sectionBounds(dur) {
  dur = Math.max(0, +dur || 0);
  return {minLen: Math.min(15, dur), maxLen: Math.min(30, dur)};
}
function clampSection(start, len, dur) {
  dur = Math.max(0, +dur || 0);
  const {minLen, maxLen} = sectionBounds(dur);
  let L = Math.max(minLen, Math.min(maxLen, +len || minLen));
  if (!Number.isFinite(L)) L = minLen;
  let s = Math.max(0, Math.min(+start || 0, Math.max(0, dur - L)));
  if (s + L > dur) L = Math.max(0, dur - s);
  return {start: +s.toFixed(3), len: +L.toFixed(3)};
}
function fmtClock(t) {
  t = Math.max(0, +t || 0);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
}
function parseClock(v) {
  const s = String(v == null ? '' : v).trim();
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return (+m[1]) * 60 + (+m[2]);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
function writeInput(el, value) {
  if (!el || document.activeElement === el) return;
  if (el.value !== value) el.value = value;
}
function sectionColor() {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'y2k') return 'rgba(212,162,74,.45)';
  if (theme === 'winamp') return 'rgba(0,224,0,.35)';
  return 'rgba(30,215,96,.38)';
}
let songWs = null, songRegions = null, songRegion = null, songAudioId = null, songMute = false;
function paintSection() {
  const start = S.start || 0, len = S.len || 0, end = start + len;
  const set = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };
  set('songStartRead', fmtClock(start));
  set('songEndRead', fmtClock(end));
  set('songLenRead', fmtClock(len));
  writeInput($('#songStartIn'), fmtClock(start));
  writeInput($('#songEndIn'), fmtClock(end));
  writeInput($('#songLenIn'), len.toFixed(1));
  writeInput($('#startIn'), start.toFixed(1));
  writeInput($('#lenIn'), String(len));
  const lv = $('#lenVal'); if (lv) lv.textContent = (+len).toFixed(1).replace(/\.0$/, '');
  if (S.audio) {
    const b = sectionBounds(S.audio.duration);
    if ($('#lenIn')) { $('#lenIn').min = b.minLen; $('#lenIn').max = b.maxLen; }
    if ($('#songLenIn')) { $('#songLenIn').min = b.minLen; $('#songLenIn').max = b.maxLen; }
    if ($('#startIn')) $('#startIn').max = Math.max(0, S.audio.duration - b.minLen).toFixed(1);
  }
}
function widenSongHandles(reg) {
  if (!reg || !reg.element) return;
  reg.element.querySelectorAll('[part*="region-handle"]').forEach(h => { h.style.width = '16px'; });
}
function syncSongRegion() {
  if (!songRegion) return;
  const end = Math.min(S.audio ? S.audio.duration : S.start + S.len, S.start + S.len);
  songMute = true;
  try { songRegion.setOptions({start: S.start, end: Math.max(S.start, end), color: sectionColor(), drag: true}); }
  catch (e) {}
  widenSongHandles(songRegion);
  songMute = false;
}
function setSection(start, len, fromRegion) {
  if (!S.audio) return;
  const lines = JSON.stringify(S.lines);
  const c = clampSection(start, len, S.audio.duration);
  S.start = c.start;
  S.len = c.len;
  if (JSON.stringify(S.lines) !== lines) S.lines = JSON.parse(lines);
  paintSection();
  drawWave();
  if (window.LCTheme && LCTheme.refresh) LCTheme.refresh();
  if (!fromRegion) syncSongRegion();
  if (window.ED && ED.onSection) ED.onSection();
  if (!fromRegion && window.LCHist) LCHist.touch();
}
function mountSongWave() {
  const box = document.getElementById('songWave');
  if (!box || !S.audio || !window.WaveSurfer || !WaveSurfer.Regions) return;
  if (box.clientWidth < 20) {
    if (box.offsetParent) requestAnimationFrame(mountSongWave);
    return;
  }
  if (songWs && songAudioId === S.audio.id) { syncSongRegion(); try { songWs.setOptions({height: 128}); } catch (e) {} return; }
  if (songWs) { try { songWs.destroy(); } catch (e) {} songWs = null; songRegion = null; songRegions = null; }
  songAudioId = S.audio.id;
  songRegions = WaveSurfer.Regions.create();
  const opts = {
    container: box, height: 128, waveColor: '#8a8aa0', progressColor: '#1ed760', cursorColor: '#ff3cac',
    interact: false, hideScrollbar: true, autoCenter: false, plugins: [songRegions],
  };
  if (S.audio.peaks && S.audio.peaks.length && S.audio.duration) {
    opts.peaks = [S.audio.peaks];
    opts.duration = S.audio.duration;
  } else opts.url = `/api/audio/${S.audio.id}`;
  songWs = WaveSurfer.create(opts);
  const arm = () => {
    if (!songWs || !S.audio || songAudioId !== S.audio.id) return;
    const dur = songWs.getDuration() || S.audio.duration;
    const b = sectionBounds(dur);
    const c = clampSection(S.start, S.len, dur);
    S.start = c.start; S.len = c.len;
    songRegions.clearRegions();
    songRegion = songRegions.addRegion({
      id: 'section', start: S.start, end: Math.min(dur, S.start + S.len),
      drag: true, resize: true, color: sectionColor(), minLength: b.minLen, maxLength: Math.max(b.minLen, b.maxLen),
    });
    widenSongHandles(songRegion);
    paintSection();
  };
  songWs.on('ready', arm);
  songRegions.on('region-update', region => {
    if (songMute || !region || region.id !== 'section') return;
    setSection(region.start, region.end - region.start, true);
  });
  songRegions.on('region-updated', region => {
    if (songMute || !region || region.id !== 'section') return;
    setSection(region.start, region.end - region.start, true);
    const end = S.start + S.len;
    if (Math.abs(region.start - S.start) > 0.02 || Math.abs(region.end - end) > 0.02) {
      songMute = true;
      try { region.setOptions({start: S.start, end}); } catch (e) {}
      songMute = false;
    }
    if (window.LCHist) LCHist.capture();
  });
}
window.addEventListener('lc:theme', () => { drawWave(); syncSongRegion(); });
function setStartFromEvent(e) {
  if (!S.audio || !cv.clientWidth) return;
  const r = cv.getBoundingClientRect();
  setSection((e.clientX - r.left) / r.width * S.audio.duration, S.len);
}
function setStart(t) { if (S.audio) setSection(t, S.len); }
let dragging = false;
cv.addEventListener('mousedown', e => { dragging = true; setStartFromEvent(e); });
window.addEventListener('mousemove', e => dragging && setStartFromEvent(e));
window.addEventListener('mouseup', () => dragging = false);
$('#startIn').onchange = e => setStart(+e.target.value);
$('#lenIn').oninput = e => { if (S.audio) setSection(S.start, +e.target.value); else { S.len = +e.target.value; $('#lenVal').textContent = S.len; } };
function bindSongInputs() {
  const n = id => document.getElementById(id);
  if (n('songStartMinus')) n('songStartMinus').onclick = () => setSection(S.start - 0.1, S.len);
  if (n('songStartPlus')) n('songStartPlus').onclick = () => setSection(S.start + 0.1, S.len);
  if (n('songEndMinus')) n('songEndMinus').onclick = () => setSection(S.start, S.len - 0.1);
  if (n('songEndPlus')) n('songEndPlus').onclick = () => setSection(S.start, S.len + 0.1);
  if (n('songStartIn')) n('songStartIn').onchange = e => { const t = parseClock(e.target.value); if (t == null) return paintSection(); setSection(t, S.len); };
  if (n('songEndIn')) n('songEndIn').onchange = e => { const t = parseClock(e.target.value); if (t == null) return paintSection(); setSection(S.start, t - S.start); };
  if (n('songLenIn')) n('songLenIn').onchange = e => setSection(S.start, +e.target.value);
}
bindSongInputs();
window.setSection = setSection;
window.mountSongWave = mountSongWave;
window.clampSection = clampSection;
window.fmtClock = fmtClock;

// ---------- playback ----------
let sectionPlaying = false;
function stopPlay() { sectionPlaying = false; const was = !audio.paused; audio.pause(); if (was) emit('stop'); cancelAnimationFrame(S.raf); $('#playBtn').textContent = '▶ Play clip'; $('#previewBtn').textContent = '▶ Preview sync'; $('#stagePlay').textContent = '▶ Preview'; window.ED && ED.onStop(); drawWave(); }
function playClip(withPreview, btn, from = 0) {
  if (!audio.paused) return stopPlay();
  sectionPlaying = true;
  audio.currentTime = S.start + from;
  const played = audio.play();
  if (played && typeof played.catch === 'function') played.catch(() => {});
  window.ED && ED.onPlay(from);
  (btn || (withPreview ? $('#previewBtn') : $('#playBtn'))).textContent = '■ Stop';
  emit('play', {preview: !!withPreview});
  const tick = () => {
    if (!sectionPlaying) return;
    const end = S.start + S.len;
    if (audio.ended || audio.currentTime >= end - 0.02) {
      audio.currentTime = S.start;
      if (audio.paused) { const again = audio.play(); if (again && again.catch) again.catch(() => {}); }
    }
    drawWave(); if (withPreview) updatePreview(Math.max(0, audio.currentTime - S.start));
    window.ED && ED.onTick(Math.max(0, audio.currentTime - S.start));
    S.raf = requestAnimationFrame(tick);
  };
  tick();
}
$('#playBtn').onclick = () => playClip(false);
$('#previewBtn').onclick = () => playClip(true);
$('#stagePlay').onclick = () => playClip(true, $('#stagePlay'), window.ED ? ED.playFrom() : 0);

function updatePreview(t) {
  const L = S.lines.filter(l => l.words.length);
  let idx = -1;
  for (let i = 0; i < L.length; i++) if (L[i].words[0].start - 0.25 <= t) idx = i;
  const line = L[idx];
  const pv = $('#pvLine');
  if (!line || t > line.words[line.words.length - 1].end + 0.8) { pv.innerHTML = '&nbsp;'; } else {
    pv.innerHTML = line.words.map(w => `<span class="${t >= w.start ? 'on' : ''}">${esc(w.text)}</span>`).join(' ');
  }
  const nx = L[idx + 1]; $('#pvNext').textContent = nx ? nx.words.map(w => w.text).join(' ') : '';
  document.querySelectorAll('.line').forEach((el, i) => el.classList.toggle('active', S.lines[i] === line));
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

// ---------- sync ----------
function paintTiers() {
  const row = $('#tierRow'); if (!row || !S.cfg) return;
  const tiers = S.cfg.tiers || [];
  row.innerHTML = tiers.map(t => {
    const mb = Math.max(1, Math.round(t.bytes / 1e6));
    const saved = t.ready ? ' · saved' : '';
    return `<button type="button" class="tierbtn${t.id === S.tier ? ' on' : ''}" data-tier="${t.id}" role="radio" aria-checked="${t.id === S.tier}">
      <b>${esc(t.label)}</b><small>${esc(t.detail)} · ${mb} MB${saved}</small></button>`;
  }).join('');
  row.querySelectorAll('button').forEach(b => b.onclick = () => { S.tier = b.dataset.tier; paintTiers(); });
  const cur = tiers.find(t => t.id === S.tier);
  const note = $('#tierNote');
  if (note) note.textContent = cur
    ? (cur.ready ? `${cur.label} is saved on this computer and stays offline.` : `${cur.label} downloads once, then stays on this computer.`)
    : '';
}
let syncPoll = null;
function watchProgress(on) {
  clearInterval(syncPoll); syncPoll = null;
  const box = $('#syncProgress');
  if (!on) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const tick = async () => {
    try {
      const p = await api('/api/models/progress');
      const frac = Math.max(0, Math.min(1, p.fraction || 0));
      $('#syncBar').style.width = (frac * 100).toFixed(1) + '%';
      box.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
      $('#syncProgressText').textContent = p.message || (p.error ? p.error : 'Working…');
    } catch (e) {}
  };
  tick();
  syncPoll = setInterval(tick, 400);
}
function showSyncBanner(r) {
  const b = $('#syncBanner');
  b.classList.remove('hidden', 'ok', 'warn', 'bad');
  const low = (r.lines || []).filter(l => l.low_confidence).length;
  let text;
  if (r.ok === false) {
    b.classList.add('bad');
    text = r.error || 'These timings need a check. Low-confidence lines are marked.';
  } else if (low) {
    b.classList.add('warn');
    text = r.error || `${low} line${low === 1 ? '' : 's'} look uncertain and are highlighted. Tap them in, or edit the times.`;
  } else if (r.mode === 'forced_alignment') {
    b.classList.add('ok');
    text = `Lyrics aligned to the vocals. Confidence ${Math.round((r.confidence || 0) * 100)}%.`;
  } else {
    b.classList.add('ok');
    text = `Heard ${r.stats?.hyp_words || 0} words.`;
  }
  if (r.separation_error) text += ' Vocal isolation did not run, so the mix was used.';
  b.textContent = text;
}
function paintLock() {
  const b = $('#lockToggle');
  if (!b) return;
  const locked = !!S.timingLock;
  b.textContent = locked ? '🔒 Timings locked' : '🔓 Unlocked';
  b.title = locked ? 'Unlock to re-sync' : 'Lock timings';
  const note = $('#lockNote');
  if (note) note.textContent = locked
    ? 'Word times stay put while you edit text or pause. Unlock to re-sync.'
    : 'Unlocked. Sync again to replace the times. Nudge, tap, and the waveform still edit times directly.';
}
$('#lockToggle').onclick = () => {
  if (!S.lines.length) {
    if (window.LCFlow) LCFlow.fail('Sync the lyrics before locking them.', 2, 'Go to Sync');
    return;
  }
  if (S.timingLock) {
    if (!confirm('Unlock timings so you can re-sync? Current times stay until you sync again.')) return;
    S.timingLock = false;
  } else S.timingLock = true;
  paintLock();
  renderLines();
};
$('#syncBtn').onclick = async () => {
  if (S.lines.length && S.timingLock) {
    if (window.LCFlow) LCFlow.fail('Unlock timings to re-sync. The times you have now stay until you sync again.', 2, 'Show the lock');
    return;
  }
  if (S.lines.length && !confirm('Re-sync replaces the current word times. Continue?')) return;
  const sep = $('#sepIn').checked;
  $('#syncBtn').disabled = true; emit('sync-start');
  $('#syncBanner').classList.add('hidden');
  const listening = $('#lyricsIn').value.trim() ? 'Aligning the lyrics to the vocals' : 'Listening for the words';
  $('#syncStatus').innerHTML = `<span class="spin"></span>${sep ? 'Isolating vocals, then ' : ''}${listening}…`;
  watchProgress(true);
  try {
    const r = await api('/api/sync', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({audio_id: S.audio.id, start: S.start, length: S.len, lyrics: $('#lyricsIn').value,
        separate_vocals: sep, model: S.tier})});
    S.lines = r.lines; S.len = r.length;
    const st = r.stats || {};
    const bits = [];
    if (r.mode === 'forced_alignment') bits.push(`Aligned ${st.ref_words_used || 0} typed words`);
    else if (r.mode === 'transcribed_realigned') bits.push(`Retimed ${st.hyp_words || 0} heard words`);
    else bits.push(`Transcribed ${st.hyp_words || 0} words`);
    if (r.timing) {
      if (r.timing.align_s) bits.push(`align ${r.timing.align_s}s`);
      if (r.timing.asr_s) bits.push(`listen ${r.timing.asr_s}s`);
      if (r.vocal_separation) bits.push(`vocals ${r.timing.separation_s}s`);
      if (r.timing.download_s) bits.push(`download ${r.timing.download_s}s`);
    }
    $('#syncStatus').textContent = bits.join(' · ');
    showSyncBanner(r);
    if (S.cfg && S.cfg.tiers) { const hit = S.cfg.tiers.find(t => t.id === S.tier); if (hit) hit.ready = true; paintTiers(); }
    S.timingLock = true;
    snapshotTap(); renderLines(); paintLock(); emit('sync-done', r);
    paintTap();
    updateStage(); const f0 = S.lines[0]?.words[0]; updatePreview(f0 ? +f0.start + 0.4 : 0);
    window.ED && ED.seek(f0 ? +f0.start + 0.6 : 0);
    window.ED && ED.refresh && ED.refresh();
  } catch (e) {
    $('#syncStatus').textContent = e.message;
    const b = $('#syncBanner'); b.classList.remove('hidden', 'ok', 'warn'); b.classList.add('bad'); b.textContent = e.message;
    emit('error', {where: 'sync', message: e.message});
  }
  watchProgress(false);
  $('#syncBtn').disabled = false;
};

// ---------- tap to sync ----------
const tap = {mode: 'line', marks: []};
function seedLinesFromPaste() {
  const text = $('#lyricsIn').value || '';
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean).map(line => ({
    low_confidence: true, confidence: 0,
    words: line.split(/\s+/).filter(Boolean).map(t => ({text: t, start: S.len, end: +(S.len + 0.02).toFixed(3), confidence: 0, low_confidence: true})),
  })).filter(ln => ln.words.length);
  if (!lines.length) return false;
  S.lines = lines;
  return true;
}
function snapshotTap() {
  tap.marks = [];
  S.tapBase = S.lines.map(ln => ({
    confidence: ln.confidence, low_confidence: !!ln.low_confidence,
    words: ln.words.map(w => ({start: +w.start, end: +w.end, confidence: w.confidence, low_confidence: !!w.low_confidence})),
  }));
}
function tapTargets() {
  const out = [];
  S.lines.forEach((ln, li) => {
    if (tap.mode === 'line') out.push({li, words: ln.words, line: true});
    else ln.words.forEach((w, wi) => out.push({li, wi, words: [w], line: false}));
  });
  return out;
}
function applyTaps() {
  if (!S.tapBase) snapshotTap();
  S.tapBase.forEach((src, li) => {
    const ln = S.lines[li]; if (!ln) return;
    src.words.forEach((w, wi) => { if (!ln.words[wi]) return; ln.words[wi].start = w.start; ln.words[wi].end = w.end; ln.words[wi].confidence = w.confidence; ln.words[wi].low_confidence = w.low_confidence; });
    ln.confidence = src.confidence; ln.low_confidence = src.low_confidence;
  });
  if (!tap.marks.length) { renderLines(); window.ED && ED.refresh && ED.refresh(); paintTap(); return; }
  const targets = tapTargets();
  const len = S.len || 20;
  targets.forEach((tg, i) => {
    const words = tg.words;
    if (i >= tap.marks.length) {
      const start = Math.max(0, len - 0.08 * (targets.length - i));
      words.forEach((w, k) => {
        w.start = +Math.min(len - 0.02, start + k * 0.02).toFixed(3);
        w.end = +Math.min(len, w.start + 0.02).toFixed(3);
        w.low_confidence = true; w.confidence = 0;
      });
      return;
    }
    const start = Math.max(0, Math.min(len - 0.02, tap.marks[i]));
    const next = i + 1 < tap.marks.length ? tap.marks[i + 1] : Math.min(len, start + Math.max(0.35, 0.28 * words.length));
    const span = Math.max(0.02 * words.length, next - start);
    words.forEach((w, k) => {
      const a = start + span * (k / words.length);
      const b = start + span * ((k + 1) / words.length);
      w.start = +Math.min(a, len - 0.02).toFixed(3);
      w.end = +Math.min(len, Math.max(w.start + 0.02, b)).toFixed(3);
      w.low_confidence = false; w.confidence = 1;
    });
  });
  let prev = 0;
  S.lines.forEach(ln => {
    ln.words.forEach(w => {
      if (w.start < prev) w.start = +prev.toFixed(3);
      if (w.end < w.start + 0.02) w.end = +(w.start + 0.02).toFixed(3);
      prev = w.end;
    });
    const tapped = ln.words.some(w => w.confidence === 1);
    ln.low_confidence = ln.words.some(w => w.low_confidence);
    if (tapped && !ln.low_confidence) ln.confidence = 1;
  });
  renderLines();
  window.ED && ED.syncRegions && ED.syncRegions();
  window.ED && ED.refresh && ED.refresh();
  paintTap();
}
function paintTap() {
  const now = $('#tapNow'); if (!now) return;
  const targets = S.lines.length ? tapTargets() : [];
  const i = tap.marks.length;
  if (!targets.length) { now.textContent = 'Paste lyrics or sync first, then tap along.'; return; }
  if (i >= targets.length) { now.textContent = 'Every mark is in. Undo or restart to change them.'; return; }
  const tg = targets[i];
  const label = tg.words.map(w => w.text).join(' ');
  now.textContent = `Next: ${label}`;
}
function tapMark() {
  if (!S.audio) return;
  if (!S.lines.length && !seedLinesFromPaste()) { $('#tapNow').textContent = 'Paste the lyrics first.'; return; }
  if (!S.tapBase) snapshotTap();
  if (audio.paused) playClip(false);
  const t = Math.max(0, audio.currentTime - S.start);
  if (tap.marks.length && t < tap.marks[tap.marks.length - 1]) return;
  if (tap.marks.length >= tapTargets().length) return;
  tap.marks.push(+t.toFixed(3));
  applyTaps();
}
$('#tapPlay').onclick = () => {
  if (!S.audio) return;
  if (!S.lines.length && !seedLinesFromPaste()) { $('#tapNow').textContent = 'Paste the lyrics first.'; return; }
  if (!S.tapBase) snapshotTap();
  renderLines();
  playClip(false);
  paintTap();
};
$('#tapUndo').onclick = () => { tap.marks.pop(); if (S.tapBase) applyTaps(); else paintTap(); };
$('#tapRestart').onclick = () => { tap.marks = []; if (S.tapBase) applyTaps(); };
$('#tapHit').onclick = () => tapMark();
$('#tapMode').querySelectorAll('button').forEach(b => b.onclick = () => {
  tap.mode = b.dataset.mode;
  $('#tapMode').querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
  tap.marks = [];
  if (S.tapBase) applyTaps(); else paintTap();
});
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' && e.key !== ' ') return;
  const el = document.activeElement;
  const tag = (el && el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || (el && el.isContentEditable)) return;
  if (e.repeat) return;
  e.preventDefault();
  if (typeof playClip === 'function') playClip(true, $('#stagePlay'), window.ED ? ED.playFrom() : 0);
});

// ---------- editor ----------
function renderLines() {
  const box = $('#lines'); box.innerHTML = '';
  S.lines.forEach((ln, li) => {
    const d = document.createElement('div'); d.className = 'line' + (ln.low_confidence ? ' lowconf' : '');
    d.innerHTML = `<div class="lhead">${li + 1}<button title="Merge with line above" data-a="merge">⤒</button><button title="Delete line" data-a="del">🗑</button></div>`;
    d.querySelector('[data-a=merge]').onclick = () => { if (li > 0) { S.lines[li - 1].words.push(...ln.words); S.lines.splice(li, 1); renderLines(); } };
    d.querySelector('[data-a=del]').onclick = () => { S.lines.splice(li, 1); renderLines(); };
    ln.words.forEach((w, wi) => {
      const wd = document.createElement('div'); wd.className = 'word' + (w.low_confidence ? ' lowconf' : '') + (w.matched === false ? ' guess' : '');
      wd.innerHTML = `<input class="wt" value="${esc(w.text)}" size="${Math.max(3, w.text.length)}">
        <div class="tt"><input type="number" step="0.01" value="${(+w.start).toFixed(2)}" title="start"><input type="number" step="0.01" value="${(+w.end).toFixed(2)}" title="end"></div>
        <div class="wa"><button title="Split line after this word">↵</button><button title="Insert word after">＋</button><button title="Delete word">✕</button></div>`;
      const [ti, si, ei] = wd.querySelectorAll('input');
      ti.oninput = () => {
        const s = w.start, en = w.end;
        w.text = ti.value; w.start = s; w.end = en;
        ti.size = Math.max(3, ti.value.length);
        window.ED && ED.paintWords && ED.paintWords();
        window.LCHist && LCHist.touch();
      };
      si.disabled = !!S.timingLock; ei.disabled = !!S.timingLock;
      si.title = S.timingLock ? 'Unlock to type a time. Or drag the waveform, nudge, or tap.' : 'Start time';
      ei.title = S.timingLock ? 'Unlock to type a time. Or drag the waveform, nudge, or tap.' : 'End time';
      si.onchange = () => { if (!S.timingLock) { w.start = +si.value; window.LCHist && LCHist.capture(); } };
      ei.onchange = () => { if (!S.timingLock) { w.end = +ei.value; window.LCHist && LCHist.capture(); } };
      const [bs, ba, bd] = wd.querySelectorAll('.wa button');
      bs.onclick = () => { if (wi < ln.words.length - 1) { S.lines.splice(li + 1, 0, {words: ln.words.splice(wi + 1)}); renderLines(); } };
      ba.onclick = () => { ln.words.splice(wi + 1, 0, {text: '…', start: w.end, end: w.end + 0.3}); renderLines(); };
      bd.onclick = () => { ln.words.splice(wi, 1); if (!ln.words.length) S.lines.splice(li, 1); renderLines(); };
      d.appendChild(wd);
    });
    box.appendChild(d);
  });
  window.ED && ED.paintWords && ED.paintWords();
  window.LCFlow && LCFlow.hints && LCFlow.hints();
}
function shiftAll(dt) { S.lines.forEach(l => l.words.forEach(w => { w.start = Math.max(0, +(w.start) + dt); w.end = Math.max(0, +(w.end) + dt); })); renderLines(); window.LCHist && LCHist.capture(); window.ED && ED.syncRegions && ED.syncRegions(); }
$('#shiftMinus').onclick = () => shiftAll(-0.1); $('#shiftPlus').onclick = () => shiftAll(0.1);
$('#addLine').onclick = () => { const last = S.lines.at(-1)?.words.at(-1); const t = last ? +last.end + 0.3 : 0; S.lines.push({words: [{text: 'new', start: t, end: t + 0.5}]}); renderLines(); };

// ---------- background ----------
$('#bgFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const fd = new FormData(); fd.append('file', f);
  try { S.bgId = (await api('/api/background', {method: 'POST', body: fd})).bg_id; S.bgImageUrl = '/api/background/' + S.bgId; $('#bgName').textContent = '🖼 ' + f.name; $('#bgClear').classList.remove('hidden'); updateStage(); }
  catch (er) { $('#bgName').textContent = 'Upload failed: ' + er.message; }
};
$('#bgClear').onclick = () => { S.bgId = null; $('#bgFile').value = ''; $('#bgName').textContent = 'no image yet'; $('#bgClear').classList.add('hidden'); S.bgImageUrl = null; updateStage(); };

// ---------- render ----------
$('#renderBtn').onclick = async () => {
  $('#renderBtn').disabled = true; $('#result').classList.add('hidden'); emit('render-start');
  const outFps = window.ED && ED.outputFps ? ED.outputFps() : 30;
  $('#renderStatus').innerHTML = `<span class="spin"></span>Rendering ${Math.round(S.len * outFps)} frames (animations + effects are drawn frame by frame; roughly as long as the clip)…`;
  try {
    const r = await api('/api/render', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(renderBody())});
    $('#renderStatus').textContent = `✅ Rendered in ${r.render_s}s` + (r.output_fps ? ` · ${r.output_fps} fps${r.quality ? ' ' + r.quality : ''}` : ` (${r.fps} fps)`) + (r.size_mb ? ` · ${r.size_mb} MB` : '') + (r.custom_font ? ` · font “${r.custom_font}” ✓` : '')
      + (r.fx_skipped && r.fx_skipped.length ? ` · ⚠ skipped for this background: ${r.fx_skipped.join(', ')}` : '');
    const isMov = r.container === 'mov';
    $('#video').classList.toggle('hidden', isMov);
    $('#video').src = isMov ? '' : r.url + '?inline=1&t=' + Date.now(); $('#dl').href = r.url; $('#dl').download = r.file;
    $('#dl').textContent = `⬇ Download ${r.container.toUpperCase()}`;
    $('#result').classList.toggle('alpha', r.bg_mode === 'transparent');
    $('#resultNote').innerHTML = isMov ? 'ProRes 4444 with alpha. Browsers can’t play ProRes, so download it and import it into your editor.'
      : r.bg_mode === 'transparent' ? 'VP9 with alpha. The checkerboard shows through where it’s transparent.'
      : r.bg_mode === 'black' ? 'Put it over your footage with blend mode <b>Screen</b> or <b>Add</b>.'
      : r.bg_mode === 'green' ? 'Key out #00FF00 in your editor.' : '';
    $('#result').classList.remove('hidden'); emit('render-done', r);
  } catch (e) { $('#renderStatus').textContent = '❌ ' + e.message; emit('error', {where: 'render', message: e.message}); }
  $('#renderBtn').disabled = false;
};


// ---------- background modes + stage preview ----------
const OVERLAY = ['black', 'green', 'transparent'];
function renderBody() {
  const vm = S.bgMode;
  return {audio_id: S.audio.id, start: S.start, length: S.len, lines: S.lines, aspect: $('#aspectIn').value,
    preset: S.preset, font_id: S.fontId || null, visualizer: $('#vizIn').checked,
    title: $('#showTitleIn').checked ? $('#titleIn').value : '',
    artist: $('#showArtistIn') && $('#showArtistIn').checked ? $('#artistIn').value : '',
    bg_mode: vm, bg_id: vm === 'image' ? S.bgId : null, transparent_format: $('#alphaFmt').value,
    bg_video_id: vm === 'video' && S.bgVideo ? S.bgVideo.bg_video_id : null,
    video_darken: +$('#vDarkIn').value / 100, video_blur: +$('#vBlurIn').value,
    video_audio: $('#vMixIn').checked, video_volume: +$('#vVolIn').value / 100, ...(window.ED ? ED.renderExtras() : {})};
}
function setBgMode(m) {
  const wasOverlay = OVERLAY.includes(S.bgMode), isOverlay = OVERLAY.includes(m);
  S.bgMode = m; $('#bgMode').value = m;
  document.querySelectorAll('.bgopt').forEach(e => e.classList.toggle('on', e.dataset.mode === m));
  if (isOverlay && !wasOverlay) { $('#vizIn').checked = false; $('#showTitleIn').checked = false; if ($('#showArtistIn')) $('#showArtistIn').checked = false; }
  if (!isOverlay && wasOverlay) { $('#vizIn').checked = true; $('#showTitleIn').checked = true; }
  $('#renderBtn').textContent = m === 'transparent' ? `🎬 Render ${$('#alphaFmt').value.toUpperCase()} with alpha` : '🎬 Render MP4';
  validateRender(); updateStage();
}
function validateRender() {
  const clips = window.ED && ED.clipCount ? ED.clipCount() : (S.bgVideo ? 1 : 0);
  const need = S.bgMode === 'video' && clips < 1 ? 'Add a video on the Video step' : S.bgMode === 'image' && !S.bgId ? 'Upload a background image first' : '';
  $('#renderBtn').disabled = !!need; $('#renderBtn').title = need;
}
$('#bgMode').onchange = e => setBgMode(e.target.value);
$('#alphaFmt').onchange = () => setBgMode(S.bgMode);
['#vizIn', '#showTitleIn', '#titleIn', '#aspectIn', '#artistIn', '#showArtistIn'].forEach(s => { const n = $(s); if (n) n.addEventListener('input', updateStage); });
$('#aspectIn').addEventListener('change', updateStage);
const sliders = [['#vDarkIn', '#vDarkVal', v => v], ['#vBlurIn', '#vBlurVal', v => v], ['#vVolIn', '#vVolVal', v => v]];
sliders.forEach(([i, o, f]) => $(i).addEventListener('input', () => { $(o).textContent = f($(i).value); updateStage(); }));
document.querySelectorAll('input[name=vAudio]').forEach(r => r.onchange = () => { $('#vVolBox').style.opacity = $('#vMixIn').checked ? 1 : .4; $('#stageVideo').muted = !$('#vMixIn').checked; $('#stageVideo').volume = Math.min(1, +$('#vVolIn').value / 100); });
$('#vVolBox').style.opacity = .4;

$('#bgVideoFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  $('#bgVideoName').innerHTML = `<span class="spin"></span>Uploading ${esc(f.name)} and making a preview…`;
  const fd = new FormData(); fd.append('file', f);
  try {
    const m = await api('/api/bgvideo', {method: 'POST', body: fd});
    S.bgVideo = m; emit('bgvideo', m);
    $('#bgVideoName').textContent = `🎞 ${m.name} · ${m.duration.toFixed(1)}s · ${m.width}×${m.height}${m.has_audio ? '' : ' · no audio'}`;
    $('#vMixIn').disabled = !m.has_audio;
    $('#vLoopNote').innerHTML = (m.duration < S.len ? `Clip is ${m.duration.toFixed(1)}s, shorter than the ${S.len}s lyric section. Duplicate it on the Video step to fill the gap. ` : '') + 'Trim, split, and resize it on the Video step. Lyrics stay read-only.';
    const v = $('#stageVideo'); v.src = m.preview_url; v.load();
    window.ED && ED.onVideo(m);
    validateRender(); updateStage();
  } catch (er) { $('#bgVideoName').textContent = '❌ ' + er.message; }
  e.target.value = '';
};

function updateStage() {
  if (!S.cfg) return;
  $('#stageInfo').textContent = {gradient: 'gradient', image: 'image', video: 'video clip', black: 'black · overlay', green: 'green screen', transparent: 'transparent (checkerboard = alpha)'}[S.bgMode];
  window.ED && ED.refresh();
  validateRender();
}
window.addEventListener('resize', updateStage);
setBgMode('gradient');
paintLock();
