/* Luciel Lyric post FX (browser preview). MIRROR of app/fx.py: same order, parameters (normalised to frame size)
   and deterministic random draws. Works on RGBA ImageData of the composed frame. */
(function (G) {
  const LL = G.LL;
  const {rand1, mulberry32, hash2} = LL;
  const jsr = Math.round;
  const ORDER = ['grade', 'leaks', 'streak', 'vignette', 'vhs', 'glitch', 'grain'];
  const LUM = [0.299, 0.587, 0.114];
  const sat = s => [0, 1, 2].map(i => [0, 1, 2].map(j => LUM[j] * (1 - s) + (i === j ? s : 0)));
  const mat = (rows, offs) => rows.map((r, i) => [...r, offs[i]]);
  const GRADES = {
    warm: mat([[1.10, 0.04, 0.0], [0.02, 1.02, 0.0], [0.0, 0.0, 0.82]], [6, 2, -4]),
    cool: mat([[0.88, 0.0, 0.0], [0.0, 1.0, 0.04], [0.0, 0.05, 1.12]], [-2, 2, 10]),
    bw: mat([0, 1, 2].map(() => LUM.map(v => v * 1.12)), [-10, -10, -10]),
    faded: mat(sat(0.72).map(r => r.map(v => v * 0.78)), [38, 34, 30]),
  };
  let DEFS = {};
  function setDefs(list) { DEFS = Object.fromEntries(list.map(f => [f.id, f])); }

  function allowed(id, option, bgMode) {
    if (bgMode === 'green' || bgMode === 'transparent') return false;
    if (bgMode === 'black') {
      if (!DEFS[id] || !(DEFS[id].overlay || []).includes('black')) return false;
      if (id === 'grade' && option === 'faded') return false;
    }
    return true;
  }
  function gradeMatrix(kind, I) {
    const M = GRADES[kind] || GRADES.warm, out = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) { const id = j < 3 ? (i === j ? 1 : 0) : 0; out.push(id + (M[i][j] - id) * I); }
    return out;
  }
  function applyMatrix(d, m) {  // like PIL Image.convert('RGB', matrix): round + clamp
    for (let p = 0; p < d.length; p += 4) {
      const r = d[p], g = d[p + 1], b = d[p + 2];
      d[p] = r * m[0] + g * m[1] + b * m[2] + m[3] + 0.5 | 0;
      d[p + 1] = r * m[4] + g * m[5] + b * m[6] + m[7] + 0.5 | 0;
      d[p + 2] = r * m[8] + g * m[9] + b * m[10] + m[11] + 0.5 | 0;
    }
  }
  function boxblurH(a, w, h, r, passes = 3) {
    if (r < 1) return a;
    let src = a, dst = new Float32Array(a.length);
    const n = 2 * r + 1;
    for (let k = 0; k < passes; k++) {
      for (let y = 0; y < h; y++) {
        const o = y * w; let s = 0;
        for (let i = -r; i <= r; i++) s += src[o + Math.min(w - 1, Math.max(0, i))];
        for (let x = 0; x < w; x++) {
          dst[o + x] = s / n;
          s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
        }
      }
      [src, dst] = [dst, src];
    }
    return src;
  }
  // scratch canvases
  const cvs = {};
  function cv(name, w, h) {
    let c = cvs[name];
    if (!c) { c = cvs[name] = document.createElement('canvas'); c._ctx = c.getContext('2d', {willReadFrequently: true}); }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  }
  function upscaleGray(vals, w, h, W, H) {  // vals 0..255 (w*h) -> bilinear W*H Uint8 array via canvas
    const s = cv('upS', w, h), sx = s._ctx, im = sx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = vals[i]; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
    sx.putImageData(im, 0, 0);
    const b = cv('upB', W, H), bx = b._ctx; bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'low';
    bx.drawImage(s, 0, 0, W, H);
    return bx.getImageData(0, 0, W, H).data;
  }
  const LEAK_COLS = [[255, 140, 50], [255, 70, 130], [255, 210, 120]];
  function leaks(d, W, H, t, I) {
    const w = Math.max(8, W / 8 | 0), h = Math.max(8, H / 8 | 0);
    const P = new Float32Array(w * h * 3).fill(1);
    for (let k = 0; k < 3; k++) {
      const cx = W * (0.5 + 0.45 * Math.sin(t * 0.23 * (k + 1) + k * 2.1));
      const cy = H * (0.5 + 0.45 * Math.cos(t * 0.17 * (k + 1.3) + k * 1.3));
      const r = 0.55 * Math.max(W, H) * (0.8 + 0.2 * Math.sin(t * 0.5 + k));
      const s = I * 0.6 * (0.7 + 0.3 * Math.sin(t * 0.9 + k * 1.7));
      for (let y = 0; y < h; y++) {
        const yy = (y + 0.5) / h * H - cy;
        for (let x = 0; x < w; x++) {
          const xx = (x + 0.5) / w * W - cx, wg = s * Math.exp(-3 * (xx * xx + yy * yy) / (r * r)), o = (y * w + x) * 3;
          for (let c = 0; c < 3; c++) P[o + c] *= 1 - Math.min(255, Math.max(0, LEAK_COLS[k][c] * wg)) / 255;
        }
      }
    }
    const s = cv('lkS', w, h), sx = s._ctx, im = sx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { for (let c = 0; c < 3; c++) im.data[i * 4 + c] = P[i * 3 + c] * 255 + 0.5 | 0; im.data[i * 4 + 3] = 255; }
    sx.putImageData(im, 0, 0);
    const b = cv('lkB', W, H), bx = b._ctx; bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'low'; bx.drawImage(s, 0, 0, W, H);
    const P8 = bx.getImageData(0, 0, W, H).data;
    for (let p = 0; p < d.length; p += 4) for (let c = 0; c < 3; c++) d[p + c] = 255 - (((255 - d[p + c]) * P8[p + c] + 127) / 255 | 0);
  }
  function streak(d, W, H, textCanvas, I) {
    const w = Math.max(16, W / 8 | 0), h = Math.max(16, H / 8 | 0);
    const s = cv('stS', w, h), sx = s._ctx; sx.clearRect(0, 0, w, h); sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'medium';
    sx.drawImage(textCanvas, 0, 0, w, h);
    const sd = sx.getImageData(0, 0, w, h).data, sm = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) sm[i] = sd[i * 4 + 3] / 255 * Math.max(sd[i * 4], sd[i * 4 + 1], sd[i * 4 + 2]) / 255;
    const wide = boxblurH(sm, w, h, Math.max(1, jsr(w * 0.12))), narrow = boxblurH(sm, w, h, Math.max(1, jsr(w * 0.03)));
    const v8 = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) v8[i] = Math.min(1, Math.max(0, wide[i] * 2.4 + narrow[i] * 0.5)) * 255 + 0.5 | 0;
    const S = upscaleGray(v8, w, h, W, H);
    const k = [110, 170, 255].map(c => Math.trunc(c / 255 * I * 1.1 * 256));
    for (let p = 0; p < d.length; p += 4) { const v = S[p]; for (let c = 0; c < 3; c++) d[p + c] = Math.min(255, d[p + c] + ((v * k[c]) >> 8)); }
  }
  const vigCache = {};
  function vignette(d, W, H, I) {
    const key = `${W}x${H}:${Math.trunc(I * 256)}`;
    let m = vigCache[key];
    if (!m) {
      for (const k in vigCache) delete vigCache[k];
      const Iq = Math.trunc(I * 256) / 256; m = vigCache[key] = new Uint16Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const nx = (x + 0.5) / W * 2 - 1, ny = (y + 0.5) / H * 2 - 1, dd = Math.sqrt(nx * nx + ny * ny) / Math.SQRT2;
        let s = Math.min(1, Math.max(0, (dd - 0.35) / 0.65)); s = s * s * (3 - 2 * s);
        m[y * W + x] = (1 - Iq * 0.85 * s) * 256 | 0;
      }
    }
    for (let i = 0, p = 0; i < m.length; i++, p += 4) { const v = m[i]; d[p] = d[p] * v >> 8; d[p + 1] = d[p + 1] * v >> 8; d[p + 2] = d[p + 2] * v >> 8; }
  }
  function shiftRow(d, W, y, sh) {  // np.roll along x for one row (RGB only)
    if (!sh) return;
    const o = y * W * 4, row = d.slice(o, o + W * 4);
    for (let x = 0; x < W; x++) { const sx = ((x - sh) % W + W) % W; d[o + x * 4] = row[sx * 4]; d[o + x * 4 + 1] = row[sx * 4 + 1]; d[o + x * 4 + 2] = row[sx * 4 + 2]; }
  }
  function vhs(img, W, H, t, I, fno) {
    let d = img.data;
    const s = jsr(I * 0.004 * W);
    if (s) {
      const src = d.slice();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        if (x >= s) d[p] = src[p - s * 4];
        if (x < W - s) d[p + 2] = src[p + s * 4 + 2];
      }
    }
    const nw = Math.max(8, jsr(W / (1 + 1.5 * I)));
    const a = cv('vhA', W, H), ax = a._ctx; ax.putImageData(img, 0, 0);
    const b = cv('vhB', nw, H), bx = b._ctx; bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'low'; bx.drawImage(a, 0, 0, nw, H);
    ax.imageSmoothingEnabled = true; ax.imageSmoothingQuality = 'low'; ax.clearRect(0, 0, W, H); ax.drawImage(b, 0, 0, W, H);
    const back = ax.getImageData(0, 0, W, H); d.set(back.data);
    const M = sat(1 - 0.3 * I), m = [];
    for (let i = 0; i < 3; i++) m.push(...M[i], 8 * I);
    applyMatrix(d, m);
    const per = Math.max(2, jsr(H / 360)), f = Math.trunc(256 * (1 - 0.2 * I));
    for (let y = 0; y < H; y++) if ((y % per) >= per / 2) { const o = y * W * 4; for (let x = 0; x < W * 4; x += 4) { d[o + x] = d[o + x] * f >> 8; d[o + x + 1] = d[o + x + 1] * f >> 8; d[o + x + 2] = d[o + x + 2] * f >> 8; } }
    const yc = (((t * 0.11) % 1.3) - 0.15) * H, hb = 0.03 * H;
    for (let y = Math.max(0, Math.trunc(yc - hb)); y < Math.min(H, Math.trunc(yc + hb) + 1); y++) {
      const k = 1 - Math.abs(y - yc) / hb; if (k <= 0) continue;
      const rq = Math.floor(y / H * 360);
      shiftRow(d, W, y, jsr((rand1(rq, fno) - 0.5) * 0.03 * W * I * k));
      const add = Math.trunc(25 * I * k), o = y * W * 4;
      for (let x = 0; x < W * 4; x += 4) { d[o + x] += add; d[o + x + 1] += add; d[o + x + 2] += add; }
    }
    for (let y = Math.trunc(H * 0.955); y < H; y++) shiftRow(d, W, y, jsr((rand1(Math.floor(y / H * 360) + 5000, fno) - 0.5) * 0.02 * W * I));
  }
  function glitchAmount(t, I, mode, starts) {
    if (mode === 'constant') return I * (0.35 + 0.65 * (rand1(999, Math.floor(t * 10)) > 0.55 ? 1 : 0));
    let g = 0;
    for (const s of starts) { const dt = t - s; if (dt >= 0 && dt < 0.35) g = Math.max(g, I * (1 - dt / 0.35)); }
    if (g > 0 && rand1(998, Math.floor(t * 30)) < 0.3) g *= 0.4;
    return g;
  }
  function glitchPlan(t, g) {
    const R = mulberry32(hash2(777, Math.floor(t * 30)));
    const split = g * 0.012 * (R() * 2 - 1), bands = [], blocks = [];
    const nb = 1 + Math.floor(R() * (1 + 3 * g));
    for (let i = 0; i < nb; i++) { const y0 = R(), hh = 0.008 + R() * 0.04, sh = (R() * 2 - 1) * 0.06 * g; bands.push([y0, hh, sh]); }
    const nbk = Math.floor(g * 7 + R());
    for (let i = 0; i < nbk; i++) {
      const bx = R(), by = R(), bw = 0.05 + R() * 0.25, bh = 0.01 + R() * 0.05, ox = (R() * 2 - 1) * 0.05, oy = (R() * 2 - 1) * 0.02;
      blocks.push([bx, by, bw, bh, ox, oy]);
    }
    return {split, bands, blocks};
  }
  function glitch(d, W, H, t, g) {
    const {split, bands, blocks} = glitchPlan(t, g);
    const dx = jsr(split * W);
    if (dx) {
      const src = d.slice();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        d[p] = src[(y * W + (((x - dx) % W) + W) % W) * 4];
        d[p + 2] = src[(y * W + (((x + dx) % W) + W) % W) * 4 + 2];
      }
    }
    for (const [y0, hh, sh] of bands) {
      const a = Math.floor(y0 * H), b = Math.min(H, a + Math.max(1, jsr(hh * H))), s = jsr(sh * W);
      for (let y = a; y < b; y++) shiftRow(d, W, y, s);
    }
    const src = d.slice();
    for (const [bx, by, bw, bh, ox, oy] of blocks) {
      const x0 = Math.floor(bx * W), y0 = Math.floor(by * H), w = jsr(bw * W), h = jsr(bh * H);
      const sx = x0 + jsr(ox * W), sy = y0 + jsr(oy * H);
      const x0c = Math.max(0, x0, x0 - sx), y0c = Math.max(0, y0, y0 - sy);
      const x1c = Math.min(W, x0 + w, W - (sx - x0)), y1c = Math.min(H, y0 + h, H - (sy - y0));
      for (let y = y0c; y < y1c; y++) for (let x = x0c; x < x1c; x++) {
        const p = (y * W + x) * 4, q = ((y + sy - y0) * W + (x + sx - x0)) * 4;
        d[p] = src[q]; d[p + 1] = src[q + 1]; d[p + 2] = src[q + 2];
      }
    }
  }
  let grainTiles = null, grainKey = '';
  function grain(d, W, H, I, fno) {
    const key = W + 'x' + H;
    if (grainKey !== key) {
      grainKey = key; grainTiles = [];
      const R = mulberry32(1234);
      for (let k = 0; k < 3; k++) {
        const a = new Int16Array(W * H);
        for (let i = 0; i < a.length; i++) {
          const u = Math.max(1e-7, R()), v = R();
          a[i] = Math.max(-100, Math.min(100, Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 22)) | 0;
        }
        grainTiles.push(a);
      }
    }
    const n = grainTiles[fno % 3], oy = Math.floor(rand1(55, fno) * H), ox = Math.floor(rand1(56, fno) * W);
    for (let y = 0; y < H; y++) {
      const sy = ((y - oy) % H + H) % H;
      for (let x = 0; x < W; x++) {
        const sx = ((x - ox) % W + W) % W, v = Math.trunc(n[sy * W + sx] * I), p = (y * W + x) * 4;
        d[p] += v; d[p + 1] += v; d[p + 2] += v;
      }
    }
  }

  /** apply the FX stack to ctx's canvas in place. textCanvas = lyric layer (for streak). */
  function apply(ctx, W, H, textCanvas, t, fxList, lineStarts, bgMode) {
    const on = {};
    for (const f of fxList || []) if (f.on !== false && +f.amount > 0) on[f.id] = f;
    const ids = ORDER.filter(id => on[id] && allowed(id, on[id].option, bgMode));
    if (!ids.length) return;
    const fno = Math.floor(t * 30);
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (const id of ids) {
      const f = on[id], I = Math.max(0, Math.min(1, +f.amount / 100)), opt = f.option || (DEFS[id]?.options || [null])[0];
      if (id === 'grade') applyMatrix(d, gradeMatrix(opt, I));
      else if (id === 'leaks') leaks(d, W, H, t, I);
      else if (id === 'streak' && textCanvas) streak(d, W, H, textCanvas, I);
      else if (id === 'vignette') vignette(d, W, H, I);
      else if (id === 'vhs') vhs(img, W, H, t, I, fno);
      else if (id === 'glitch') { const g = glitchAmount(t, I, opt || 'bursts', lineStarts); if (g > 0.01) glitch(d, W, H, t, g); }
      else if (id === 'grain') grain(d, W, H, I, fno);
    }
    ctx.putImageData(img, 0, 0);
  }
  G.LLFX = {apply, allowed, setDefs, gradeMatrix, glitchPlan, glitchAmount, ORDER};
})(window);
