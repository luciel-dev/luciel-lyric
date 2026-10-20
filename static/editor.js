/* Luciel Lyric step-4 editor: text animation library + customisation, video trim + keyframed zoom/pan,
   stackable post FX, saved presets, and the canvas preview stage. Uses globals from app.js (S, $, api, audio, ...). */
(function () {
  const LL = window.LL, LLFX = window.LLFX, ST = window.LLStage;
  const E = {look: 'neon', animId: 'karaoke', styleOv: {}, animOv: {}, palette: null, fx: [], zoom: {preset: 'none', keys: [], target: 'bg'},
    trimIn: 0, trimOut: null, sel: -1, t: 0, playing: false, eng: null, stage: null, pcm: null, pcmId: null, image: null, imageUrl: null, tab: 'text'};
  window.ED = {};
  const qa = s => [...document.querySelectorAll(s)];
  const fmtS = v => (+v).toFixed(2);
  const pct = v => Math.round(v * 100) + '%';

  // ---------- presets / resolve (same as app/textanim.resolve) ----------
  function resolve() {
    const P = E.eng, lk = P.looks[E.look] || P.looks.neon;
    const ap = P.anims.find(a => a.id === E.animId);
    const style = {...P.styleDefaults, ...lk.style, ...(ap?.style || {}), ...(E.palette?.colors || {}), ...E.styleOv};
    const anim = {...P.animDefaults, ...(ap?.anim || {}), ...E.animOv};
    style.fontId = S.fontId || '';
    return {style, anim, lk};
  }

  // ---------- control schema ----------
  const R = (k, label, min, max, step, f = v => (+v).toFixed(2)) => ({k, label, type: 'range', min, max, step, f});
  const C = (k, label) => ({k, label, type: 'color'});
  const B = (k, label) => ({k, label, type: 'check'});
  const Sl = (k, label, opts) => ({k, label, type: 'select', opts});
  const TEXT = [R('size', 'Size', 0.03, 0.2, 0.005, pct), Sl('weight', 'Weight', [[400, 'Regular'], [700, 'Bold'], [800, 'Extra bold']]),
    B('upper', 'UPPERCASE'), R('tracking', 'Letter spacing', -0.05, 0.3, 0.01), R('lineHeight', 'Line height', 0.9, 1.8, 0.02),
    R('maxWidth', 'Max width', 0.4, 0.98, 0.01, pct), R('posY', 'Vertical position', 0.15, 0.85, 0.01, pct),
    Sl('align', 'Align', [['center', 'Centre'], ['left', 'Left'], ['right', 'Right']]), B('showNext', 'Show next line'), R('nextAlpha', 'Next line opacity', 0, 1, 0.05, pct)];
  const COLOR = [C('color', 'Text'), R('unsungAlpha', 'Unsung opacity', 0, 1, 0.05, pct), C('active', 'Active word'), C('sung', 'Sung words'),
    C('strokeColor', 'Outline'), R('strokeWidth', 'Outline width', 0, 0.15, 0.005), C('shadowColor', 'Shadow'), R('shadowAlpha', 'Shadow opacity', 0, 1, 0.05, pct),
    R('shadowBlur', 'Shadow blur', 0, 0.15, 0.005), R('shadowY', 'Shadow offset', -0.1, 0.1, 0.005), C('glowColor', 'Glow'), R('glow', 'Glow amount', 0, 0.15, 0.005),
    R('glowAlpha', 'Glow opacity', 0, 1, 0.05, pct), C('boxColor', 'Highlight box'), C('boxText', 'Text on box'), R('boxAlpha', 'Box opacity', 0, 1, 0.05, pct), R('boxRadius', 'Box rounding', 0, 0.5, 0.01), R('boxPad', 'Box padding', 0, 0.4, 0.01)];
  const TITLE = [C('titleColor', 'Title colour'), B('titleGrad', 'Gradient fill'), C('titleColor2', 'Gradient bottom colour'),
    R('titleSize', 'Title size', 0.2, 1.2, 0.01, v => (+v).toFixed(2) + '× lyrics'), R('titlePosY', 'Title position (from top)', 0.02, 0.9, 0.01, pct),
    R('titleAlpha', 'Title opacity', 0, 1, 0.05, pct), Sl('titleWeight', 'Title weight', [[400, 'Regular'], [700, 'Bold'], [800, 'Extra bold']]), B('titleUpper', 'UPPERCASE title'),
    C('titleStrokeColor', 'Title outline'), R('titleStroke', 'Title outline width', 0, 0.15, 0.005), C('titleShadowColor', 'Title shadow'),
    R('titleShadowAlpha', 'Title shadow opacity', 0, 1, 0.05, pct), R('titleShadowBlur', 'Title shadow blur', 0, 0.3, 0.01)];
  let ANIM = [];
  function animSchema() {
    const P = E.eng, o = a => a.map(x => [x, x]);
    ANIM = [Sl('layout', 'Captions', [['line', 'Whole line'], ['chunk', 'Chunks of N words'], ['word', 'One word at a time']]), R('chunk', 'Words per chunk', 1, 6, 1, v => v),
      Sl('enter', 'Enter', o(P.enterTypes)), Sl('unit', 'Animate by', [['line', 'Line'], ['word', 'Word'], ['char', 'Letter']]),
      Sl('trigger', 'Start', [['line', 'When line appears'], ['word', 'When each word is sung']]), R('dur', 'Enter duration', 0, 1.2, 0.02, v => (+v).toFixed(2) + 's'),
      R('stagger', 'Stagger', 0, 0.2, 0.005, v => (+v).toFixed(3) + 's'), Sl('ease', 'Easing', o(P.eases)), R('dist', 'Travel distance', 0, 2, 0.05),
      Sl('active', 'Active word effect', o(P.activeTypes)), R('activeAmt', 'Effect strength', 0, 2, 0.05), Sl('idle', 'Idle motion', [['none', 'none'], ['wave', 'wave']]),
      R('idleAmt', 'Idle amount', 0, 3, 0.1), Sl('exit', 'Exit', o(P.exitTypes)), R('exitDur', 'Exit duration', 0, 1, 0.02, v => (+v).toFixed(2) + 's'),
      R('speed', 'Speed', 0.25, 3, 0.05, v => (+v).toFixed(2) + '×'), R('intensity', 'Intensity', 0, 2, 0.05, v => (+v).toFixed(2) + '×'), B('cursor', 'Typing cursor')];
  }
  function buildControls(box, schema, kind) {
    box.innerHTML = '';
    for (const c of schema) {
      const d = document.createElement('label'); d.className = 'ctl ctl-' + c.type; d.dataset.k = c.k; d.dataset.kind = kind;
      if (c.type === 'range') d.innerHTML = `<span>${c.label} <b></b></span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}">`;
      else if (c.type === 'color') d.innerHTML = `<span>${c.label}</span><input type="color">`;
      else if (c.type === 'check') d.innerHTML = `<input type="checkbox"><span>${c.label}</span>`;
      else d.innerHTML = `<span>${c.label}</span><select>${c.opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
      const inp = d.querySelector('input,select');
      inp.addEventListener('input', () => {
        let v = c.type === 'check' ? inp.checked : c.type === 'range' ? +inp.value : c.type === 'select' && typeof (kind === 'style' ? resolve().style : resolve().anim)[c.k] === 'number' ? +inp.value : inp.value;
        (kind === 'style' ? E.styleOv : E.animOv)[c.k] = v;
        if (c.type === 'range') d.querySelector('b').textContent = c.f(v);
        markDirty(); refresh();
      });
      d._c = c; box.appendChild(d);
    }
  }
  function syncControls() {
    const {style, anim} = resolve();
    for (const d of qa('.ctl')) {
      const c = d._c, v = (d.dataset.kind === 'style' ? style : anim)[c.k], inp = d.querySelector('input,select');
      if (c.type === 'check') inp.checked = !!v;
      else if (c.type === 'color') { const vv = c.k === 'boxText' && !v ? style.active : v; inp.value = /^#[0-9a-f]{6}$/i.test(vv) ? vv : '#ffffff'; }
      else { inp.value = v; if (c.type === 'range') d.querySelector('b').textContent = c.f(v); }
    }
    // hide irrelevant knobs
    const show = (k, on) => qa(`.ctl[data-k="${k}"]`).forEach(d => d.classList.toggle('dim', !on));
    show('chunk', anim.layout === 'chunk'); show('cursor', anim.enter === 'type');
    show('idleAmt', anim.idle !== 'none'); show('stagger', anim.unit !== 'line' || anim.trigger === 'line');
    for (const k of ['boxColor', 'boxAlpha', 'boxRadius', 'boxPad']) show(k, anim.active === 'box');
    show('nextAlpha', style.showNext && anim.layout === 'line');
    show('boxText', anim.active === 'box'); show('titleColor2', !!style.titleGrad);
    show('titleStrokeColor', style.titleStroke > 0); show('titleShadowColor', style.titleShadowAlpha > 0); show('titleShadowBlur', style.titleShadowAlpha > 0);
    palMarkSel();
  }

  // ---------- colour palettes ----------
  const PAL_KEY = 'lc-palettes';
  const customPals = () => { try { return JSON.parse(localStorage.getItem(PAL_KEY) || '[]').filter(p => p && p.id && p.colors); } catch (e) { return []; } };
  const storePals = l => { try { localStorage.setItem(PAL_KEY, JSON.stringify(l)); } catch (e) {} };
  const allPals = () => [...E.eng.palettes, ...customPals(), ...(E.autoPal ? [E.autoPal] : [])];
  function palCard(p) {
    const c = p.colors, b = document.createElement('button');
    b.className = 'palcard' + (p.id.startsWith('custom-') ? ' custom' : '') + (p.id === 'auto' ? ' auto' : ''); b.dataset.id = p.id; b.title = p.label;
    b.innerHTML = `<span class="palsw">${[c.color, c.active, c.sung, c.boxColor, c.titleColor].map(x => `<i style="background:${x}"></i>`).join('')}</span>` +
      `<span class="palname">${p.id.startsWith('custom-') ? '★ ' : p.id === 'auto' ? '✨ ' : ''}${esc(p.label)}</span>`;
    b.onclick = () => applyPalette(p);
    return b;
  }
  function buildPalettes() {
    const g = $('#palGrid'); g.innerHTML = '';
    const none = document.createElement('button'); none.className = 'palcard none'; none.dataset.id = '';
    none.innerHTML = '<span class="palsw"><i style="background:repeating-linear-gradient(45deg,#888 0 3px,#bbb 3px 6px)"></i></span><span class="palname">Look colours</span>';
    none.title = 'Use the colours of the selected look / animation preset';
    none.onclick = () => applyPalette(null); g.appendChild(none);
    allPals().forEach(p => g.appendChild(palCard(p)));
    $('#palDel').disabled = !(E.palette && E.palette.id.startsWith('custom-'));
    palMarkSel();
  }
  function palMarkSel() { qa('.palcard').forEach(b => b.classList.toggle('sel', (b.dataset.id || '') === (E.palette?.id || ''))); if ($('#palDel')) $('#palDel').disabled = !(E.palette && E.palette.id.startsWith('custom-')); }
  function applyPalette(p) {
    E.palette = p ? {id: p.id, label: p.label, colors: {...p.colors}} : null;
    for (const k of E.eng.paletteKeys) delete E.styleOv[k];   // one click = the palette wins; individual edits afterwards still override
    $('#palStatus').textContent = p ? `palette: ${p.label}` : 'look colours';
    markDirty(); syncControls(); refresh(); thumbLoop();
  }
  function saveCurrentPalette() {
    const {style} = resolve(), name = ($('#palName').value || '').trim() || `My palette ${customPals().length + 1}`;
    const colors = {}; for (const k of E.eng.paletteKeys) colors[k] = style[k] || (k === 'boxText' ? style.active : '#ffffff');
    const l = customPals().filter(p => p.label !== name); const p = {id: 'custom-' + Date.now().toString(36), label: name, colors};
    l.push(p); storePals(l); E.palette = p; for (const k of E.eng.paletteKeys) delete E.styleOv[k];
    buildPalettes(); $('#palStatus').textContent = `★ saved palette “${name}” (stored in this browser; also included in preset export)`;
  }
  function deletePalette() {
    if (!E.palette || !E.palette.id.startsWith('custom-')) return;
    storePals(customPals().filter(p => p.id !== E.palette.id)); $('#palStatus').textContent = `deleted “${E.palette.label}”`;
    E.palette = null; buildPalettes(); syncControls(); refresh(); thumbLoop();
  }
  // --- auto palette from the background (image, current video frame or gradient) ---
  const hsl2hex = (h, s, l) => { h = ((h % 360) + 360) % 360; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))); return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join(''); };
  function rgb2hsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l]; const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(h * 60 + 360) % 360, s, l]; }
  function paletteFromPixels(px) {
    const bins = new Float64Array(24), hs = new Float64Array(24), hc = new Float64Array(24); let lum = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [h, s, l] = rgb2hsl(px[i], px[i + 1], px[i + 2]); lum += l; n++;
      const w = s * (1 - Math.abs(2 * l - 1)) ** 0.5; if (w < 0.08) continue;   // ignore greys / near-black / near-white
      const bi = Math.floor(h / 15) % 24; bins[bi] += w; hs[bi] += h * w; hc[bi] += w;
    }
    lum /= Math.max(1, n);
    const order = [...bins.keys()].sort((a, b) => bins[b] - bins[a]);
    const hueOf = bi => hc[bi] ? hs[bi] / hc[bi] : 0;
    const total = bins.reduce((a, b) => a + b, 0);
    if (total < n * 0.01) {   // essentially grey footage: mono palette tinted to its brightness
      return {color: '#ffffff', active: '#ffffff', sung: '#c8c8c8', strokeColor: '#000000', glowColor: '#ffffff', shadowColor: '#000000', boxColor: lum > 0.5 ? '#111111' : '#ffffff',
        boxText: lum > 0.5 ? '#ffffff' : '#111111', titleColor: '#eeeeee', titleColor2: '#aaaaaa', titleStrokeColor: '#000000', titleShadowColor: '#000000'};
    }
    const h1 = hueOf(order[0]);
    const far = order.find(bi => bins[bi] > 0 && Math.min(Math.abs(hueOf(bi) - h1), 360 - Math.abs(hueOf(bi) - h1)) >= 50);
    const h2 = far !== undefined ? hueOf(far) : (h1 + 150) % 360;
    // lyrics must read on this background: light text + a vivid accent from the footage's main hue, dark outline/shadow
    const acc = hsl2hex(h1, 0.85, 0.62), acc2 = hsl2hex(h2, 0.75, 0.7), box = hsl2hex(h1, 0.8, 0.45);
    return {color: hsl2hex(h1, 0.4, 0.96), active: acc, sung: acc2, strokeColor: hsl2hex(h1, 0.5, 0.08), glowColor: acc, shadowColor: hsl2hex(h1, 0.6, 0.05),
      boxColor: box, boxText: '#ffffff', titleColor: hsl2hex(h2, 0.6, 0.86), titleColor2: acc, titleStrokeColor: hsl2hex(h1, 0.5, 0.08), titleShadowColor: hsl2hex(h1, 0.6, 0.05)};
  }
  function autoPalette() {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const c = cv.getContext('2d', {willReadFrequently: true});
    const v = $('#stageVideo'), lk = resolve().lk;
    let src = '';
    if (S.bgMode === 'image' && E.image && E.image.complete && E.image.naturalWidth) { c.drawImage(E.image, 0, 0, 64, 64); src = 'background image'; }
    else if (S.bgMode === 'video' && S.bgVideo && v.readyState >= 2) { c.drawImage(v, 0, 0, 64, 64); src = `video frame @ ${v.currentTime.toFixed(1)}s`; }
    else if (S.bgMode === 'gradient' || !S.bgMode) { const g = c.createLinearGradient(0, 0, 64, 64); (lk.grad || ['#000', '#fff']).forEach((x, i, a) => g.addColorStop(i / Math.max(1, a.length - 1), x)); c.fillStyle = g; c.fillRect(0, 0, 64, 64); src = 'gradient background'; }
    else { $('#palStatus').textContent = 'auto palette needs an image, video or gradient background'; return; }
    let px; try { px = c.getImageData(0, 0, 64, 64).data; } catch (e) { $('#palStatus').textContent = 'could not read the background pixels'; return; }
    E.autoPal = {id: 'auto', label: 'Auto (background)', colors: paletteFromPixels(px)};
    buildPalettes(); applyPalette(E.autoPal); $('#palStatus').textContent = `✨ palette extracted from the ${src}`;
  }
  function wirePalettes() {
    buildPalettes();
    $('#palAuto').onclick = autoPalette; $('#palSave').onclick = saveCurrentPalette; $('#palDel').onclick = deletePalette;
    // title text mirror (the canonical field is in Background & export)
    const t1 = $('#titleIn'), t2 = $('#titleIn2'), s1 = $('#showTitleIn'), s2 = $('#showTitleIn2');
    t2.value = t1.value; s2.checked = s1.checked;
    t2.addEventListener('input', () => { t1.value = t2.value; t1.dispatchEvent(new Event('input', {bubbles: true})); refresh(); });
    t1.addEventListener('input', () => { if (t2.value !== t1.value) t2.value = t1.value; });
    s2.addEventListener('change', () => { s1.checked = s2.checked; s1.dispatchEvent(new Event('change', {bubbles: true})); refresh(); });
    s1.addEventListener('change', () => { s2.checked = s1.checked; });
  }
  // title styling is independent of the look / animation preset, so switching those keeps it
  const keepTitle = () => Object.fromEntries(Object.entries(E.styleOv).filter(([k]) => k.startsWith('title')));
  let dirty = false;
  function markDirty() { dirty = true; $('#presetStatus').textContent = 'modified'; }

  // ---------- animation grid ----------
  function buildAnimGrid() {
    const g = $('#animGrid'); g.innerHTML = '';
    for (const a of E.eng.anims) {
      const b = document.createElement('button'); b.className = 'animcard' + (a.id === E.animId ? ' sel' : ''); b.dataset.id = a.id; b.title = a.desc;
      b.innerHTML = `<canvas width="132" height="64"></canvas><span>${a.label}</span>`;
      b.onclick = () => { E.animId = a.id; E.styleOv = keepTitle(); E.animOv = {}; dirty = false; $('#presetStatus').textContent = ''; qa('.animcard').forEach(x => x.classList.toggle('sel', x === b)); syncControls(); refresh(); };
      g.appendChild(b);
    }
    thumbLoop();
  }
  // tiny looping thumbnails: same engine on a 3-word demo line
  const DEMO = [{words: [{text: 'sing', start: 0.25, end: 0.6}, {text: 'it', start: 0.6, end: 0.85}, {text: 'loud', start: 0.85, end: 1.5}]}];
  let thumbT0 = performance.now(), thumbRaf = null;
  function thumbLoop() {
    cancelAnimationFrame(thumbRaf);
    const P = E.eng, lk = P.looks[E.look] || P.looks.neon;
    const scenes = qa('.animcard').map(b => {
      const a = P.anims.find(x => x.id === b.dataset.id), cv = b.querySelector('canvas');
      const style = {...P.styleDefaults, ...lk.style, ...(a.style || {}), ...(E.palette?.colors || {}), size: 0.3, showNext: false, posY: 0.55, maxWidth: 0.95};
      if (style.size > 0.3) style.size = 0.3;
      const anim = {...P.animDefaults, ...(a.anim || {})};
      const groups = LL.prepare(DEMO, style, anim, 2.2);
      return {cv, ctx: cv.getContext('2d'), sc: {W: cv.width, H: cv.height, style, anim, measure: ST.measure, groups, title: '', clipLen: 2.2, layKey: 'thumb'}};
    });
    const tick = () => {
      if (E.tab === 'text' && !document.hidden && $('#step4') && !$('#step4').classList.contains('hidden')) {
        const t = ((performance.now() - thumbT0) / 1000) % 2.2;
        for (const s of scenes) {
          s.ctx.clearRect(0, 0, s.cv.width, s.cv.height);
          ST.drawItems(s.ctx, LL.buildItems(t, s.sc).items);
        }
      }
      thumbRaf = setTimeout(() => requestAnimationFrame(tick), 40);
    };
    tick();
  }

  // ---------- saved presets ----------
  async function loadSaved(selectId) {
    let list = [];
    try { list = (await api('/api/presets')).presets; } catch (e) {}
    E.saved = list;
    $('#savedSel').innerHTML = list.length ? list.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('') : '<option value="">(none saved)</option>';
    if (selectId) $('#savedSel').value = selectId;
  }
  function presetData() {
    const {style, anim} = resolve(); const st = {...style}; delete st.fontId;
    return {app: 'Luciel Lyric', version: 1, look: E.look, animId: E.animId, style: st, anim, fx: E.fx.map(f => ({...f})),
      zoom: {preset: E.zoom.preset, target: E.zoom.target}, palette: E.palette ? {...E.palette, colors: {...E.palette.colors}} : null};
  }
  function applyPreset(d) {
    if (!d || typeof d !== 'object') throw new Error('not a Luciel Lyric preset');
    if (d.look && E.eng.looks[d.look]) { E.look = d.look; S.preset = d.look; qa('.preset').forEach((x, i) => x.classList.toggle('sel', Object.keys(S.cfg.presets)[i] === d.look)); }
    if (d.animId && E.eng.anims.some(a => a.id === d.animId)) E.animId = d.animId;
    E.styleOv = {...(d.style || {})}; E.animOv = {...(d.anim || {})};
    E.palette = d.palette && d.palette.colors ? {id: d.palette.id || 'custom-' + Date.now().toString(36), label: d.palette.label || 'Imported', colors: {...d.palette.colors}} : null;
    if (E.palette && E.palette.id.startsWith('custom-') && !customPals().some(p => p.id === E.palette.id)) storePals([...customPals(), E.palette]);
    if (E.palette && E.palette.id === 'auto') E.autoPal = E.palette;
    buildPalettes();
    if (Array.isArray(d.fx)) E.fx = defaultFx().map(f => ({...f, ...(d.fx.find(x => x.id === f.id) || {})}));
    if (d.zoom && d.zoom.preset) { E.zoom.target = d.zoom.target || 'bg'; setZoomPreset(d.zoom.preset); }
    qa('.animcard').forEach(x => x.classList.toggle('sel', x.dataset.id === E.animId));
    dirty = false; syncControls(); buildFx(); refresh(); thumbLoop();
  }
  function wirePresets() {
    $('#saveBtn').onclick = async () => {
      const name = $('#saveName').value.trim() || `${E.eng.anims.find(a => a.id === E.animId)?.label || 'Preset'} · ${E.look}`;
      try { const m = await api('/api/presets', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, data: presetData()})});
        await loadSaved(m.id); dirty = false; $('#presetStatus').textContent = `✅ saved “${m.name}”`; }
      catch (e) { $('#presetStatus').textContent = '❌ ' + e.message; }
    };
    $('#savedLoad').onclick = () => { const p = (E.saved || []).find(x => x.id === $('#savedSel').value); if (!p) return; applyPreset(p.data); $('#saveName').value = p.name; $('#presetStatus').textContent = `loaded “${p.name}”`; };
    $('#savedDel').onclick = async () => {
      const p = (E.saved || []).find(x => x.id === $('#savedSel').value); if (!p || !confirm(`Delete saved preset “${p.name}”?`)) return;
      try { await api(`/api/presets/${p.id}`, {method: 'DELETE'}); await loadSaved(); $('#presetStatus').textContent = `deleted “${p.name}”`; } catch (e) { $('#presetStatus').textContent = '❌ ' + e.message; }
    };
    $('#exportBtn').onclick = () => {
      const name = $('#saveName').value.trim() || 'luciel-preset';
      const blob = new Blob([JSON.stringify({name, kind: 'luciel-lyric-preset', data: presetData()}, null, 1)], {type: 'application/json'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name.replace(/[^\w.-]+/g, '_') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $('#importFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const j = JSON.parse(await f.text()); applyPreset(j.data || j); $('#saveName').value = j.name || f.name.replace(/\.json$/, ''); $('#presetStatus').textContent = `imported “${$('#saveName').value}” (click Save to keep it)`; }
      catch (er) { $('#presetStatus').textContent = '❌ ' + er.message; }
      e.target.value = '';
    };
    $('#resetBtn').onclick = () => { E.styleOv = {}; E.animOv = {}; E.palette = null; dirty = false; $('#presetStatus').textContent = 'reset'; syncControls(); refresh(); };
  }

  // ---------- FX ----------
  function defaultFx() { return E.eng.fx.map(f => ({id: f.id, on: false, amount: f.def, option: f.options ? f.options[0] : null})); }
  const FX_HELP = {grade: 'Colour grade', leaks: 'Drifting warm light leaks', streak: 'Horizontal anamorphic flare from bright lyrics', vignette: 'Darkened corners',
    vhs: 'Chroma bleed, scanlines, tracking band', glitch: 'RGB split, line jitter, block displacement', grain: 'Film grain'};
  const OPT_LABEL = {warm: 'Warm', cool: 'Cool', bw: 'Black & white', faded: 'Faded film', bursts: 'Bursts on line changes', constant: 'Constant'};
  function buildFx() {
    const box = $('#fxList'); box.innerHTML = '';
    for (const f of E.fx) {
      const def = E.eng.fx.find(x => x.id === f.id);
      const d = document.createElement('div'); d.className = 'fxrow'; d.dataset.id = f.id;
      d.innerHTML = `<label class="check"><input type="checkbox" ${f.on ? 'checked' : ''}> <b>${def.label}</b></label>
        ${def.options ? `<select>${def.options.map(o => `<option value="${o}" ${o === f.option ? 'selected' : ''}>${OPT_LABEL[o] || o}</option>`).join('')}</select>` : '<span></span>'}
        <input type="range" min="0" max="100" step="1" value="${f.amount}"><b class="amt">${f.amount}</b><small class="muted fxhelp">${FX_HELP[f.id] || ''}</small><small class="fxwarn"></small>`;
      const [cb, rg] = d.querySelectorAll('input'), sel = d.querySelector('select');
      cb.onchange = () => { f.on = cb.checked; markDirty(); fxState(); refresh(); };
      rg.oninput = () => { f.amount = +rg.value; d.querySelector('.amt').textContent = rg.value; if (!f.on) { f.on = true; cb.checked = true; } markDirty(); fxState(); refresh(); };
      if (sel) sel.onchange = () => { f.option = sel.value; markDirty(); fxState(); refresh(); };
      box.appendChild(d);
    }
    fxState();
  }
  function fxState() {
    const m = S.bgMode, blocked = [];
    for (const d of qa('.fxrow')) {
      const f = E.fx.find(x => x.id === d.dataset.id), ok = LLFX.allowed(f.id, f.option, m);
      d.classList.toggle('blocked', !ok); d.querySelectorAll('input').forEach(i => i.disabled = !ok && !(m === 'black' && f.id === 'grade'));
      d.querySelector('.fxwarn').textContent = ok ? '' : m === 'black' && f.id === 'grade' ? '⚠ Faded film lifts black: breaks Screen blending' : m === 'black' ? '⚠ would tint the black background' : '⚠ off for ' + m;
      if (!ok && f.on) blocked.push(E.eng.fx.find(x => x.id === f.id).label);
    }
    const w = $('#fxWarn');
    const msg = m === 'green' ? 'Green-screen export: post effects would colour the key and are disabled.'
      : m === 'transparent' ? 'Transparent export: post effects need an opaque frame and are disabled.'
      : m === 'black' ? 'Black overlay export: only effects that keep the background pure black (anamorphic streak, glitch, colour grade except Faded film) are available.' : '';
    w.innerHTML = msg + (blocked.length ? `<br><b>Will be skipped:</b> ${blocked.join(', ')}` : '');
    w.classList.toggle('hidden', !msg);
  }

  // ---------- zoom / trim ----------
  function setZoomPreset(id) {
    E.zoom.preset = id; $('#zoomPreset').value = id;
    const {style, anim} = resolve();
    E.zoom.keys = LL.zoomPreset(id, S.len || 20, LL.prepare(S.lines, style, anim, S.len || 20)).map(k => ({...k}));
    E.sel = -1; kfUI();
  }
  function kfUI() {
    const ks = E.zoom.keys;
    ks.sort((a, b) => a.t - b.t);
    $('#kfList').innerHTML = ks.length ? ks.map((k, i) => `<button class="kf ${i === E.sel ? 'sel' : ''}" data-i="${i}">${k.t.toFixed(2)}s · ×${k.z.toFixed(2)} · ${Math.round(k.x * 100)},${Math.round(k.y * 100)} · ${k.ease}</button>`).join('')
      : '<span class="muted small">No keyframes: the frame is static. Pick a preset or add one.</span>';
    qa('#kfList .kf').forEach(b => b.onclick = () => { E.sel = +b.dataset.i; seek(ks[E.sel].t); kfUI(); });
    const k = ks[E.sel];
    $('#kfEdit').classList.toggle('dim', !k);
    if (k) { $('#kfZ').value = k.z; $('#kfZVal').textContent = k.z.toFixed(2); $('#kfEase').value = k.ease; $('#kfT').value = k.t.toFixed(2); }
    const L = S.len || 20;
    $('#kfMarks').innerHTML = ks.map((k, i) => `<i class="${i === E.sel ? 'sel' : ''}" style="left:${(k.t / L * 100).toFixed(2)}%"></i>`).join('');
  }
  function keyAtPlayhead(create) {
    const ks = E.zoom.keys, i = ks.findIndex(k => Math.abs(k.t - E.t) < 0.05);
    if (i >= 0) { E.sel = i; return ks[i]; }
    if (!create) return null;
    const z = LL.zoomAt(E.t, ks), k = {t: +E.t.toFixed(3), z: +Math.max(1, z.z).toFixed(3), x: z.x, y: z.y, ease: 'inOutSine'};
    if (!ks.length) ks.push({t: 0, z: 1, x: 0.5, y: 0.5, ease: 'linear'});
    ks.push(k); ks.sort((a, b) => a.t - b.t); E.sel = ks.indexOf(k); E.zoom.preset = 'custom'; $('#zoomPreset').value = 'custom';
    return k;
  }
  function wireZoom() {
    const zp = $('#zoomPreset');
    zp.innerHTML = E.eng.zoomPresets.map(z => `<option value="${z.id}">${z.label}</option>`).join('') + '<option value="custom">Custom keyframes</option>';
    zp.onchange = () => { if (zp.value !== 'custom') setZoomPreset(zp.value); markDirty(); refresh(); };
    $('#zoomTarget').onchange = e => { E.zoom.target = e.target.value; refresh(); };
    $('#kfEase').innerHTML = E.eng.eases.map(e => `<option>${e}</option>`).join('');
    $('#kfAdd').onclick = () => { keyAtPlayhead(true); kfUI(); refresh(); };
    $('#kfDel').onclick = () => { if (E.sel >= 0) { E.zoom.keys.splice(E.sel, 1); E.sel = -1; E.zoom.preset = 'custom'; zp.value = 'custom'; kfUI(); refresh(); } };
    $('#kfClear').onclick = () => { setZoomPreset('none'); refresh(); };
    $('#kfZ').oninput = e => { const k = E.zoom.keys[E.sel] || keyAtPlayhead(true); k.z = +e.target.value; E.zoom.preset = 'custom'; zp.value = 'custom'; kfUI(); refresh(); };
    $('#kfEase').onchange = e => { const k = E.zoom.keys[E.sel]; if (k) { k.ease = e.target.value; kfUI(); refresh(); } };
    $('#kfT').onchange = e => { const k = E.zoom.keys[E.sel]; if (k) { k.t = Math.max(0, Math.min(S.len, +e.target.value)); kfUI(); E.sel = E.zoom.keys.indexOf(k); kfUI(); refresh(); } };
    // drag on the stage = move the focal point of the keyframe at the playhead
    const st = $('#stage'); let drag = null;
    st.addEventListener('pointerdown', e => {
      if (E.tab !== 'video') return;
      if (!audio.paused) stopPlay();
      const k = (E.sel >= 0 && Math.abs(E.zoom.keys[E.sel].t - E.t) < 0.05) ? E.zoom.keys[E.sel] : keyAtPlayhead(true);
      if (k.z < 1.01) k.z = 1.15;  // panning needs some zoom
      drag = {k, x: e.clientX, y: e.clientY, kx: k.x, ky: k.y}; st.setPointerCapture(e.pointerId); kfUI(); refresh();
    });
    st.addEventListener('pointermove', e => {
      if (!drag) return;
      const r = st.getBoundingClientRect(), k = drag.k, hw = 0.5 / k.z;
      k.x = Math.max(hw, Math.min(1 - hw, drag.kx - (e.clientX - drag.x) / r.width / k.z));
      k.y = Math.max(hw, Math.min(1 - hw, drag.ky - (e.clientY - drag.y) / r.height / k.z));
      E.zoom.preset = 'custom'; $('#zoomPreset').value = 'custom'; kfUI(); draw();
    });
    const end = () => { drag = null; };
    st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
    st.addEventListener('dblclick', () => { if (E.tab !== 'video') return; const k = keyAtPlayhead(false); if (k) { k.x = 0.5; k.y = 0.5; kfUI(); refresh(); } });
  }
  function trimUI() {
    const m = S.bgVideo, has = S.bgMode === 'video' && !!m;
    $('#trimEmpty').classList.toggle('hidden', has); $('#trimUI').classList.toggle('hidden', !has);
    if (!has) return;
    const D = m.duration, a = E.trimIn, b = E.trimOut ?? D;
    $('#trimSel').style.left = $('#trimIn').style.left = (a / D * 100) + '%';
    $('#trimOut').style.left = (b / D * 100) + '%'; $('#trimSel').style.width = ((b - a) / D * 100) + '%';
    $('#trimStrip .shade.l').style.width = (a / D * 100) + '%'; $('#trimStrip .shade.r').style.width = ((D - b) / D * 100) + '%';
    $('#trimInN').value = a.toFixed(1); $('#trimOutN').value = b.toFixed(1);
    const seg = b - a;
    $('#trimInfo').textContent = `segment ${seg.toFixed(1)}s` + (seg < S.len - 0.05 ? ` · loops ${Math.ceil(S.len / seg)}× over the ${S.len}s clip` : '');
  }
  function wireTrim() {
    const strip = $('#trimStrip'); let which = null;
    const at = e => { const r = strip.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (S.bgVideo?.duration || 0); };
    strip.addEventListener('pointerdown', e => {
      if (!S.bgVideo) return;
      const t = at(e), b = E.trimOut ?? S.bgVideo.duration;
      which = Math.abs(t - E.trimIn) <= Math.abs(t - b) ? 'in' : 'out'; strip.setPointerCapture(e.pointerId); move(e);
    });
    const move = e => {
      if (!which) return; const D = S.bgVideo.duration, t = at(e);
      if (which === 'in') E.trimIn = Math.min(t, (E.trimOut ?? D) - 0.3); else E.trimOut = Math.max(t, E.trimIn + 0.3);
      if (E.trimOut !== null && E.trimOut >= D - 0.05) E.trimOut = null;
      trimUI(); previewVideoAt(which === 'in' ? E.trimIn : (E.trimOut ?? D) - 0.05);
    };
    strip.addEventListener('pointermove', move);
    strip.addEventListener('pointerup', () => { which = null; seek(E.t); });
    $('#trimInN').onchange = e => { E.trimIn = Math.max(0, Math.min(+e.target.value, (E.trimOut ?? S.bgVideo.duration) - 0.3)); trimUI(); seek(E.t); };
    $('#trimOutN').onchange = e => { const D = S.bgVideo.duration, v = Math.min(D, Math.max(+e.target.value, E.trimIn + 0.3)); E.trimOut = v >= D - 0.05 ? null : v; trimUI(); seek(E.t); };
  }
  function previewVideoAt(vt) { const v = $('#stageVideo'); try { v.currentTime = vt; } catch (e) {} v.onseeked = () => { E.stage.cfg.video && E.stage.drawFrame(E.t); }; }

  // ---------- stage ----------
  function stageSize() {
    const a = $('#aspectIn').value;
    return a === '16:9' ? [768, 432, 1920] : a === '1:1' ? [576, 576, 1080] : [432, 768, 1080];
  }
  function refresh() {
    if (!E.eng || !E.stage) return;
    const [W, H, fullW] = stageSize(), a = $('#aspectIn').value, st = $('#stage');
    st.classList.toggle('r11', a === '1:1'); st.classList.toggle('r169', a === '16:9'); st.classList.toggle('checker', S.bgMode === 'transparent');
    st.classList.toggle('panmode', E.tab === 'video');
    E.stage.setSize(W, H, fullW);
    const {style, anim, lk} = resolve();
    const v = $('#stageVideo');
    if (S.bgMode === 'image' && S.bgImageUrl && E.imageUrl !== S.bgImageUrl) { E.imageUrl = S.bgImageUrl; E.image = new Image(); E.image.onload = () => draw(); E.image.src = S.bgImageUrl; }
    E.stage.setScene({look: E.look, style, anim, lines: S.lines || [], title: $('#showTitleIn').checked ? $('#titleIn').value : '', clipLen: S.len || 20,
      visualizer: $('#vizIn').checked, bgMode: S.bgMode, grad: lk.grad, wave: lk.wave, image: S.bgMode === 'image' ? E.image : null,
      video: S.bgMode === 'video' && S.bgVideo && v.readyState >= 2 ? v : null,
      trimIn: E.trimIn, trimOut: E.trimOut, darken: +$('#vDarkIn').value / 100, blur: +$('#vBlurIn').value,
      zoom: {keys: E.zoom.keys, target: E.zoom.target}, fx: E.fx});
    setAudioSlice();
    $('#scrub').max = S.len || 20;
    fxState(); trimUI(); syncControls(); kfUI();
    if (audio.paused) seek(E.t, true); else draw();
  }
  function setAudioSlice() {
    if (!E.pcm || !S.audio || E.pcmId !== S.audio.id) { E.stage.setAudio(null); return; }
    const sr = E.pcm.sr, i0 = Math.floor(S.start * sr);
    E.stage.setAudio(E.pcm.data.subarray(i0, i0 + Math.ceil((S.len + 1) * sr)), sr);
  }
  async function decodeAudio() {
    if (!S.audio) return;
    const id = S.audio.id;
    try {
      const buf = await (await fetch(`/api/audio/${id}`)).arrayBuffer();
      const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
      const ab = await ac.decodeAudioData(buf);
      const n = ab.length, out = new Float32Array(n), ch = ab.numberOfChannels;
      for (let c = 0; c < ch; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ch; }
      if (S.audio && S.audio.id === id) { E.pcm = {data: out, sr: ab.sampleRate}; E.pcmId = id; setAudioSlice(); draw(); }
    } catch (e) { console.warn('waveform decode failed', e); }
  }
  let drawPending = false;
  function draw() {
    if (drawPending) return; drawPending = true;
    requestAnimationFrame(() => {
      drawPending = false;
      const t0 = performance.now();
      E.stage.drawFrame(E.t);
      E.lastMs = performance.now() - t0;
      $('#stageTime').textContent = `${E.t.toFixed(1)}s`;
      const z = LL.zoomAt(E.t, E.zoom.keys), f = $('#focal');
      f.classList.toggle('hidden', E.tab !== 'video' || !E.zoom.keys.length);
      f.style.left = (z.x * 100) + '%'; f.style.top = (z.y * 100) + '%'; f.dataset.z = '×' + z.z.toFixed(2);
    });
  }
  function seek(t, quiet) {
    E.t = Math.max(0, Math.min(S.len || 20, t)); $('#scrub').value = E.t;
    const c = E.stage?.cfg;
    if (c && c.video) { const v = $('#stageVideo'), want = E.stage.videoTime(E.t); if (Math.abs(v.currentTime - want) > 0.02) { previewVideoAt(want); } }
    draw();
  }

  // ---------- tabs ----------
  function wireTabs() {
    qa('#edTabs button').forEach(b => b.onclick = () => {
      E.tab = b.dataset.tab;
      qa('#edTabs button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
      qa('.tabpane').forEach(p => p.classList.toggle('on', p.dataset.pane === E.tab));
      refresh();
    });
  }

  // ---------- public hooks used by app.js ----------
  Object.assign(window.ED, {
    init(cfg) {
      E.eng = cfg.engine; LLFX.setDefs(E.eng.fx); E.look = S.preset; E.fx = defaultFx();
      E.stage = new ST.Stage($('#stageCanvas'));
      animSchema();
      buildControls($('#ctlText'), TEXT, 'style'); buildControls($('#ctlColor'), COLOR, 'style'); buildControls($('#ctlAnim'), ANIM, 'anim');
      buildControls($('#ctlTitle'), TITLE, 'style');
      buildAnimGrid(); buildFx(); wirePresets(); wirePalettes(); wireZoom(); wireTrim(); wireTabs(); loadSaved();
      $('#scrub').oninput = e => { if (!audio.paused) stopPlay(); seek(+e.target.value); };
      $('#stageVideo').addEventListener('loadeddata', () => refresh());
      ST.loadFonts().then(() => { buildAnimGrid(); refresh(); });
      refresh();
    },
    refresh, seek,
    onLook() { E.look = S.preset; E.styleOv = keepTitle(); E.palette = null; dirty = false; thumbLoop(); syncControls(); refresh(); },
    onFont() { if (!E.stage) return; ST.loadFonts(resolve().style).then(refresh); },
    onAudio() { decodeAudio(); },
    onVideo(m) { E.trimIn = 0; E.trimOut = null; $('#trimThumbs').style.backgroundImage = m.thumbs_url ? `url(${m.thumbs_url})` : 'none'; trimUI(); },
    playFrom() { return E.t >= (S.len || 20) - 0.1 ? 0 : E.t; },
    onPlay(from) {
      E.playing = true; E.t = from;
      if (S.bgMode === 'video' && S.bgVideo) { const v = $('#stageVideo'); try { v.currentTime = E.stage.videoTime(from); } catch (e) {} v.play().catch(() => {}); }
    },
    onTick(t) {
      E.t = t; $('#scrub').value = t;
      if (S.bgMode === 'video' && S.bgVideo) { const v = $('#stageVideo'), want = E.stage.videoTime(t); if (Math.abs(v.currentTime - want) > 0.2) { try { v.currentTime = want; } catch (e) {} } }
      draw();
    },
    onStop() { E.playing = false; $('#stageVideo').pause(); },
    renderExtras() {
      const {style, anim} = resolve(); const st = {...style}; delete st.fontId;
      return {anim_preset: E.animId, style: st, anim, fx: E.fx.filter(f => f.on).map(f => ({id: f.id, amount: f.amount, option: f.option, on: true})),
        zoom: {keys: E.zoom.keys, target: E.zoom.target}, video_in: E.trimIn, video_out: E.trimOut};
    },
    state: () => E,
  });
})();
