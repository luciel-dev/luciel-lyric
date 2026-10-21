const $ = s => document.querySelector(s);
// app events (consumed by theme.js / mascot.js): lc:audio, lc:sync-start, lc:sync-done, lc:render-start, lc:render-done, lc:error, lc:play, lc:stop, lc:font, lc:bgvideo
const emit = (name, detail = {}) => window.dispatchEvent(new CustomEvent('lc:' + name, {detail}));
const S = {audio: null, start: 0, len: 20, lines: [], preset: 'neon', bgId: null, cfg: null, raf: null, fonts: [], fontId: '', bgMode: 'gradient', bgVideo: null, bgImageUrl: null};
const audio = $('#audio');

async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) { let t = await r.text(); try { t = JSON.parse(t).detail } catch (e) {} throw new Error(t); }
  return r.json();
}
const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

// ---------- config ----------
(async () => {
  try { S.cfg = await api('/api/config'); }
  catch (e) { S.cfg = {models: ['base.en'], presets: {}, demucs: false, sync_models: [], sync_default: 'distil-large-v3', aligner: {cached: false, size_mb: 378}}; }
  fillModels();
  $('#modelIn').onchange = hintModel;
  if (S.cfg.demucs) $('#sepIn').checked = true; else { $('#sepIn').disabled = true; $('#sepIn').parentElement.title = 'demucs not installed'; $('#sepIn').parentElement.style.opacity = .5; }
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
  if (document.body.classList.contains('shot-sync')) bootShot();
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
  } catch (e) { $('#trackInfo').textContent = 'Upload failed: ' + e.message; emit('error', {where: 'upload', message: e.message}); return; }
  $('#trackInfo').innerHTML = `🎵 <b>${S.audio.name}</b> · ${fmt(S.audio.duration)}`;
  audio.src = `/api/audio/${S.audio.id}`;
  S.start = 0; S.len = Math.min(+$('#lenIn').value, S.audio.duration);
  $('#waveWrap').classList.remove('hidden'); $('#syncBtn').disabled = false; $('#tapBtn').disabled = false;
  $('#startIn').max = Math.max(0, S.audio.duration - 15);
  drawWave(); emit('audio', S.audio); window.ED && ED.onAudio();
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
window.addEventListener('lc:theme', drawWave);
window.addEventListener('resize', drawWave);
function setStartFromEvent(e) {
  const r = cv.getBoundingClientRect();
  const t = (e.clientX - r.left) / r.width * S.audio.duration;
  setStart(t - S.len / 2 * 0); }
function setStart(t) {
  S.start = Math.max(0, Math.min(t, Math.max(0, S.audio.duration - S.len)));
  $('#startIn').value = S.start.toFixed(1); drawWave();
}
let dragging = false;
cv.addEventListener('mousedown', e => { dragging = true; setStartFromEvent(e); });
window.addEventListener('mousemove', e => dragging && setStartFromEvent(e));
window.addEventListener('mouseup', () => dragging = false);
$('#startIn').onchange = e => setStart(+e.target.value);
$('#lenIn').oninput = e => { S.len = +e.target.value; $('#lenVal').textContent = S.len; if (S.audio) setStart(S.start); };

// ---------- playback ----------
function stopPlay() { const was = !audio.paused; audio.pause(); if (was) emit('stop'); cancelAnimationFrame(S.raf); $('#playBtn').textContent = '▶ Play clip'; $('#previewBtn').textContent = '▶ Preview sync'; $('#stagePlay').textContent = '▶ Preview'; window.ED && ED.onStop(); drawWave(); }
function playClip(withPreview, btn, from = 0) {
  if (!audio.paused) return stopPlay();
  audio.currentTime = S.start + from; audio.play();
  window.ED && ED.onPlay(from);
  (btn || (withPreview ? $('#previewBtn') : $('#playBtn'))).textContent = '■ Stop';
  emit('play', {preview: !!withPreview});
  const tick = () => {
    if (audio.currentTime >= S.start + S.len || audio.paused) return stopPlay();
    drawWave(); if (withPreview) updatePreview(audio.currentTime - S.start);
    window.ED && ED.onTick(audio.currentTime - S.start);
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

// ---------- sync models ----------
function fillModels() {
  const models = S.cfg && S.cfg.sync_models;
  const sel = $('#modelIn');
  if (!models || !models.length) {
    const list = (S.cfg && S.cfg.models) || ['base.en'];
    sel.innerHTML = list.map(m => `<option value="${esc(m)}" ${m === 'base.en' ? 'selected' : ''}>${esc(m)}</option>`).join('');
    $('#modelHint').textContent = '';
    return;
  }
  const def = S.cfg.sync_default || 'distil-large-v3';
  const keep = sel.value;
  sel.innerHTML = models.map(m => `<option value="${esc(m.id)}" ${(keep ? keep === m.id : m.id === def) ? 'selected' : ''}>${esc(m.label)} · ${esc(m.detail)}</option>`).join('');
  hintModel();
}
function hintModel() {
  const id = $('#modelIn').value;
  const m = ((S.cfg && S.cfg.sync_models) || []).find(x => x.id === id);
  const hint = $('#modelHint');
  if (!m) { hint.textContent = ''; return; }
  const al = S.cfg.aligner;
  let t = m.blurb || '';
  if (!m.cached) t += ` First sync downloads about ${Math.round(m.size_mb)} MB.`;
  else t += ' Saved on this computer.';
  if (al && !al.cached) t += ` Lyric alignment downloads about ${Math.round(al.size_mb)} MB once.`;
  hint.textContent = t;
}
function setSyncStatus(kind, text) {
  const el = $('#syncStatus');
  el.className = 'syncstatus' + (kind ? ' ' + kind : '');
  el.textContent = text || '';
}
async function ensureModels() {
  const id = $('#modelIn').value;
  const models = (S.cfg && S.cfg.sync_models) || [];
  if (!models.length) return;
  const m = models.find(x => x.id === id);
  const lyrics = $('#lyricsIn').value.trim();
  const need = [];
  if (lyrics && S.cfg.aligner && !S.cfg.aligner.cached) need.push('wav2vec2');
  if (m && !m.cached) need.push(id);
  if (!need.length) { $('#dlBar').classList.add('hidden'); return; }
  $('#dlBar').classList.remove('hidden');
  $('#dlFill').style.width = '0%';
  $('#dlLabel').textContent = 'Starting download…';
  const job = await api('/api/sync-models/download', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({models: need})});
  for (;;) {
    const j = await api('/api/sync-models/jobs/' + job.id);
    const pct = Math.round((j.progress || 0) * 100);
    $('#dlFill').style.width = pct + '%';
    $('#dlBar').setAttribute('aria-valuenow', String(pct));
    $('#dlLabel').textContent = j.label || '';
    if (j.status === 'done') break;
    if (j.status === 'error') throw new Error(j.error || j.label || 'Download failed');
    await new Promise(r => setTimeout(r, 400));
  }
  const cat = await api('/api/sync-models');
  S.cfg.sync_models = cat.models; S.cfg.aligner = cat.aligner; S.cfg.sync_default = cat.default;
  fillModels();
  $('#modelIn').value = id;
  hintModel();
  $('#dlLabel').textContent = 'Saved on this computer. Later syncs stay offline.';
}

// ---------- sync ----------
$('#syncBtn').onclick = async () => {
  if (!S.audio) return;
  const sep = $('#sepIn').checked;
  $('#syncBtn').disabled = true; emit('sync-start');
  setSyncStatus('', '');
  try {
    await ensureModels();
    setSyncStatus('', (sep ? 'Isolating vocals, then locking the lyrics to the vocal. ' : 'Locking lyrics to the clip. ') + 'This stays on this computer.');
    const r = await api('/api/sync', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({audio_id: S.audio.id, start: S.start, length: S.len, lyrics: $('#lyricsIn').value,
        separate_vocals: sep, model: $('#modelIn').value})});
    S.lines = r.lines || []; S.len = r.length;
    const kind = r.status === 'ok' ? 'ok' : r.status === 'failed' ? 'bad' : 'warn';
    let msg = r.message || 'Sync finished.';
    const bits = [];
    if (r.timing && r.timing.align_s) bits.push(`align ${r.timing.align_s}s`);
    if (r.timing && r.timing.asr_s) bits.push(`listen ${r.timing.asr_s}s`);
    if (bits.length) msg += ` (${bits.join(', ')})`;
    setSyncStatus(kind, msg);
    renderLines(); emit('sync-done', r);
    if (S.lines.length) {
      $('#step3').classList.remove('hidden'); $('#step4').classList.remove('hidden');
      updateStage(); const f0 = S.lines[0]?.words[0]; updatePreview(f0 ? +f0.start + 0.4 : 0);
      window.ED && ED.seek(f0 ? +f0.start + 0.6 : 0);
    }
  } catch (e) { setSyncStatus('bad', e.message); emit('error', {where: 'sync', message: e.message}); }
  $('#syncBtn').disabled = false;
};

// ---------- editor ----------
function renderLines() {
  const box = $('#lines'); box.innerHTML = '';
  S.lines.forEach((ln, li) => {
    const d = document.createElement('div'); d.className = 'line' + (ln.low_confidence ? ' lowconf' : '');
    d.innerHTML = `<div class="lhead">${li + 1}<button title="Merge with line above" data-a="merge">⤒</button><button title="Delete line" data-a="del">🗑</button></div>`;
    d.querySelector('[data-a=merge]').onclick = () => { if (li > 0) { S.lines[li - 1].words.push(...ln.words); S.lines.splice(li, 1); renderLines(); } };
    d.querySelector('[data-a=del]').onclick = () => { S.lines.splice(li, 1); renderLines(); };
    ln.words.forEach((w, wi) => {
      const unsure = w.matched === false || (w.confidence != null && +w.confidence < 0.18);
      const wd = document.createElement('div'); wd.className = 'word' + (unsure ? ' lowconf' : '') + (w.matched === false ? ' guess' : '');
      wd.innerHTML = `<input class="wt" value="${esc(w.text)}" size="${Math.max(3, w.text.length)}">
        <div class="tt"><input type="number" step="0.01" value="${(+w.start).toFixed(2)}" title="start"><input type="number" step="0.01" value="${(+w.end).toFixed(2)}" title="end"></div>
        <div class="wa"><button title="Split line after this word">↵</button><button title="Insert word after">＋</button><button title="Delete word">✕</button></div>`;
      const [ti, si, ei] = wd.querySelectorAll('input');
      ti.oninput = () => { w.text = ti.value; ti.size = Math.max(3, ti.value.length); };
      si.onchange = () => { w.start = +si.value; window.ED && ED.onLyrics && ED.onLyrics(); };
      ei.onchange = () => { w.end = +ei.value; window.ED && ED.onLyrics && ED.onLyrics(); };
      const [bs, ba, bd] = wd.querySelectorAll('.wa button');
      bs.onclick = () => { if (wi < ln.words.length - 1) { S.lines.splice(li + 1, 0, {words: ln.words.splice(wi + 1)}); renderLines(); } };
      ba.onclick = () => { ln.words.splice(wi + 1, 0, {text: '…', start: w.end, end: w.end + 0.3}); renderLines(); };
      bd.onclick = () => { ln.words.splice(wi, 1); if (!ln.words.length) S.lines.splice(li, 1); renderLines(); };
      d.appendChild(wd);
    });
    box.appendChild(d);
  });
  window.ED && ED.onLyrics && ED.onLyrics();
}
function shiftAll(dt) { S.lines.forEach(l => l.words.forEach(w => { w.start = Math.max(0, +w.start + dt); w.end = Math.max(0, +w.end + dt); })); renderLines(); }
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
  const need = S.bgMode === 'video' && clips < 1 ? 'Add a video clip on the Timeline tab' : S.bgMode === 'image' && !S.bgId ? 'Upload a background image first' : '';
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
    $('#vLoopNote').innerHTML = (m.duration < S.len ? `Clip is ${m.duration.toFixed(1)}s, shorter than the ${S.len}s lyric clip. Duplicate it on the Timeline to fill the gap. ` : '') + 'Cut, reorder and zoom it on the <b>Timeline</b> tab.';
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

// ---------- tap to sync ----------
const Tap = {on: false, stamps: []};
function tapUnits() {
  const lines = $('#lyricsIn').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const mode = (document.querySelector('input[name=tapMode]:checked') || {}).value || 'line';
  if (mode === 'word') {
    const units = [];
    lines.forEach((line, li) => line.split(/\s+/).filter(Boolean).forEach(w => units.push({kind: 'word', text: w, line: li})));
    return units;
  }
  return lines.map((line, li) => ({kind: 'line', text: line, line: li}));
}
function tapNow() {
  if (!S.audio) return 0;
  return Math.max(0, Math.min(S.len, audio.currentTime - S.start));
}
function refreshTap() {
  const units = tapUnits();
  const n = Tap.stamps.length;
  const u = units[Math.min(n, Math.max(0, units.length - 1))];
  $('#tapCount').textContent = units.length ? `${Math.min(n, units.length)} / ${units.length}` : 'Paste lyrics first';
  if (!units.length) $('#tapCue').textContent = 'Paste lyrics above, one line each.';
  else if (n < units.length) $('#tapCue').textContent = u.text;
  else $('#tapCue').textContent = 'Last mark placed. Tap once more to close it, or press Done.';
}
function openTap() {
  if (!S.audio) return;
  Tap.on = true; Tap.stamps = [];
  $('#tapBox').classList.remove('hidden');
  refreshTap();
  if (audio.paused) playClip(false);
}
function tapMark() {
  if (!Tap.on || !S.audio) return;
  const units = tapUnits();
  if (Tap.stamps.length > units.length) return;
  Tap.stamps.push(+tapNow().toFixed(3));
  refreshTap();
}
function tapUndo() {
  if (!Tap.stamps.length || !S.audio) return;
  const t = Tap.stamps.pop();
  try { audio.currentTime = S.start + t; } catch (e) {}
  refreshTap();
}
function tapRestart() {
  Tap.stamps = [];
  refreshTap();
  stopPlay();
  if (S.audio) { audio.currentTime = S.start; playClip(false); }
}
function applyTap() {
  const raw = $('#lyricsIn').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const mode = (document.querySelector('input[name=tapMode]:checked') || {}).value || 'line';
  const units = tapUnits();
  const stamps = Tap.stamps.slice();
  if (!raw.length || !stamps.length) { setSyncStatus('bad', 'Tap at least the first line, then press Done.'); return; }
  const extra = stamps.length > units.length ? stamps[units.length] : null;
  const used = stamps.slice(0, units.length);
  let lines;
  if (mode === 'word') {
    const groups = raw.map(line => line.split(/\s+/).filter(Boolean));
    const flat = [];
    groups.forEach((words, li) => words.forEach(text => flat.push({li, text})));
    const buckets = groups.map(() => []);
    flat.forEach((w, i) => {
      if (used[i] == null) return;
      const nxt = used[i + 1] != null ? used[i + 1] : (i === flat.length - 1 && extra != null ? extra : null);
      const end = nxt != null ? nxt : Math.min(S.len, used[i] + 0.35);
      buckets[w.li].push({text: w.text, start: +used[i].toFixed(3), end: +Math.max(used[i] + 0.05, end).toFixed(3), confidence: 1, matched: true, source: 'tap'});
    });
    lines = groups.map((words, li) => {
      const ws = buckets[li];
      if (!ws.length) return null;
      const closed = ws.length === words.length && (li < groups.length - 1 || extra != null || stamps.length > units.length);
      return {words: ws, confidence: closed ? 1 : 0.5, low_confidence: !closed, source: 'tap'};
    }).filter(Boolean);
  } else {
    lines = raw.map((text, i) => {
      if (used[i] == null) return null;
      const words = text.split(/\s+/).filter(Boolean);
      const start = used[i];
      const next = used[i + 1] != null ? used[i + 1] : (i === raw.length - 1 && extra != null ? extra : null);
      const end = next != null ? next : Math.min(S.len, start + Math.max(0.4, words.length * 0.32));
      const span = Math.max(0.05 * words.length, end - start);
      const weights = words.map(w => Math.max(1, w.length));
      const tot = weights.reduce((a, b) => a + b, 0);
      let acc = start;
      const ws = words.map((w, k) => {
        const d = span * weights[k] / tot;
        const word = {text: w, start: +acc.toFixed(3), end: +(acc + d).toFixed(3), confidence: 1, matched: true, source: 'tap'};
        acc += d;
        return word;
      });
      const closed = next != null;
      return {words: ws, confidence: closed ? 1 : 0.5, low_confidence: !closed, source: 'tap'};
    }).filter(Boolean);
  }
  S.lines = lines;
  const low = lines.some(l => l.low_confidence);
  setSyncStatus(low ? 'warn' : 'ok', low
    ? `Tap wrote ${lines.length} lines. The last one is still open — tap once more as it ends, or press Done while it is playing.`
    : `Tap wrote ${lines.length} lines onto the timeline.`);
  renderLines(); emit('sync-done', {mode: 'tap', status: low ? 'low_confidence' : 'ok'});
  $('#step3').classList.remove('hidden'); $('#step4').classList.remove('hidden');
  updateStage();
  const f0 = S.lines[0] && S.lines[0].words[0];
  updatePreview(f0 ? +f0.start + 0.2 : 0);
  window.ED && ED.seek && ED.seek(f0 ? +f0.start : 0);
}
$('#tapBtn').onclick = openTap;
$('#tapHit').onclick = tapMark;
$('#tapUndo').onclick = tapUndo;
$('#tapRestart').onclick = tapRestart;
$('#tapDone').onclick = () => { if (Tap.on && Tap.stamps.length === tapUnits().length) Tap.stamps.push(+tapNow().toFixed(3)); applyTap(); };
document.querySelectorAll('input[name=tapMode]').forEach(r => r.addEventListener('change', () => { Tap.stamps = []; refreshTap(); }));
$('#lyricsIn').addEventListener('input', () => { if (Tap.on) refreshTap(); });
window.addEventListener('keydown', e => {
  if (!Tap.on || e.code !== 'Space' || e.repeat) return;
  const tag = (e.target && e.target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
  e.preventDefault();
  tapMark();
});

function bootShot() {
  const q = new URLSearchParams(location.search);
  if (q.get('shot') !== 'sync') return;
  document.body.classList.add('shot-sync');
  const sample = [
    {words: [{text: 'City', start: 0.45, end: 0.99, confidence: 0.9, matched: true}, {text: 'lights', start: 1.05, end: 1.64, confidence: 0.86, matched: true}], confidence: 0.88, low_confidence: false},
    {words: [{text: 'are', start: 1.7, end: 2.08, confidence: 0.56, matched: true}, {text: 'calling', start: 2.15, end: 3.26, confidence: 0.21, matched: true}], confidence: 0.38, low_confidence: true},
    {words: [{text: 'hold', start: 3.35, end: 3.78, confidence: 0.8, matched: true}, {text: 'on', start: 3.85, end: 4.23, confidence: 0.74, matched: true}], confidence: 0.77, low_confidence: false},
  ];
  S.lines = sample; S.len = 20; S.start = 0;
  $('#lyricsIn').value = 'City lights\nare calling\nhold on through the rain';
  if (!$('#modelIn').options.length) {
    $('#modelIn').innerHTML = '<option value="distil-large-v3" selected>Best · distil-large-v3</option><option value="medium">Accurate · medium</option><option value="small">Fast · small</option>';
  }
  $('#modelHint').textContent = 'Best quality that still runs on CPU. Saved on this computer.';
  $('#sepIn').checked = true;
  $('#syncBtn').disabled = false; $('#tapBtn').disabled = false;
  $('#dlBar').classList.remove('hidden');
  $('#dlFill').style.width = '100%';
  $('#dlLabel').textContent = 'Best is saved on this computer';
  $('#tapBox').classList.remove('hidden');
  $('#tapCue').textContent = 'are calling';
  $('#tapCount').textContent = '1 / 3';
  setSyncStatus('warn', 'Aligned 6 words. 1 line looks unsure and is highlighted on the timeline.');
  renderLines();
  const tab = document.querySelector('#edTabs button[data-tab=timeline]');
  if (tab) tab.click();
  window.ED && ED.onLyrics && ED.onLyrics();
}
bootShot();
setTimeout(bootShot, 400);
