/* Luciel Lyric text-animation engine (browser side).
   MIRRORED in app/textanim.py - keep the two in sync: same functions, same order of random draws.
   buildItems(t, scene) -> {items:[...]}: a resolution-independent draw list for one frame. */
(function (G) {
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, x) => a + (b - a) * x;
  const EASE = {
    linear: x => x,
    inSine: x => 1 - Math.cos(x * Math.PI / 2),
    outSine: x => Math.sin(x * Math.PI / 2),
    inOutSine: x => -(Math.cos(Math.PI * x) - 1) / 2,
    inCubic: x => x * x * x,
    outCubic: x => 1 - Math.pow(1 - x, 3),
    inOutCubic: x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
    outBack: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    outBounce: x => {
      const n1 = 7.5625, d1 = 2.75;
      if (x < 1 / d1) return n1 * x * x;
      if (x < 2 / d1) { x -= 1.5 / d1; return n1 * x * x + 0.75; }
      if (x < 2.5 / d1) { x -= 2.25 / d1; return n1 * x * x + 0.9375; }
      x -= 2.625 / d1; return n1 * x * x + 0.984375;
    },
    outElastic: x => x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI) / 3) + 1,
  };
  const ease = (name, x) => (EASE[name] || EASE.outCubic)(clamp(x));

  // deterministic PRNG shared with Python (mulberry32 + integer hash)
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const hash2 = (a, b) => (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA77)) >>> 0;
  const rand1 = (a, b) => mulberry32(hash2(a, b))();

  function prepare(lines, style, anim, clipLen) {
    const clean = [];
    for (const ln of lines || []) {
      const ws = [];
      for (const w of ln.words || []) {
        const tx = String(w.text ?? '').trim(); if (!tx) continue;
        const s = +w.start, e = Math.max(+w.end, s + 0.05);
        ws.push({text: style.upper ? tx.toUpperCase() : tx, s, e});
      }
      if (ws.length) clean.push(ws);
    }
    clean.sort((a, b) => a[0].s - b[0].s);
    const groups = [];
    clean.forEach((ws, li) => {
      if (anim.layout === 'line') { groups.push({words: ws, line: li}); return; }
      const n = anim.layout === 'word' ? 1 : Math.max(1, Math.round(anim.chunk || 3));
      for (let i = 0; i < ws.length; i += n) groups.push({words: ws.slice(i, i + n), line: li});
    });
    const lead = anim.layout === 'line' ? 0.25 : 0.12, hold = anim.layout === 'line' ? 0.8 : 0.35;
    groups.forEach((g, gi) => {
      let st = g.words[0].s - lead;
      if (gi > 0) st = Math.max(st, Math.min(groups[gi - 1].words.at(-1).e, g.words[0].s));
      g.gs = Math.max(0, st);
    });
    groups.forEach((g, gi) => {
      let en = g.words.at(-1).e + hold;
      if (gi + 1 < groups.length) en = Math.min(en, groups[gi + 1].gs);
      g.ge = Math.min(Math.max(en, g.gs + 0.2), clipLen);
    });
    let cid = 0;  // stable ids for per-unit randomness
    groups.forEach((g, gi) => g.words.forEach((w, wi) => { w.id = gi * 1000 + wi; w.cid0 = cid; cid += w.text.length; }));
    return groups;
  }

  // font size in px for this frame size
  const baseSize = (style, W, H) => Math.round(style.size * Math.min(W, H));

  function layoutGroup(g, style, W, H, measure) {
    let fs = baseSize(style, W, H);
    const maxW = style.maxWidth * W;
    const doLayout = fs => {
      const font = {family: style.font, weight: style.weight, px: fs, fontId: style.fontId || ''};
      const sp = measure(' ', font), tr = (style.tracking || 0) * fs;
      const widths = g.words.map(w => measure(w.text, font) + tr * Math.max(0, w.text.length - 1));
      const rows = []; let cur = [], cw = 0;
      widths.forEach((w, i) => {
        if (cur.length && cw + sp + w > maxW) { rows.push({idx: cur, w: cw}); cur = []; cw = 0; }
        cw += (cur.length ? sp : 0) + w; cur.push(i);
      });
      if (cur.length) rows.push({idx: cur, w: cw});
      return {font, sp, tr, widths, rows};
    };
    let L = doLayout(fs);
    const widest = Math.max(...L.rows.map(r => r.w));
    if (widest > maxW) { fs = Math.max(6, Math.round(fs * maxW / widest)); L = doLayout(fs); }
    const lh = fs * style.lineHeight, blockH = L.rows.length * lh, top = style.posY * H - blockH / 2;
    const pos = [];
    L.rows.forEach((r, ri) => {
      const by = top + ri * lh + lh * 0.5 + fs * 0.35;
      let x = style.align === 'left' ? (W - maxW) / 2 : style.align === 'right' ? (W + maxW) / 2 - r.w : (W - r.w) / 2;
      r.idx.forEach(i => { pos[i] = {x, y: by, w: L.widths[i]}; x += L.widths[i] + L.sp; });
    });
    return {fs, font: L.font, tr: L.tr, pos, top, bottom: top + blockH};
  }

  function rgba(hex, a) { return {hex, a}; }

  // returns items for time t (seconds from clip start)
  function buildItems(t, sc) {
    const {W, H, style, anim, measure} = sc;
    const items = [];
    const amp = anim.intensity ?? 1, spd = Math.max(0.05, anim.speed ?? 1);
    const frameNo = Math.floor(t * 30);
    const fsBase = baseSize(style, W, H);
    if (sc.title) {
      const tpx = Math.max(6, Math.round(fsBase * (style.titleSize ?? 0.45)));
      const font = {family: style.font, weight: style.titleWeight ?? 400, px: tpx, fontId: style.fontId || ''};
      const ttext = style.titleUpper ? sc.title.toUpperCase() : sc.title;
      const tw = measure(ttext, font);
      const fa = Math.min(clamp(t / 0.4), clamp((sc.clipLen - t) / 0.4));
      const ty = H * (style.titlePosY ?? 0.06);
      const tsh = (style.titleShadowAlpha || 0) > 0 ? {color: style.titleShadowColor || '#000000', alpha: style.titleShadowAlpha, sigma: (style.titleShadowBlur || 0) * tpx, dy: 0.05 * tpx} : null;
      items.push({k: 'text', text: ttext, font, x: (W - tw) / 2, y: ty + tpx * 0.8, w: tw, fill: style.titleColor || '#ffffff',
        fill2: style.titleGrad ? (style.titleColor2 || style.titleColor || '#ffffff') : null, alpha: (style.titleAlpha ?? 0.81) * fa,
        stroke: (style.titleStroke || 0) * tpx, strokeColor: style.titleStrokeColor || '#000000', scale: 1, rot: 0, cx: W / 2, cy: ty, blur: 0, glow: null, shadow: tsh, wipe: null});
    }
    const groups = sc.groups;
    let gi = -1;
    for (let i = 0; i < groups.length; i++) if (groups[i].gs <= t && t < groups[i].ge) { gi = i; break; }
    if (gi < 0) return {items};
    const g = groups[gi];
    if (!g._lay || g._layKey !== sc.layKey) { g._lay = layoutGroup(g, style, W, H, measure); g._layKey = sc.layKey; }
    const lay = g._lay, fs = lay.fs;
    const enterD = (anim.dur ?? 0.22) / spd, exitD = (anim.exitDur ?? 0.18) / spd;
    const exitX = anim.exit !== 'none' && exitD > 0 ? clamp((t - (g.ge - exitD)) / exitD) : 0;
    const unit = anim.enter === 'type' ? 'char' : anim.unit;
    const needChars = unit === 'char' || anim.idle === 'wave' || anim.active === 'wave' || Math.abs(style.tracking || 0) > 1e-6;
    const glowBase = style.glow > 0 ? {color: style.glowColor, sigma: style.glow * fs, alpha: style.glowAlpha} : null;
    const shadow = style.shadowAlpha > 0 ? {color: style.shadowColor, alpha: style.shadowAlpha, sigma: style.shadowBlur * fs, dy: style.shadowY * fs} : null;
    const stroke = style.strokeWidth * fs;
    const boxes = [], texts = [];
    let cursorX = null, cursorY = 0;

    g.words.forEach((w, wi) => {
      const p = lay.pos[wi];
      const before = t < w.s, active = t >= w.s && t < w.e, after = t >= w.e;
      const act = active ? (t - w.s) / (w.e - w.s) : after ? 1 : 0;
      // word-level colour state
      let fill = style.color, alphaMul = 1, wipe = null, glow = glowBase, wsc = 1, wdx = 0, wdy = 0, wrot = 0;
      if (before) alphaMul = style.unsungAlpha;
      const A = anim.active, amt = (anim.activeAmt ?? 1) * amp;
      if (A === 'none') { if (before) alphaMul = style.unsungAlpha; }
      else if (A === 'fill') {
        if (active) { alphaMul = style.unsungAlpha; wipe = {frac: act, color: style.active}; }
        else if (after) fill = style.sung;
      } else {
        if (active) fill = A === 'box' && style.boxText ? style.boxText : style.active; else if (after) fill = style.sung;
      }
      if (A === 'box' && active) {
        const bp = clamp((t - w.s) / 0.08);
        const pad = style.boxPad * fs;
        boxes.push({k: 'box', x: p.x - pad, y: p.y - fs * 0.86 - pad * 0.35, w: p.w + pad * 2, h: fs * 1.12 + pad * 0.7,
          r: style.boxRadius * fs, color: style.boxColor, alpha: style.boxAlpha * Math.min(1, bp * 2),
          scale: lerp(0.6, 1, ease('outBack', bp)), cx: p.x + p.w / 2, cy: p.y - fs * 0.3});
      }
      if (A === 'scale') {
        if (active) { const x = t - w.s; const pk = x < 0.07 ? x / 0.07 : Math.max(0.45, 1 - (x - 0.07) / 0.3); wsc *= 1 + 0.22 * amt * pk; }
        else if (after) { const x2 = t - w.e; if (x2 < 0.12) wsc *= 1 + 0.22 * amt * 0.45 * (1 - x2 / 0.12); }
      }
      if (A === 'glow' && active) {
        const r = clamp((t - w.s) / 0.06);
        glow = {color: style.active, sigma: Math.max(style.glow, 0.09) * fs * Math.max(0.2, amt), alpha: 0.95 * r};
      }
      if (A === 'shake' && active) {
        const R = mulberry32(hash2(w.id + 17, frameNo));
        wdx += (R() - 0.5) * 0.06 * fs * amt; wdy += (R() - 0.5) * 0.06 * fs * amt; wrot += (R() - 0.5) * 6 * amt;
      }
      // units
      const chars = needChars ? [...w.text] : [w.text];
      let prefix = 0;
      chars.forEach((ch, ci) => {
        const cx0 = needChars ? p.x + measure(w.text.slice(0, ci), lay.font) + lay.tr * ci : p.x;
        const cw = needChars ? measure(ch, lay.font) : p.w;
        const k = unit === 'line' ? 0 : unit === 'word' ? wi : (w.cid0 - g.words[0].cid0) + ci;
        let u0;
        if (anim.trigger === 'word') {
          if (unit === 'line') u0 = g.gs;
          else if (unit === 'word') u0 = w.s - 0.03;
          else u0 = anim.enter === 'type' ? w.s + (w.e - w.s) * ci / chars.length : w.s - 0.03 + (anim.stagger ?? 0.04) * ci / spd;
        } else u0 = g.gs + (anim.stagger ?? 0.04) * k / spd;
        if (anim.enter !== 'none' && t < u0) return;
        const e = enterD > 0 ? clamp((t - u0) / enterD) : 1, E = ease(anim.ease, e);
        let a = alphaMul, sc_ = wsc, dx = wdx, dy = wdy, rot = wrot, bl = 0;
        const uid = needChars ? w.id * 64 + ci : w.id;
        switch (anim.enter) {
          case 'fade': a *= E; break;
          case 'pop': sc_ *= lerp(0.4, 1, E); a *= Math.min(1, e * 3); break;
          case 'slide': dy += (1 - E) * anim.dist * fs * amp; a *= e; break;
          case 'blur': bl += (1 - E) * 0.22 * fs * amp; a *= e; sc_ *= 1 + 0.12 * (1 - E) * amp; break;
          case 'drop': dy -= (1 - E) * anim.dist * fs * amp; rot += (1 - E) * -14 * amp; a *= Math.min(1, e * 2.5); break;
          case 'scale': sc_ *= lerp(0.15, 1, E); a *= Math.min(1, e * 2); break;
          case 'flicker': if (e < 1) a *= rand1(uid + 101, frameNo) < 0.25 + 0.75 * e ? 1 : 0.12; break;
          case 'spin': rot += (1 - E) * -120 * amp; sc_ *= lerp(0.3, 1, E); a *= e; break;
        }
        if (exitX > 0) {
          const X = ease('inCubic', exitX);
          switch (anim.exit) {
            case 'fade': a *= 1 - exitX; break;
            case 'slide': dy -= X * anim.dist * 0.6 * fs; a *= 1 - exitX; break;
            case 'blur': bl += X * 0.2 * fs; a *= 1 - exitX; break;
            case 'pop': sc_ *= 1 - 0.5 * X; a *= 1 - exitX; break;
            case 'flicker': a *= rand1(uid + 303, frameNo) < 1 - exitX ? 1 : 0.1; break;
          }
        }
        if (anim.idle === 'wave') dy += Math.sin(2 * Math.PI * (t * 1.1) - k * 0.55) * 0.07 * fs * (anim.idleAmt ?? 1) * amp;
        if (A === 'wave' && active) dy += Math.sin(2 * Math.PI * (t * 2.2) - ci * 0.8) * 0.1 * fs * amt;
        if (a <= 0.003) return;
        let wp = null;
        if (wipe) { // per-unit share of the word-level wipe
          const wx = p.x + wipe.frac * p.w;
          const f = needChars ? clamp((wx - cx0) / Math.max(1, cw)) : wipe.frac;
          wp = {frac: f, color: wipe.color, a: clamp(a / Math.max(0.01, alphaMul))};
        }
        texts.push({k: 'text', text: ch, font: lay.font, x: cx0, y: p.y, w: cw, fill, alpha: clamp(a), stroke, strokeColor: style.strokeColor,
          scale: sc_, rot, cx: cx0 + cw / 2 + dx, cy: p.y - fs * 0.35 + dy, dx, dy, blur: bl, glow, shadow, wipe: wp});
        if (anim.cursor) { cursorX = cx0 + cw + dx; cursorY = p.y; }
      });
    });
    items.push(...boxes, ...texts);
    if (anim.cursor && cursorX !== null && Math.floor(t * 3) % 2 === 0 && exitX === 0) {
      const font = lay.font, cw = measure('|', font);
      items.push({k: 'text', text: '|', font, x: cursorX + fs * 0.04, y: cursorY, w: cw, fill: style.active, alpha: 1, stroke, strokeColor: style.strokeColor,
        scale: 1, rot: 0, cx: cursorX, cy: cursorY, dx: 0, dy: 0, blur: 0, glow: glowBase, shadow, wipe: null});
    }
    // dim preview of the next line
    if (style.showNext && anim.layout === 'line' && gi + 1 < groups.length) {
      const nx = groups[gi + 1], npx = Math.max(6, Math.round(fs * 0.62));
      const font = {family: style.font, weight: style.weight, px: npx, fontId: style.fontId || ''};
      const text = nx.words.map(w => w.text).join(' ');
      let tw = measure(text, font), f2 = font;
      const maxW = style.maxWidth * W;
      if (tw > maxW) { f2 = {...font, px: Math.max(6, Math.round(npx * maxW / tw))}; tw = measure(text, f2); }
      const y = Math.min(lay.bottom + fs * 0.6 + f2.px * 0.8, H * 0.8);
      const fa = Math.min(clamp((t - g.gs) / 0.15), 1 - exitX);
      if (fa > 0) items.push({k: 'text', text, font: f2, x: (W - tw) / 2, y, w: tw, fill: style.color, alpha: style.nextAlpha * fa, stroke: 0,
        strokeColor: '#000000', scale: 1, rot: 0, cx: W / 2, cy: y, dx: 0, dy: 0, blur: 0, glow: null, shadow: null, wipe: null});
    }
    return {items};
  }

  // zoom/pan keyframes -> source viewport for time t (normalized center + zoom)
  function zoomAt(t, keys) {
    if (!keys || !keys.length) return {z: 1, x: 0.5, y: 0.5};
    const ks = [...keys].sort((a, b) => a.t - b.t);
    let z, x, y;
    if (t <= ks[0].t) ({z, x, y} = ks[0]);
    else if (t >= ks.at(-1).t) ({z, x, y} = ks.at(-1));
    else {
      let i = 0; while (i + 1 < ks.length && ks[i + 1].t <= t) i++;
      const a = ks[i], b = ks[i + 1], u = (t - a.t) / Math.max(1e-6, b.t - a.t), e = ease(b.ease || 'inOutSine', u);
      z = Math.exp(lerp(Math.log(Math.max(1, a.z)), Math.log(Math.max(1, b.z)), e)); x = lerp(a.x, b.x, e); y = lerp(a.y, b.y, e);
    }
    z = Math.max(1, z);
    const hw = 0.5 / z;
    return {z, x: clamp(x, hw, 1 - hw), y: clamp(y, hw, 1 - hw)};
  }
  // ready-made keyframe sets
  function zoomPreset(id, clipLen, groups) {
    const L = clipLen;
    if (id === 'pushin') return [{t: 0, z: 1, x: 0.5, y: 0.5, ease: 'linear'}, {t: L, z: 1.18, x: 0.5, y: 0.5, ease: 'inOutSine'}];
    if (id === 'pullout') return [{t: 0, z: 1.25, x: 0.5, y: 0.5, ease: 'linear'}, {t: L, z: 1, x: 0.5, y: 0.5, ease: 'outCubic'}];
    if (id === 'kenburns') return [{t: 0, z: 1.15, x: 0.42, y: 0.46, ease: 'linear'}, {t: L, z: 1.15, x: 0.58, y: 0.54, ease: 'inOutSine'}];
    if (id === 'punch') {
      const ks = [{t: 0, z: 1, x: 0.5, y: 0.5, ease: 'linear'}];
      let last = 0;
      const starts = [...new Set((groups || []).map(g => g.line))].map(li => (groups.find(g => g.line === li) || {}).words?.[0]?.s).filter(s => s !== undefined);
      for (const s of starts) {
        if (s < last + 0.75 || s > L - 0.2) continue;
        ks.push({t: +(s - 0.01).toFixed(3), z: 1, x: 0.5, y: 0.5, ease: 'linear'});
        ks.push({t: +(s + 0.1).toFixed(3), z: 1.12, x: 0.5, y: 0.5, ease: 'outCubic'});
        ks.push({t: +Math.min(L, s + 0.65).toFixed(3), z: 1, x: 0.5, y: 0.5, ease: 'inOutSine'});
        last = s + 0.65;
      }
      return ks;
    }
    return [];
  }

  G.LL = Object.assign(G.LL || {}, {EASE, ease, clamp, lerp, mulberry32, hash2, rand1, prepare, buildItems, layoutGroup, zoomAt, zoomPreset, baseSize});
})(window);
