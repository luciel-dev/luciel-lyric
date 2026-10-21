/* Luciel Lyric step-4 editor: Look (text + visualizer), static animation presets, a one-track
   timeline with zoom markers, quality presets, and the canvas preview. Uses globals from app.js. */
(function () {
  const LL = window.LL, LLFX = window.LLFX, ST = window.LLStage;
  const QUALITY = {
    draft: {label: 'Draft', scale: 0.5, fps: 24, crf: 28, maxrate: '2M'},
    standard: {label: 'Standard', scale: 1, fps: 30, crf: 20, maxrate: '6M'},
    high: {label: 'High', scale: 1, fps: 30, crf: 16, maxrate: '12M'},
    max: {label: 'Max', scale: 1, fps: 60, crf: 14, maxrate: '20M'},
  };
  const evenPx = n => { n = Math.round(n); if (n % 2) n -= 1; return Math.max(2, n); };
  const E = {look: 'neon', animId: 'karaoke', styleOv: {}, animOv: {}, palette: null, fx: [], zoom: {preset: 'none', keys: [], target: 'bg'},
    clips: [], selClip: -1, tlPps: 48, quality: 'standard', animLive: false,
    sel: -1, t: 0, playing: false, eng: null, stage: null, pcm: null, pcmId: null, image: null, imageUrl: null, tab: 'look',
    place: null, overlays: [], videoSkipped: false};
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
  const ARTIST = [C('artistColor', 'Artist colour'), R('artistSize', 'Artist size', 0.15, 0.9, 0.01, v => (+v).toFixed(2) + '× lyrics'),
    R('artistPosY', 'Artist position', 0.02, 0.9, 0.01, pct), R('artistAlpha', 'Artist opacity', 0, 1, 0.05, pct),
    Sl('artistWeight', 'Artist weight', [[400, 'Regular'], [700, 'Bold'], [800, 'Extra bold']]), B('artistUpper', 'UPPERCASE artist')];
  const VIZ = [Sl('vizStyle', 'Shape', [['line', 'Line'], ['bars', 'Bars'], ['mirror', 'Mirror']]), C('vizColor', 'Colour'),
    R('vizY', 'Position', 0.05, 0.98, 0.01, pct), R('vizH', 'Height', 0.03, 0.4, 0.01, pct), R('vizAlpha', 'Opacity', 0.05, 1, 0.05, pct)];
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
  const LINE_KEYS = new Set(['size', 'weight', 'upper', 'tracking', 'lineHeight', 'maxWidth', 'posY', 'align', 'color', 'unsungAlpha', 'active', 'sung', 'strokeColor', 'strokeWidth', 'shadowColor', 'shadowAlpha', 'shadowBlur', 'shadowY', 'glowColor', 'glow', 'glowAlpha']);
  function lineMode() { return $('#applyLine') && $('#applyLine').checked; }
  function lineIndex() { return Math.max(0, +(($('#linePick') && $('#linePick').value) || 0)); }
  function buildControls(box, schema, kind) {
    box.innerHTML = '';
    for (const c of schema) {
      const d = document.createElement('label'); d.className = 'ctl ctl-' + c.type; d.dataset.k = c.k; d.dataset.kind = kind;
      if (c.type === 'range') d.innerHTML = `<span>${c.label} <b></b></span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}">`;
      else if (c.type === 'color') d.innerHTML = `<span>${c.label}</span><input type="color">`;
      else if (c.type === 'check') d.innerHTML = `<input type="checkbox"><span>${c.label}</span>`;
      else d.innerHTML = `<span>${c.label}</span><select>${c.opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
      const inp = d.querySelector('input,select');
      d.title = c.label;
      inp.title = c.label;
      inp.addEventListener('input', () => {
        let v = c.type === 'check' ? inp.checked : c.type === 'range' ? +inp.value : c.type === 'select' && typeof (kind === 'style' ? resolve().style : resolve().anim)[c.k] === 'number' ? +inp.value : inp.value;
        if (kind === 'style' && LINE_KEYS.has(c.k) && lineMode()) {
          const ln = (S.lines || [])[lineIndex()];
          if (ln) { ln.style = Object.assign({}, ln.style || {}); ln.style[c.k] = v; }
        } else {
          (kind === 'style' ? E.styleOv : E.animOv)[c.k] = v;
          if (kind === 'style' && LINE_KEYS.has(c.k)) (S.lines || []).forEach(ln => { if (ln.style) delete ln.style[c.k]; });
        }
        if (c.type === 'range') d.querySelector('b').textContent = c.f(v);
        markDirty(); refresh();
        window.LCHist && LCHist.touch();
      });
      d._c = c; box.appendChild(d);
    }
  }
  function syncControls() {
    const {style, anim, lk} = resolve();
    for (const d of qa('.ctl')) {
      const c = d._c, ln = lineMode() ? (S.lines || [])[lineIndex()] : null;
      const merged = (ln && ln.style && ln.style[c.k] != null) ? ln.style[c.k] : (d.dataset.kind === 'style' ? style : anim)[c.k];
      const v = merged, inp = d.querySelector('input,select');
      if (c.type === 'check') inp.checked = !!v;
      else if (c.type === 'color') {
        let vv = c.k === 'boxText' && !v ? style.active : v;
        if (c.k === 'vizColor' && !v) vv = lk.wave;
        inp.value = /^#[0-9a-f]{6}$/i.test(vv) ? vv : '#ffffff';
      }
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
    markDirty(); syncControls(); refresh(); paintThumbs();
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
    E.palette = null; buildPalettes(); syncControls(); refresh(); paintThumbs();
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
  }
  // title, artist and visualizer styling survive a look / animation change
  const keepLayers = () => Object.fromEntries(Object.entries(E.styleOv).filter(([k]) => k.startsWith('title') || k.startsWith('artist') || k.startsWith('viz')));
  let dirty = false;
  function markDirty() { dirty = true; $('#presetStatus').textContent = 'modified'; }

  // ---------- animation grid ----------
  function buildAnimGrid() {
    const g = $('#animGrid'); g.innerHTML = '';
    for (const a of E.eng.anims) {
      const b = document.createElement('button'); b.className = 'animcard' + (a.id === E.animId ? ' sel' : ''); b.dataset.id = a.id; b.title = a.desc;
      b.innerHTML = `<canvas width="132" height="64"></canvas><span>${a.label}</span>`;
      b.onclick = () => {
        E.animId = a.id; E.styleOv = keepLayers(); E.animOv = {}; dirty = false; $('#presetStatus').textContent = '';
        E.animLive = true;
        qa('.animcard').forEach(x => x.classList.toggle('sel', x === b));
        syncControls(); refresh(); paintThumbs();
      };
      g.appendChild(b);
    }
    paintThumbs();
  }
  // Thumbnails stay on one frame. Only the card you click plays.
  const DEMO = [{words: [{text: 'sing', start: 0.25, end: 0.6}, {text: 'it', start: 0.6, end: 0.85}, {text: 'loud', start: 0.85, end: 1.5}]}];
  let thumbTimer = null;
  function thumbScenes() {
    const P = E.eng, lk = P.looks[E.look] || P.looks.neon;
    return qa('.animcard').map(b => {
      const a = P.anims.find(x => x.id === b.dataset.id), cv = b.querySelector('canvas');
      const style = {...P.styleDefaults, ...lk.style, ...(a.style || {}), ...(E.palette?.colors || {}), size: 0.3, showNext: false, posY: 0.55, maxWidth: 0.95};
      if (style.size > 0.3) style.size = 0.3;
      const anim = {...P.animDefaults, ...(a.anim || {})};
      const groups = LL.prepare(DEMO, style, anim, 2.2);
      return {id: a.id, cv, ctx: cv.getContext('2d'), sc: {W: cv.width, H: cv.height, style, anim, measure: ST.measure, groups, title: '', clipLen: 2.2, layKey: 'thumb'}};
    });
  }
  function paintThumbs() {
    clearTimeout(thumbTimer);
    const scenes = thumbScenes();
    const live = E.animLive ? E.animId : null;
    const t0 = performance.now();
    const drawOne = (s, t) => { s.ctx.clearRect(0, 0, s.cv.width, s.cv.height); ST.drawItems(s.ctx, LL.buildItems(t, s.sc).items); };
    const tick = () => {
      const show = E.tab === 'animate' && !document.hidden && $('#step4') && !$('#step4').classList.contains('hidden');
      const tLive = ((performance.now() - t0) / 1000) % 2.2;
      for (const s of scenes) drawOne(s, s.id === live && show ? tLive : 0.9);
      if (live && show) thumbTimer = setTimeout(() => requestAnimationFrame(tick), 40);
    };
    tick();
  }

  // Look cards are a single still: gradient, lyric line, and waveform. No timer.
  const LOOK_DEMO = [{words: [{text: 'la', start: 0.2, end: 0.55}, {text: 'la', start: 0.55, end: 0.9}, {text: 'love', start: 0.9, end: 1.7}]}];
  function paintThumbWave(ctx, W, H, style, wave) {
    const vizStyle = style.vizStyle || 'line';
    const vizY = style.vizY == null ? 0.86 : +style.vizY;
    const vizH = style.vizH == null ? 0.10 : +style.vizH;
    const vizA = style.vizAlpha == null ? 0.75 : +style.vizAlpha;
    const col = style.vizColor || wave || '#ffffff';
    let wh = Math.max(3, Math.round(H * Math.max(vizH, 0.08)));
    let y0 = Math.round(H * vizY - wh / 2);
    if (y0 < 2) y0 = 2;
    if (y0 + wh > H - 1) y0 = Math.max(2, H - 1 - wh);
    const amp = i => 0.28 + 0.72 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.17));
    ctx.save();
    ctx.globalAlpha = Math.max(0.2, Math.min(1, vizA));
    ctx.fillStyle = col;
    if (vizStyle === 'bars') {
      const nb = 16;
      for (let i = 0; i < nb; i++) {
        const x0 = Math.floor(i * W / nb), x1 = Math.floor((i + 1) * W / nb);
        const bh = Math.max(1, Math.round(amp(i) * wh));
        ctx.fillRect(x0 + 1, y0 + wh - bh, Math.max(1, x1 - x0 - 2), bh);
      }
    } else {
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        const hh = Math.max(0.6, amp(x / 3.2) * wh / 2);
        ctx.rect(x, y0 + (wh - 1) / 2 - hh + 0.5, 1, hh * 2);
      }
      ctx.fill();
      if (vizStyle === 'mirror') {
        ctx.globalAlpha *= 0.45;
        const y1 = Math.min(H - 3, y0 + Math.round(wh * 0.72));
        ctx.beginPath();
        for (let x = 0; x < W; x++) {
          const hh = Math.max(0.4, amp(x / 3.2) * wh * 0.22);
          ctx.rect(x, y1 - hh, 1, hh * 2);
        }
        ctx.fill();
      }
    }
    ctx.restore();
  }
  function paintLookThumbs() {
    if (!E.eng) return;
    const P = E.eng;
    for (const card of qa('#presets .preset')) {
      const lk = P.looks[card.dataset.id];
      const cv = card.querySelector('canvas');
      if (!lk || !cv) continue;
      const ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      const cols = lk.grad && lk.grad.length ? lk.grad : ['#111111', '#333333'];
      const g = ctx.createLinearGradient(0, 0, W, H);
      cols.forEach((c, i) => g.addColorStop(i / Math.max(1, cols.length - 1), c));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const ap = P.anims.find(a => a.id === (lk.anim || 'karaoke')) || P.anims[0];
      const style = {...P.styleDefaults, ...lk.style, size: 0.34, showNext: false, posY: 0.38, maxWidth: 0.94, titleAlpha: 0, artistAlpha: 0};
      const anim = {...P.animDefaults, ...(ap.anim || {}), idle: 'none', idleAmt: 0, cursor: false};
      const groups = LL.prepare(LOOK_DEMO, style, anim, 2.2);
      const sc = {W, H, style, anim, measure: ST.measure, groups, title: '', artist: '', clipLen: 2.2, layKey: 'lookthumb-' + card.dataset.id};
      paintThumbWave(ctx, W, H, lk.style || {}, lk.wave);
      ST.drawItems(ctx, LL.buildItems(1.35, sc).items);
    }
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
    if (d.look && E.eng.looks[d.look]) { E.look = d.look; S.preset = d.look; qa('.preset').forEach(x => x.classList.toggle('sel', x.dataset.id === d.look)); }
    if (d.animId && E.eng.anims.some(a => a.id === d.animId)) E.animId = d.animId;
    E.styleOv = {...(d.style || {})}; E.animOv = {...(d.anim || {})};
    E.palette = d.palette && d.palette.colors ? {id: d.palette.id || 'custom-' + Date.now().toString(36), label: d.palette.label || 'Imported', colors: {...d.palette.colors}} : null;
    if (E.palette && E.palette.id.startsWith('custom-') && !customPals().some(p => p.id === E.palette.id)) storePals([...customPals(), E.palette]);
    if (E.palette && E.palette.id === 'auto') E.autoPal = E.palette;
    buildPalettes();
    if (Array.isArray(d.fx)) E.fx = defaultFx().map(f => ({...f, ...(d.fx.find(x => x.id === f.id) || {})}));
    if (d.zoom && d.zoom.preset) { E.zoom.target = d.zoom.target || 'bg'; setZoomPreset(d.zoom.preset); }
    qa('.animcard').forEach(x => x.classList.toggle('sel', x.dataset.id === E.animId));
    E.animLive = false;
    dirty = false; syncControls(); buildFx(); refresh(); paintThumbs();
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
    $('#resetBtn').onclick = () => { E.styleOv = {}; E.animOv = {}; E.palette = null; dirty = false; $('#presetStatus').textContent = 'reset'; syncControls(); refresh(); paintThumbs(); };
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
    if (k) {
      $('#kfZ').value = k.z; $('#kfZVal').textContent = k.z.toFixed(2); $('#kfEase').value = k.ease; $('#kfT').value = k.t.toFixed(2);
      $('#kfX').value = k.x.toFixed(2); $('#kfY').value = k.y.toFixed(2);
    }
    const L = S.len || 20;
    $('#kfMarks').innerHTML = ks.map((k, i) => `<i class="${i === E.sel ? 'sel' : ''}" style="left:${(k.t / L * 100).toFixed(2)}%"></i>`).join('');
    const sum = $('#kfSummary');
    if (sum) {
      sum.innerHTML = ks.length ? ks.map((k, i) => `<button type="button" class="kf ${i === E.sel ? 'sel' : ''}" data-i="${i}">${k.t.toFixed(2)}s · ${k.z.toFixed(2)}× · ${k.ease}</button>`).join('')
        : '<span class="muted small">No zoom keyframes. The render stays at 1×.</span>';
      qa('#kfSummary .kf').forEach(b => b.onclick = () => { E.sel = +b.dataset.i; seek(ks[E.sel].t); kfUI(); });
    }
    qInfo();
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
    const setPan = (axis, v) => { const k = E.zoom.keys[E.sel]; if (!k) return; k[axis] = Math.max(0, Math.min(1, +v)); E.zoom.preset = 'custom'; zp.value = 'custom'; kfUI(); refresh(); };
    $('#kfX').onchange = e => setPan('x', e.target.value);
    $('#kfY').onchange = e => setPan('y', e.target.value);
    // drag on the stage = move the focal point of the keyframe at the playhead
    const st = $('#stage'); let drag = null;
    st.addEventListener('pointerdown', e => {
      if (e.target.closest('#vidHandle') || e.target.closest('.moveable-control') || e.target.closest('#ovHandle')) return;
      if (!$('#camPan') || !$('#camPan').checked || (window.LCFlow && LCFlow.step() !== 3)) return;
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
    st.addEventListener('dblclick', e => {
      if (e.target.closest('#vidHandle')) return;
      if (!$('#camPan') || !$('#camPan').checked) return;
      const k = keyAtPlayhead(false); if (k) { k.x = 0.5; k.y = 0.5; kfUI(); refresh(); }
    });
  }
  function qInfo() {
    const q = QUALITY[E.quality] || QUALITY.standard;
    const aspect = $('#aspectIn') ? $('#aspectIn').value : '9:16';
    const base = aspect === '16:9' ? [1920, 1080] : aspect === '1:1' ? [1080, 1080] : aspect === '4:5' ? [1080, 1350] : [1080, 1920];
    const info = $('#qInfo');
    if (info) info.textContent = `${q.label}: ${evenPx(base[0] * q.scale)}×${evenPx(base[1] * q.scale)} · ${q.fps} fps · CRF ${q.crf} · max ${q.maxrate}`;
    qa('#qRow button').forEach(b => b.classList.toggle('on', b.dataset.q === E.quality));
  }
  function wireQuality() {
    qa('#qRow button').forEach(b => b.onclick = () => { E.quality = b.dataset.q; qInfo(); refresh(); });
    qInfo();
  }

  // ---------- one-track timeline ----------
  function clipSpan(c) { return Math.max(0, (c.out ?? c.duration) - c.in); }
  function clipAtTime(t) {
    let hit = null;
    E.clips.forEach((c, i) => { const d = clipSpan(c); if (c.start <= t && t < c.start + d - 1e-6) hit = {i, c, local: t - c.start}; });
    return hit;
  }
  function unoverlap(i) {
    const c = E.clips[i]; if (!c) return;
    const d = clipSpan(c);
    for (let guard = 0; guard < 8; guard++) {
      const j = E.clips.findIndex((o, k) => k !== i && c.start < o.start + clipSpan(o) - 1e-4 && o.start < c.start + d - 1e-4);
      if (j < 0) break;
      const o = E.clips[j], after = o.start + clipSpan(o), before = o.start - d;
      c.start = (before >= 0 && Math.abs(before - c.start) <= Math.abs(after - c.start)) ? before : after;
    }
    c.start = Math.max(0, c.start);
  }
  let tlDrag = null;
  function tlTime(e) {
    const track = $('#tlTrack') || $('#tlInner');
    const r = track.getBoundingClientRect();
    return Math.max(0, (e.clientX - r.left) / E.tlPps);
  }
  function tlHead() {
    const head = $('#tlHead');
    if (head) head.style.left = (68 + E.t * E.tlPps) + 'px';
  }
  function tlRender() {
    const inner = $('#tlInner'); if (!inner) return;
    if (tlDrag) { tlHead(); return; }
    const pps = E.tlPps;
    const end = E.clips.reduce((m, c) => Math.max(m, c.start + clipSpan(c)), S.len || 20);
    const w = Math.max(320, Math.ceil(end) * pps + 24);
    inner.style.width = w + 'px';
    let ruler = '';
    for (let s = 0; s <= Math.ceil(end); s++) ruler += `<i style="left:${s * pps}px">${s}s</i>`;
    $('#tlRuler').innerHTML = ruler;
    $('#tlTrack').innerHTML = E.clips.map((c, i) => {
      const d = clipSpan(c);
      const bg = c.thumbs ? `background-image:url(${c.thumbs});background-size:auto 100%;background-repeat:repeat-x;` : '';
      return `<div class="tlclip${i === E.selClip ? ' sel' : ''}" data-i="${i}" style="left:${c.start * pps}px;width:${Math.max(24, d * pps)}px;${bg}"><i class="edge in" data-edge="in"></i><span class="nm">${esc(c.name || 'clip')}</span><i class="edge out" data-edge="out"></i></div>`;
    }).join('');
    const lane = $('#tlLane');
    if (lane) lane.innerHTML = E.zoom.keys.map((k, i) => `<i class="tlkf${i === E.sel ? ' sel' : ''}" data-i="${i}" style="left:${k.t * pps}px" title="${k.t.toFixed(2)}s ×${k.z.toFixed(2)}"></i>`).join('');
    const texts = $('#tlTexts');
    if (texts) {
      texts.innerHTML = (E.overlays || []).map(o => {
        const a = +o.start || 0;
        const b = Math.max(a + 0.1, +o.end || 0);
        return `<div class="tlov" style="left:${a * pps}px;width:${Math.max(18, (b - a) * pps)}px" title="${esc(o.text)}"><span>${esc(o.text)}</span></div>`;
      }).join('');
    }
    const audioLane = $('#tlAudio');
    if (audioLane) {
      const dur = Math.max(S.len || 20, E.clips.reduce((m, c) => Math.max(m, c.start + clipSpan(c)), 0));
      audioLane.innerHTML = `<div class="tlaudio" style="width:${Math.max(24, dur * pps)}px"></div>`;
    }
    const lyricLane = $('#tlLyrics');
    if (lyricLane) {
      lyricLane.innerHTML = (S.lines || []).map((ln, i) => {
        const words = ln.words || [];
        if (!words.length) return '';
        const a = +words[0].start, b = +words[words.length - 1].end;
        const text = words.map(w => w.text).join(' ');
        return `<button type="button" class="tllyric${ln.low_confidence ? ' low' : ''}" data-i="${i}" style="left:${a * pps}px;width:${Math.max(18, (b - a) * pps)}px" title="${esc(text)}"><span>${esc(text)}</span></button>`;
      }).join('');
    }
    tlHead();
    if (!tlDrag) pushAtl();
  }
  function splitClip() {
    const hit = clipAtTime(E.t);
    if (!hit) { $('#tlStatus').textContent = 'Move the playhead over a clip to cut it.'; return; }
    const dur = clipSpan(hit.c), local = E.t - hit.c.start;
    if (local < 0.12 || dur - local < 0.12) { $('#tlStatus').textContent = 'That cut is too close to a clip edge.'; return; }
    const c = hit.c;
    const a = {...c, out: +(c.in + local).toFixed(3)};
    const b = {...c, id: c.id + 'b' + Math.random().toString(36).slice(2, 5), in: +(c.in + local).toFixed(3), start: +(c.start + local).toFixed(3)};
    E.clips.splice(hit.i, 1, a, b); E.selClip = hit.i + 1;
    $('#tlStatus').textContent = `Cut at ${E.t.toFixed(2)}s.`;
    tlRender(); refresh();
  }
  function addClip(meta) {
    const dur = Math.max(0.2, +meta.duration || 1);
    const L = S.len || 20;
    const end = E.clips.reduce((m, c) => Math.max(m, c.start + clipSpan(c)), 0);
    E.clips.push({id: 'c' + Math.random().toString(36).slice(2, 8), videoId: meta.bg_video_id, name: meta.name || 'clip',
      duration: dur, in: 0, out: Math.min(dur, L), start: E.clips.length ? end : 0, url: meta.preview_url, thumbs: meta.thumbs_url || ''});
    E.selClip = E.clips.length - 1;
    S.bgVideo = meta;
    $('#tlStatus').textContent = `Added “${meta.name || 'clip'}”. Drag the edges to trim it.`;
    if (S.bgMode !== 'video') setBgMode('video');
    else refresh();
    if (typeof validateRender === 'function') validateRender();
    window.LCFlow && LCFlow.hints();
    window.LCHist && LCHist.capture();
  }
  function wireTimeline() {
    $('#tlSplit').onclick = splitClip;
    $('#tlDelete').onclick = () => {
      if (E.selClip < 0) return;
      E.clips.splice(E.selClip, 1); E.selClip = Math.min(E.selClip, E.clips.length - 1);
      $('#tlStatus').textContent = E.clips.length ? 'Clip deleted.' : 'Timeline is empty.';
      tlRender(); refresh(); if (typeof validateRender === 'function') validateRender();
      window.LCFlow && LCFlow.hints();
    };
    $('#tlDup').onclick = () => {
      const i = E.selClip >= 0 ? E.selClip : E.clips.length - 1;
      const c = E.clips[i]; if (!c) return;
      const copy = {...c, id: c.id + 'd' + Math.random().toString(36).slice(2, 5), start: c.start + clipSpan(c)};
      E.clips.splice(i + 1, 0, copy); unoverlap(i + 1); E.selClip = i + 1;
      $('#tlStatus').textContent = 'Duplicated. Short clips do not loop — place the copy where you need it.';
      tlRender(); refresh();
    };
    $('#tlAdd').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      $('#tlStatus').innerHTML = `<span class="spin"></span>Uploading ${esc(f.name)}…`;
      const fd = new FormData(); fd.append('file', f);
      try {
        const m = await api('/api/bgvideo', {method: 'POST', body: fd});
        $('#bgVideoName').textContent = `🎞 ${m.name} · ${m.duration.toFixed(1)}s · ${m.width}×${m.height}${m.has_audio ? '' : ' · no audio'}`;
        $('#vMixIn').disabled = !m.has_audio;
        addClip(m);
      } catch (er) { $('#tlStatus').textContent = '❌ ' + er.message; }
      e.target.value = '';
    };
    $('#tlZoom').oninput = e => { E.tlPps = +e.target.value; tlRender(); };
    const sc = $('#tlScroll');
    sc.addEventListener('pointerdown', e => {
      if (!audio.paused) stopPlay();
      const clipEl = e.target.closest('.tlclip');
      const kf = e.target.closest('.tlkf');
      if (kf) {
        E.sel = +kf.dataset.i; kfUI(); tlRender();
        tlDrag = {kind: 'kf', i: E.sel, x0: e.clientX, t0: E.zoom.keys[E.sel].t};
        sc.setPointerCapture(e.pointerId); return;
      }
      if (clipEl) {
        const i = +clipEl.dataset.i, c = E.clips[i];
        const edge = e.target.closest('[data-edge]');
        const kind = edge ? edge.dataset.edge : 'move';
        E.selClip = i; tlRender();
        tlDrag = {kind, i, x0: e.clientX, start: c.start, inn: c.in, out: c.out, dur: c.duration, lyric: JSON.stringify(S.lines), style: JSON.stringify(E.styleOv)};
        sc.setPointerCapture(e.pointerId); return;
      }
      const lyric = e.target.closest('.tllyric');
      if (lyric) {
        const ln = (S.lines || [])[+lyric.dataset.i];
        const t = ln && ln.words && ln.words[0] ? +ln.words[0].start : 0;
        seek(Math.max(0, Math.min(S.len || 20, t)));
        return;
      }
      if (e.target.closest('.tllane')) {
        E.t = Math.max(0, Math.min(S.len || 20, tlTime(e)));
        $('#scrub').value = E.t;
        keyAtPlayhead(true); kfUI(); refresh(); return;
      }
      tlDrag = {kind: 'scrub'};
      seek(Math.max(0, Math.min(S.len || 20, tlTime(e))));
      sc.setPointerCapture(e.pointerId);
    });
    sc.addEventListener('pointermove', e => {
      if (!tlDrag) return;
      const dt = (e.clientX - tlDrag.x0) / E.tlPps;
      if (tlDrag.kind === 'scrub') { seek(Math.max(0, Math.min(S.len || 20, tlTime(e)))); return; }
      if (tlDrag.kind === 'kf') {
        const k = E.zoom.keys[tlDrag.i]; if (!k) return;
        k.t = Math.max(0, Math.min(S.len || 20, tlDrag.t0 + dt));
        E.zoom.preset = 'custom'; $('#zoomPreset').value = 'custom';
        const node = $('#tlLane').querySelector(`.tlkf[data-i="${tlDrag.i}"]`);
        if (node) node.style.left = (k.t * E.tlPps) + 'px';
        $('#kfT').value = k.t.toFixed(2);
        return;
      }
      const c = E.clips[tlDrag.i]; if (!c) return;
      if (tlDrag.kind === 'move') c.start = Math.max(0, tlDrag.start + dt);
      else if (tlDrag.kind === 'out') c.out = Math.max(tlDrag.inn + 0.12, Math.min(tlDrag.dur, tlDrag.out + dt));
      else {
        let inn = tlDrag.inn + dt, start = tlDrag.start + dt;
        if (inn < 0) { start -= inn; inn = 0; }
        if (inn > tlDrag.out - 0.12) { start -= inn - (tlDrag.out - 0.12); inn = tlDrag.out - 0.12; }
        if (start < 0) { inn = Math.max(0, inn - start); start = 0; }
        c.in = inn; c.start = start; c.out = tlDrag.out;
      }
      const node = $('#tlTrack').querySelector(`.tlclip[data-i="${tlDrag.i}"]`);
      if (node) { node.style.left = (c.start * E.tlPps) + 'px'; node.style.width = Math.max(8, clipSpan(c) * E.tlPps) + 'px'; }
    });
    const endDrag = () => {
      if (!tlDrag) return;
      const kind = tlDrag.kind, i = tlDrag.i, lyric = tlDrag.lyric, style = tlDrag.style;
      tlDrag = null;
      if (lyric && JSON.stringify(S.lines) !== lyric) S.lines = JSON.parse(lyric);
      if (style && JSON.stringify(E.styleOv) !== style) E.styleOv = JSON.parse(style);
      if (kind === 'move' || kind === 'in') unoverlap(i);
      if (kind === 'kf') { E.zoom.keys.sort((a, b) => a.t - b.t); E.sel = E.zoom.keys.findIndex(k => Math.abs(k.t - +$('#kfT').value) < 0.02); }
      tlRender(); refresh();
    };
    sc.addEventListener('pointerup', endDrag); sc.addEventListener('pointercancel', endDrag);
  }
  function previewVideoAt(vt) { const v = $('#stageVideo'); try { v.currentTime = vt; } catch (e) {} v.onseeked = () => { E.stage && E.stage.cfg && E.stage.cfg.video && E.stage.drawFrame(E.t); }; }

  // ---------- stage ----------
  function stageSize() {
    const a = $('#aspectIn').value;
    if (a === '16:9') return [768, 432, 1920];
    if (a === '1:1') return [576, 576, 1080];
    if (a === '4:5') return [540, 675, 1080];
    return [432, 768, 1080];
  }
  function refresh() {
    if (!E.eng || !E.stage) return;
    const [W, H, fullW] = stageSize(), a = $('#aspectIn').value, st = $('#stage');
    st.classList.toggle('r11', a === '1:1'); st.classList.toggle('r169', a === '16:9'); st.classList.toggle('r45', a === '4:5'); st.classList.toggle('checker', S.bgMode === 'transparent');
    st.classList.toggle('panmode', !!($('#camPan') && $('#camPan').checked && window.LCFlow && LCFlow.step() === 3));
    E.stage.setSize(W, H, fullW);
    const {style, anim, lk} = resolve();
    const v = $('#stageVideo');
    const hit = S.bgMode === 'video' ? clipAtTime(E.t) : null;
    if (hit && v.dataset.vid !== hit.c.videoId) { v.dataset.vid = hit.c.videoId; v.src = hit.c.url; try { v.load(); } catch (e) {} }
    if (S.bgMode === 'image' && S.bgImageUrl && E.imageUrl !== S.bgImageUrl) { E.imageUrl = S.bgImageUrl; E.image = new Image(); E.image.onload = () => draw(); E.image.src = S.bgImageUrl; }
    const q = QUALITY[E.quality] || QUALITY.standard;
    E.stage.setScene({look: E.look, style, anim, lines: S.lines || [], title: $('#showTitleIn').checked ? $('#titleIn').value : '',
      artist: $('#showArtistIn').checked ? $('#artistIn').value : '', clipLen: S.len || 20, fps: q.fps,
      visualizer: $('#vizIn').checked, bgMode: S.bgMode, grad: lk.grad, wave: lk.wave, image: S.bgMode === 'image' ? E.image : null,
      video: hit && v.readyState >= 2 && v.dataset.vid === hit.c.videoId ? v : null,
      clip: hit ? {in: hit.c.in, out: hit.c.out, start: hit.c.start, place: E.place} : null,
      place: E.place, overlays: E.overlays,
      trimIn: 0, trimOut: null, darken: +$('#vDarkIn').value / 100, blur: +$('#vBlurIn').value,
      zoom: {keys: E.zoom.keys, target: 'bg'}, fx: E.fx});
    setAudioSlice();
    $('#scrub').max = S.len || 20;
    fxState(); syncControls(); kfUI(); tlRender();
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
      f.classList.toggle('hidden', E.tab !== 'timeline' || !E.zoom.keys.length);
      f.style.left = (z.x * 100) + '%'; f.style.top = (z.y * 100) + '%'; f.dataset.z = '×' + z.z.toFixed(2);
      tlHead();
      layoutHandle();
    });
  }
  function seek(t, fromRefresh) {
    const before = clipAtTime(E.t);
    E.t = Math.max(0, Math.min(S.len || 20, t)); $('#scrub').value = E.t; tlHead();
    const after = clipAtTime(E.t);
    const same = (before && before.i) === (after && after.i);
    if (!fromRefresh && !same) { refresh(); return; }
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
      if (E.tab === 'animate') paintThumbs();
    });
  }

  // ---------- video layer (never writes lyric lines or lyric style) ----------
  function lyricGuard() { return JSON.stringify(S.lines) + '\n' + JSON.stringify(E.styleOv); }
  function lyricKeep(snap) {
    const cut = snap.indexOf('\n');
    const lines = snap.slice(0, cut), style = snap.slice(cut + 1);
    if (JSON.stringify(S.lines) !== lines) S.lines = JSON.parse(lines);
    if (JSON.stringify(E.styleOv) !== style) E.styleOv = JSON.parse(style);
  }
  function syncPlaceInputs() {
    if (!E.place) E.place = LLLayers.defaultPlace();
    const p = E.place;
    if ($('#fitSel')) $('#fitSel').value = p.fit;
    if ($('#scaleIn')) $('#scaleIn').value = (+p.scale).toFixed(2);
    if ($('#posX')) $('#posX').value = (+p.x).toFixed(2);
    if ($('#posY')) $('#posY').value = (+p.y).toFixed(2);
  }
  function layoutHandle() {
    const h = $('#vidHandle'), st = $('#stage'), v = $('#stageVideo');
    if (!h || !st) return;
    const show = window.LCFlow && LCFlow.step() === 3 && S.bgMode === 'video' && E.clips.length;
    h.classList.toggle('on', !!show);
    if (!show) return;
    const [W, H] = stageSize();
    const sw = (v && v.videoWidth) || 16, sh = (v && v.videoHeight) || 9;
    const box = LLLayers.placeBox(sw, sh, W, H, E.place);
    const r = st.getBoundingClientRect();
    if (!r.width || !r.height) return;
    h.style.left = (box.x * r.width / W) + 'px';
    h.style.top = (box.y * r.height / H) + 'px';
    h.style.width = Math.max(28, box.w * r.width / W) + 'px';
    h.style.height = Math.max(28, box.h * r.height / H) + 'px';
    if (E.mv) { try { E.mv.updateRect(); } catch (e) {} }
  }
  function readHandle() {
    const h = $('#vidHandle'), st = $('#stage'), v = $('#stageVideo');
    const [W, H] = stageSize();
    const r = st.getBoundingClientRect();
    const box = {
      x: parseFloat(h.style.left) / r.width * W,
      y: parseFloat(h.style.top) / r.height * H,
      w: parseFloat(h.style.width) / r.width * W,
      h: parseFloat(h.style.height) / r.height * H,
    };
    const sw = (v && v.videoWidth) || 16, sh = (v && v.videoHeight) || 9;
    const snap = lyricGuard();
    E.place = LLLayers.placeFromBox(box, sw, sh, W, H, E.place.fit);
    lyricKeep(snap);
    syncPlaceInputs();
    draw();
  }
  function paintOverlays() {
    const box = $('#overlayList');
    if (!box) return;
    box.innerHTML = E.overlays.length ? E.overlays.map((o, i) => `<div class="row"><input data-i="${i}" value="${esc(o.text)}" title="Extra text on its own track"><button type="button" class="btn ghost small" data-del="${i}" title="Remove this text">Remove</button></div>`).join('') : '<p class="muted">No extra text yet.</p>';
    box.querySelectorAll('input').forEach(inp => inp.oninput = () => { E.overlays[+inp.dataset.i].text = inp.value; refresh(); window.LCHist && LCHist.touch(); });
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { E.overlays.splice(+b.dataset.del, 1); paintOverlays(); refresh(); });
  }
  function paintWords() {
    const box = $('#textLines');
    const active = document.activeElement && document.activeElement.closest && document.activeElement.closest('#textLines');
    if (box && !active) {
      box.innerHTML = '';
      (S.lines || []).forEach((ln, li) => {
        const row = document.createElement('label');
        row.className = 'field';
        row.style.width = '100%';
        const text = ln.words.map(w => w.text).join(' ');
        row.innerHTML = `<span>${li + 1}</span><input data-li="${li}" value="${esc(text)}" title="Line ${li + 1}. Editing words does not move timings." style="flex:1;min-width:0">`;
        row.querySelector('input').oninput = ev => {
          const parts = ev.target.value.split(/\s+/);
          const typingTail = /\s$/.test(ev.target.value);
          const cleaned = parts.filter(Boolean);
          const old = ln.words.map(w => ({...w}));
          const words = [];
          const n = Math.min(old.length, cleaned.length);
          for (let i = 0; i < n; i++) words.push(Object.assign({}, old[i], {text: cleaned[i], start: old[i].start, end: old[i].end}));
          if (cleaned.length < old.length) {
            /* fewer words: drop the extras, keep each survivor's time */
          } else {
            let end = words.length ? +words[words.length - 1].end : (old[0] ? +old[0].end : 0);
            for (let i = old.length; i < cleaned.length; i++) {
              words.push({text: cleaned[i], start: end, end: +(end + 0.3).toFixed(3)});
              end += 0.3;
            }
          }
          if (!cleaned.length) words.push(Object.assign({}, old[0] || {start: 0, end: 0.3}, {text: ''}));
          if (!typingTail) ln.words = words.filter(w => w.text !== '');
          else ln.words = words;
          window.LCHist && LCHist.touch();
          if (typeof updatePreview === 'function') updatePreview(E.t);
        };
        box.appendChild(row);
      });
    }
    const ro = $('#roTimes');
    if (ro) ro.innerHTML = (S.lines || []).map(ln => {
      const a = ln.words[0] ? (+ln.words[0].start).toFixed(2) : '';
      const b = ln.words.length ? (+ln.words[ln.words.length - 1].end).toFixed(2) : '';
      return `<div>${esc(ln.words.map(w => w.text).join(' '))} <span class="muted">${a}${b ? '–' + b + 's' : ''}</span></div>`;
    }).join('');
    const pick = $('#linePick');
    if (pick && document.activeElement !== pick) {
      const cur = pick.value;
      pick.innerHTML = (S.lines || []).map((ln, i) => `<option value="${i}">${i + 1}. ${esc((ln.words[0] && ln.words[0].text) || 'line')}</option>`).join('');
      if (cur) pick.value = cur;
    }
  }
  function mountWave() {
    const box = $('#wsBox');
    if (!window.WaveSurfer || !S.audio || !box || box.clientWidth < 20) return;
    if (E.ws && E.wsUrl === S.audio.id) { syncRegions(); return; }
    if (E.ws) { try { E.ws.destroy(); } catch (e) {} }
    const regions = WaveSurfer.Regions.create();
    E.regions = regions;
    E.wsUrl = S.audio.id;
    E.ws = WaveSurfer.create({
      container: '#wsBox',
      url: `/api/audio/${S.audio.id}`,
      height: 84,
      waveColor: '#8a8aa0',
      progressColor: '#1ed760',
      cursorColor: '#ff3cac',
      plugins: [regions, WaveSurfer.Timeline.create({container: '#wsTime'})],
    });
    E.ws.on('ready', () => syncRegions());
    regions.on('region-updated', region => {
      const m = /^L(\d+)$/.exec(region.id || '');
      if (!m) return;
      const ln = S.lines[+m[1]];
      if (!ln || !ln.words.length) return;
      const ws = ln.words;
      const oldA = +ws[0].start, oldB = +ws[ws.length - 1].end;
      const a = Math.max(0, region.start - S.start);
      const b = Math.max(a + 0.05, region.end - S.start);
      const span = Math.max(0.05, oldB - oldA);
      ws.forEach(w => {
        const u0 = (+w.start - oldA) / span, u1 = (+w.end - oldA) / span;
        w.start = +(a + (b - a) * u0).toFixed(3);
        w.end = +(Math.max(w.start + 0.02, a + (b - a) * u1)).toFixed(3);
      });
      renderLines();
      window.LCHist && LCHist.capture();
    });
  }
  function syncRegions() {
    if (!E.regions || !E.ws || !E.ws.getDuration || !E.ws.getDuration()) return;
    E.regions.clearRegions();
    const dur = E.ws.getDuration();
    (S.lines || []).forEach((ln, li) => {
      if (!ln.words || !ln.words.length) return;
      const a = S.start + (+ln.words[0].start);
      const b = S.start + (+ln.words[ln.words.length - 1].end);
      E.regions.addRegion({
        id: 'L' + li,
        start: Math.max(0, Math.min(dur - 0.05, a)),
        end: Math.max(0.05, Math.min(dur, Math.max(a + 0.05, b))),
        content: ln.words.map(w => w.text).join(' '),
        drag: true, resize: true, color: 'rgba(30,215,96,0.28)',
      });
    });
  }
  function atlModel() {
    const video = [], overs = [], lyrics = [];
    E.clips.forEach(c => {
      const a = Math.round((+c.start || 0) * 1000);
      const b = Math.round(((+c.start || 0) + Math.max(0.12, (+c.out || 0) - (+c.in || 0))) * 1000);
      video.push({val: a, group: 'c:' + c.id}, {val: Math.max(a + 120, b), group: 'c:' + c.id});
    });
    E.overlays.forEach(o => {
      const a = Math.round((+o.start || 0) * 1000);
      const b = Math.round(Math.max(+o.start + 0.1, +o.end || 0) * 1000);
      overs.push({val: a, group: 'o:' + o.id}, {val: b, group: 'o:' + o.id});
    });
    (S.lines || []).forEach((ln, i) => {
      if (!ln.words || !ln.words.length) return;
      const a = Math.round((+ln.words[0].start) * 1000);
      const b = Math.round((+ln.words[ln.words.length - 1].end) * 1000);
      lyrics.push({val: a, group: 'l:' + i, draggable: false}, {val: Math.max(a + 50, b), group: 'l:' + i, draggable: false});
    });
    return {rows: [
      {keyframes: video},
      {keyframes: overs},
      {keyframes: lyrics, keyframesDraggable: false, groupsDraggable: false},
    ]};
  }
  function pushAtl() {
    if (!E.atl) return;
    E.atlMute = true;
    try {
      E.atl.setOptions({max: Math.max(1000, (S.len || 20) * 1000)});
      E.atl.setModel(atlModel());
    } catch (e) { console.warn(e); }
    E.atlMute = false;
  }
  function readAtl() {
    if (!E.atl || E.atlMute) return;
    const model = E.atl.getModel();
    if (!model || !model.rows) return;
    const snap = lyricGuard();
    const grab = (row, prefix) => {
      const map = {};
      for (const kf of (row && row.keyframes) || []) {
        const g = typeof kf.group === 'string' ? kf.group : '';
        if (!g.startsWith(prefix)) continue;
        (map[g] = map[g] || []).push(kf.val / 1000);
      }
      return map;
    };
    const vids = grab(model.rows[0], 'c:');
    E.clips.forEach(c => {
      const vals = (vids['c:' + c.id] || []).slice().sort((a, b) => a - b);
      if (vals.length < 2) return;
      const start = Math.max(0, vals[0]);
      const end = Math.max(start + 0.12, vals[1]);
      const span0 = Math.max(0.12, c.out - c.in);
      const span1 = end - start;
      if (Math.abs(span1 - span0) < 0.05) c.start = start;
      else if (Math.abs(start - c.start) < 0.05) c.out = Math.min(c.duration, c.in + span1);
      else {
        c.in = Math.max(0, Math.min(c.out - 0.12, c.in + (start - c.start)));
        c.start = start;
        c.out = Math.min(c.duration, c.in + span1);
      }
    });
    const ovs = grab(model.rows[1], 'o:');
    E.overlays.forEach(o => {
      const vals = (ovs['o:' + o.id] || []).slice().sort((a, b) => a - b);
      if (vals.length >= 2) { o.start = vals[0]; o.end = Math.max(vals[0] + 0.1, vals[1]); }
    });
    lyricKeep(snap);
    tlRender();
    refresh();
    window.LCHist && LCHist.capture();
  }
  function mountAtl() {
    if (E.atl || !window.timelineModule || !$('#atl')) return;
    E.atl = new timelineModule.Timeline({
      id: document.getElementById('atl'),
      snapEnabled: true,
      snapStep: 100,
      min: 0,
      max: Math.max(1000, (S.len || 20) * 1000),
      headerHeight: 22,
      rowsStyle: {height: 28, groupsStyle: {fillColor: '#1ed760'}},
    });
    E.atl.onDragFinished(() => { if (!E.atlMute) readAtl(); });
    pushAtl();
  }
  function wireVideoLayer() {
    E.place = LLLayers.defaultPlace();
    syncPlaceInputs();
    const applyNums = () => {
      const snap = lyricGuard();
      E.place = LLLayers.normalizePlace({fit: $('#fitSel').value, scale: +$('#scaleIn').value, x: +$('#posX').value, y: +$('#posY').value});
      lyricKeep(snap);
      layoutHandle();
      refresh();
      window.LCHist && LCHist.capture();
    };
    ['#fitSel', '#scaleIn', '#posX', '#posY'].forEach(s => { const n = $(s); if (n) n.addEventListener('change', applyNums); });
    $('#overlayAdd').onclick = () => {
      const snap = lyricGuard();
      const next = LLLayers.applyVideoEdit({clips: E.clips, place: E.place, overlays: E.overlays, aspect: $('#aspectIn').value}, {
        op: 'overlay', text: ($('#overlayText').value || 'Title').trim() || 'Title', start: E.t, end: Math.min(S.len || 20, E.t + 3),
      });
      E.overlays = next.overlays;
      lyricKeep(snap);
      $('#overlayText').value = '';
      paintOverlays();
      pushAtl();
      refresh();
      window.LCHist && LCHist.capture();
    };
    const h = $('#vidHandle');
    h.addEventListener('pointerdown', e => {
      if (e.button != null && e.button !== 0) return;
      const se = !!e.target.closest('[data-handle]');
      e.stopPropagation();
      e.preventDefault();
      const drag = {x: e.clientX, y: e.clientY, l: parseFloat(h.style.left) || 0, t: parseFloat(h.style.top) || 0, w: parseFloat(h.style.width), ht: parseFloat(h.style.height), se};
      const move = ev => {
        if (drag.se) {
          h.style.width = Math.max(28, drag.w + (ev.clientX - drag.x)) + 'px';
          h.style.height = Math.max(28, drag.ht + (ev.clientY - drag.y)) + 'px';
        } else {
          h.style.left = (drag.l + (ev.clientX - drag.x)) + 'px';
          h.style.top = (drag.t + (ev.clientY - drag.y)) + 'px';
        }
        readHandle();
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); refresh(); window.LCHist && LCHist.capture(); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    if (window.Moveable) {
      try { E.mv = new Moveable($('#stage'), {target: h, draggable: true, resizable: true, origin: false, snappable: true}); }
      catch (err) { console.warn('moveable', err); E.mv = null; }
      if (!E.mv) { paintOverlays(); return; }
      const pull = e => {
        if (e.left != null) e.target.style.left = e.left + 'px';
        if (e.top != null) e.target.style.top = e.top + 'px';
        if (e.width != null) e.target.style.width = e.width + 'px';
        if (e.height != null) e.target.style.height = e.height + 'px';
        if (e.drag) { e.target.style.left = e.drag.left + 'px'; e.target.style.top = e.drag.top + 'px'; }
        e.target.style.transform = '';
        readHandle();
      };
      E.mv.on('drag', pull);
      E.mv.on('resize', pull);
      E.mv.on('dragEnd', () => window.LCHist && LCHist.capture());
      E.mv.on('resizeEnd', () => window.LCHist && LCHist.capture());
    }
    $('#linePick') && ($('#linePick').onchange = () => syncControls());
    document.querySelectorAll('input[name=applyStyle]').forEach(r => r.onchange = () => syncControls());
    paintOverlays();
  }

  // ---------- public hooks used by app.js ----------
  Object.assign(window.ED, {
    init(cfg) {
      E.eng = cfg.engine; LLFX.setDefs(E.eng.fx); E.look = S.preset; E.fx = defaultFx();
      E.stage = new ST.Stage($('#stageCanvas'));
      animSchema();
      buildControls($('#ctlText'), TEXT, 'style'); buildControls($('#ctlColor'), COLOR, 'style'); buildControls($('#ctlAnim'), ANIM, 'anim');
      buildControls($('#ctlTitle'), TITLE, 'style'); buildControls($('#ctlArtist'), ARTIST, 'style'); buildControls($('#ctlViz'), VIZ, 'style');
      E.place = LLLayers.defaultPlace();
      buildAnimGrid(); buildFx(); wirePresets(); wirePalettes(); wireZoom(); wireTimeline(); wireQuality(); wireTabs(); wireVideoLayer(); loadSaved();
      $('#scrub').oninput = e => { if (!audio.paused) stopPlay(); seek(+e.target.value); };
      $('#stageVideo').addEventListener('loadeddata', () => refresh());
      ST.loadFonts().then(() => { buildAnimGrid(); paintLookThumbs(); refresh(); });
      paintLookThumbs();
      refresh();
    },
    refresh, seek,
    onLook() {
      const lk = E.eng && E.eng.looks[S.preset];
      E.look = S.preset;
      if (lk && lk.anim && E.eng.anims.some(a => a.id === lk.anim)) E.animId = lk.anim;
      E.styleOv = lk ? {...lk.style} : {};
      E.animOv = {};
      E.palette = null;
      E.animLive = false;
      dirty = false;
      $('#presetStatus').textContent = '';
      qa('.animcard').forEach(x => x.classList.toggle('sel', x.dataset.id === E.animId));
      paintThumbs();
      syncControls();
      refresh();
    },
    onFont() { if (!E.stage) return; ST.loadFonts(resolve().style).then(refresh); },
    onAudio() { decodeAudio(); mountWave(); },
    onVideo(m) { addClip(m); },
    outputFps: () => (QUALITY[E.quality] || QUALITY.standard).fps,
    clipCount: () => E.clips.length,
    playFrom() { return E.t >= (S.len || 20) - 0.1 ? 0 : E.t; },
    onPlay(from) {
      E.playing = true; E.t = from;
      const hit = clipAtTime(from);
      if (S.bgMode === 'video' && hit) { const v = $('#stageVideo'); try { v.currentTime = E.stage.videoTime(from); } catch (e) {} v.play().catch(() => {}); }
    },
    onTick(t) {
      const before = clipAtTime(E.t);
      E.t = t; $('#scrub').value = t; tlHead();
      const hit = clipAtTime(t);
      if ((before && before.i) !== (hit && hit.i)) { refresh(); return; }
      if (S.bgMode === 'video' && hit) { const v = $('#stageVideo'), want = E.stage.videoTime(t); if (v.readyState >= 2 && Math.abs(v.currentTime - want) > 0.2) { try { v.currentTime = want; } catch (e) {} } }
      draw();
    },
    onStop() { E.playing = false; $('#stageVideo').pause(); },
    renderExtras() {
      const {style, anim} = resolve(); const st = {...style}; delete st.fontId;
      const first = E.clips[0];
      return {anim_preset: E.animId, style: st, anim, fx: E.fx.filter(f => f.on).map(f => ({id: f.id, amount: f.amount, option: f.option, on: true})),
        zoom: {keys: E.zoom.keys, target: 'bg'}, quality: E.quality,
        artist: $('#showArtistIn').checked ? $('#artistIn').value : '',
        video_place: E.place, overlays: E.overlays.map(o => ({...o})),
        video_clips: E.clips.map(c => ({video_id: c.videoId, in: +(+c.in).toFixed(3), out: +(+c.out).toFixed(3), start: +(+c.start).toFixed(3), place: E.place})),
        video_in: first ? first.in : 0, video_out: first ? first.out : null};
    },
    state: () => E,
    paintWords, syncRegions, onStep(n) { layoutHandle(); if (n === 2) mountWave(); if (n === 3) { mountAtl(); pushAtl(); } paintWords(); },
    splitAtPlayhead: splitClip,
    skipVideo() { E.videoSkipped = true; },
    videoSkipped: () => E.videoSkipped,
    restore(d) {
      E.place = LLLayers.normalizePlace(d.place);
      E.overlays = (d.overlays || []).map(o => ({...o}));
      E.videoSkipped = !!d.skipped;
      E.styleOv = d.styleOv || {};
      if (Array.isArray(d.clips)) E.clips = d.clips.map(c => ({...c}));
      syncPlaceInputs(); paintOverlays(); paintWords(); syncRegions();
    },
  });
})();
