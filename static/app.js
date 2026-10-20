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
  S.cfg = await api('/api/config');
  $('#modelIn').innerHTML = S.cfg.models.map(m => `<option ${m === 'base.en' ? 'selected' : ''}>${m}</option>`).join('');
  if (S.cfg.demucs) $('#sepIn').checked = true; else { $('#sepIn').disabled = true; $('#sepIn').parentElement.title = 'demucs not installed'; $('#sepIn').parentElement.style.opacity = .5; }
  const pc = $('#presets');
  for (const [k, p] of Object.entries(S.cfg.presets)) {
    const d = document.createElement('div');
    d.className = 'preset' + (k === S.preset ? ' sel' : '');
    d.style.background = `linear-gradient(135deg,${p.grad.join(',')})`;
    d.innerHTML = `<div class="pt" style="font-family:'${p.font}'">la la <i style="color:${p.hi}">love</i></div><small>${p.label}</small>`;
    d.onclick = () => { S.preset = k; document.querySelectorAll('.preset').forEach(x => x.classList.remove('sel')); d.classList.add('sel'); window.ED && ED.onLook(); applyFont(); };
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
  } catch (e) { $('#trackInfo').textContent = 'Upload failed: ' + e.message; emit('error', {where: 'upload', message: e.message}); return; }
  $('#trackInfo').innerHTML = `🎵 <b>${S.audio.name}</b> · ${fmt(S.audio.duration)}`;
  audio.src = `/api/audio/${S.audio.id}`;
  S.start = 0; S.len = Math.min(+$('#lenIn').value, S.audio.duration);
  $('#waveWrap').classList.remove('hidden'); $('#syncBtn').disabled = false;
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

// ---------- sync ----------
$('#syncBtn').onclick = async () => {
  const sep = $('#sepIn').checked;
  $('#syncBtn').disabled = true; emit('sync-start');
  $('#syncStatus').innerHTML = `<span class="spin"></span>${sep ? 'Isolating vocals + ' : ''}transcribing with word timestamps… (runs fully offline on this computer)`;
  try {
    const r = await api('/api/sync', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({audio_id: S.audio.id, start: S.start, length: S.len, lyrics: $('#lyricsIn').value,
        separate_vocals: sep, model: $('#modelIn').value})});
    S.lines = r.lines; S.len = r.length;
    const st = r.stats || {};
    let msg = `✅ ${r.mode === 'aligned_to_pasted_lyrics' ? `Aligned pasted lyrics: ${st.matched}/${st.ref_words_used} words matched to audio${st.matched < st.ref_words_used ? ' (rest interpolated, outlined orange)' : ''}` : `Transcribed ${st.hyp_words} words`} · ASR ${r.timing.asr_s}s`;
    if (r.vocal_separation) msg += ` · vocals isolated in ${r.timing.separation_s}s`;
    if (r.separation_error) msg += ` · ⚠ separation skipped: ${esc(r.separation_error.slice(0, 120))}`;
    $('#syncStatus').innerHTML = msg;
    renderLines(); emit('sync-done', r);
    $('#step3').classList.remove('hidden'); $('#step4').classList.remove('hidden');
    updateStage(); const f0 = S.lines[0]?.words[0]; updatePreview(f0 ? +f0.start + 0.4 : 0);
    window.ED && ED.seek(f0 ? +f0.start + 0.6 : 0);
  } catch (e) { $('#syncStatus').textContent = '❌ ' + e.message; emit('error', {where: 'sync', message: e.message}); }
  $('#syncBtn').disabled = false;
};

// ---------- editor ----------
function renderLines() {
  const box = $('#lines'); box.innerHTML = '';
  S.lines.forEach((ln, li) => {
    const d = document.createElement('div'); d.className = 'line';
    d.innerHTML = `<div class="lhead">${li + 1}<button title="Merge with line above" data-a="merge">⤒</button><button title="Delete line" data-a="del">🗑</button></div>`;
    d.querySelector('[data-a=merge]').onclick = () => { if (li > 0) { S.lines[li - 1].words.push(...ln.words); S.lines.splice(li, 1); renderLines(); } };
    d.querySelector('[data-a=del]').onclick = () => { S.lines.splice(li, 1); renderLines(); };
    ln.words.forEach((w, wi) => {
      const wd = document.createElement('div'); wd.className = 'word' + (w.matched === false ? ' guess' : '');
      wd.innerHTML = `<input class="wt" value="${esc(w.text)}" size="${Math.max(3, w.text.length)}">
        <div class="tt"><input type="number" step="0.01" value="${(+w.start).toFixed(2)}" title="start"><input type="number" step="0.01" value="${(+w.end).toFixed(2)}" title="end"></div>
        <div class="wa"><button title="Split line after this word">↵</button><button title="Insert word after">＋</button><button title="Delete word">✕</button></div>`;
      const [ti, si, ei] = wd.querySelectorAll('input');
      ti.oninput = () => { w.text = ti.value; ti.size = Math.max(3, ti.value.length); };
      si.onchange = () => w.start = +si.value; ei.onchange = () => w.end = +ei.value;
      const [bs, ba, bd] = wd.querySelectorAll('.wa button');
      bs.onclick = () => { if (wi < ln.words.length - 1) { S.lines.splice(li + 1, 0, {words: ln.words.splice(wi + 1)}); renderLines(); } };
      ba.onclick = () => { ln.words.splice(wi + 1, 0, {text: '…', start: w.end, end: w.end + 0.3}); renderLines(); };
      bd.onclick = () => { ln.words.splice(wi, 1); if (!ln.words.length) S.lines.splice(li, 1); renderLines(); };
      d.appendChild(wd);
    });
    box.appendChild(d);
  });
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
  $('#renderStatus').innerHTML = `<span class="spin"></span>Rendering ${Math.round(S.len * 30)} frames (animations + effects are drawn frame by frame; roughly as long as the clip)…`;
  try {
    const r = await api('/api/render', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(renderBody())});
    $('#renderStatus').textContent = `✅ Rendered in ${r.render_s}s (${r.fps} fps)` + (r.size_mb ? ` · ${r.size_mb} MB` : '') + (r.custom_font ? ` · font “${r.custom_font}” ✓` : '')
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
    bg_mode: vm, bg_id: vm === 'image' ? S.bgId : null, transparent_format: $('#alphaFmt').value,
    bg_video_id: vm === 'video' && S.bgVideo ? S.bgVideo.bg_video_id : null,
    video_darken: +$('#vDarkIn').value / 100, video_blur: +$('#vBlurIn').value,
    video_audio: $('#vMixIn').checked, video_volume: +$('#vVolIn').value / 100, ...(window.ED ? ED.renderExtras() : {})};
}
function setBgMode(m) {
  const wasOverlay = OVERLAY.includes(S.bgMode), isOverlay = OVERLAY.includes(m);
  S.bgMode = m; $('#bgMode').value = m;
  document.querySelectorAll('.bgopt').forEach(e => e.classList.toggle('on', e.dataset.mode === m));
  if (isOverlay && !wasOverlay) { $('#vizIn').checked = false; $('#showTitleIn').checked = false; }
  if (!isOverlay && wasOverlay) { $('#vizIn').checked = true; $('#showTitleIn').checked = true; }
  $('#renderBtn').textContent = m === 'transparent' ? `🎬 Render ${$('#alphaFmt').value.toUpperCase()} with alpha` : '🎬 Render MP4';
  validateRender(); updateStage();
}
function validateRender() {
  const need = S.bgMode === 'video' && !S.bgVideo ? 'Upload a background video first' : S.bgMode === 'image' && !S.bgId ? 'Upload a background image first' : '';
  $('#renderBtn').disabled = !!need; $('#renderBtn').title = need;
}
$('#bgMode').onchange = e => setBgMode(e.target.value);
$('#alphaFmt').onchange = () => setBgMode(S.bgMode);
['#vizIn', '#showTitleIn', '#titleIn', '#aspectIn'].forEach(s => $(s).addEventListener('input', updateStage));
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
    $('#vLoopNote').innerHTML = (m.duration < S.len ? `Clip is ${m.duration.toFixed(1)}s, shorter than the ${S.len}s lyric clip, so it will loop. ` : '') + 'Trim it and add zoom/pan in the <b>Video</b> tab.';
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
