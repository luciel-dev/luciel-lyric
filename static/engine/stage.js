/* Luciel Lyric preview stage: draws one frame on a canvas with the same maths as the server renderer
   (app/compose.py + app/raster.py + app/fx.py). */
(function (G) {
  const LL = G.LL;
  const FACES = {'Poppins': [400, 700, 800], 'Bebas Neue': [400], 'Pacifico': [400]};
  const snapWeight = (fam, w) => (FACES[fam] || FACES.Poppins).reduce((b, x) => (Math.abs(x - w) < Math.abs(b - w) || (Math.abs(x - w) === Math.abs(b - w) && x > b)) ? x : b);
  function fontStr(f) {
    if (f.fontId) return `${f.px}px "lc-${f.fontId}"`;
    const fam = FACES[f.family] ? f.family : 'Poppins';
    return `${snapWeight(fam, f.weight || 400)} ${f.px}px "${fam}"`;
  }
  const mctx = document.createElement('canvas').getContext('2d');
  const mcache = new Map();
  function measure(text, f) {
    if (!text) return 0;
    const fs = fontStr(f), k = fs + '\u0000' + text;
    let v = mcache.get(k);
    if (v === undefined) { mctx.font = fs; v = mctx.measureText(text).width; if (mcache.size > 20000) mcache.clear(); mcache.set(k, v); }
    return v;
  }
  async function loadFonts(style) {
    const want = [];
    for (const [fam, ws] of Object.entries(FACES)) for (const w of ws) want.push(`${w} 40px "${fam}"`);
    if (style && style.fontId) want.push(`40px "lc-${style.fontId}"`);
    await Promise.all(want.map(f => document.fonts.load(f).catch(() => null)));
    mcache.clear();
  }

  // ---------- text raster (mirror of app/raster.py) ----------
  function drawItems(ctx, items) {
    for (const it of items) {
      if (it.k === 'box') {
        ctx.save();
        ctx.translate(it.cx, it.cy); ctx.scale(it.scale, it.scale); ctx.translate(-it.cx, -it.cy);
        ctx.globalAlpha = Math.max(0, Math.min(1, it.alpha)); ctx.fillStyle = it.color;
        ctx.beginPath(); ctx.roundRect(it.x, it.y, it.w, it.h, Math.max(0, Math.min(it.r, Math.min(it.w, it.h) / 2))); ctx.fill();
        ctx.restore(); continue;
      }
      const fs = fontStr(it.font), a = it.alpha;
      const T = (extra = 0) => {
        ctx.translate(it.cx, it.cy); ctx.rotate((it.rot || 0) * Math.PI / 180); ctx.scale(it.scale || 1e-3, it.scale || 1e-3);
        ctx.translate(-it.cx + (it.dx || 0), -it.cy + (it.dy || 0) + extra);
      };
      const shape = (col, blur, alpha, extra = 0, clipW = null) => {
        if (alpha <= 0.002) return;
        ctx.save(); T(extra);
        if (clipW !== null) { ctx.beginPath(); ctx.rect(it.x - it.font.px * 4, it.y - it.font.px * 4, it.font.px * 4 + clipW, it.font.px * 8); ctx.clip(); }
        ctx.font = fs; ctx.globalAlpha = Math.min(1, alpha); ctx.filter = blur > 0.3 ? `blur(${blur}px)` : 'none';
        ctx.lineJoin = 'round'; ctx.miterLimit = 2;
        if (it.stroke > 0) { ctx.strokeStyle = col.stroke; ctx.lineWidth = it.stroke * 2; ctx.strokeText(it.text, it.x, it.y); }
        if (col.fill2) { const g = ctx.createLinearGradient(0, it.y - 0.75 * it.font.px, 0, it.y + 0.05 * it.font.px); g.addColorStop(0, col.fill); g.addColorStop(1, col.fill2); ctx.fillStyle = g; }
        else ctx.fillStyle = col.fill;
        ctx.fillText(it.text, it.x, it.y);
        ctx.restore();
      };
      const sh = it.shadow, gl = it.glow;
      if (sh && sh.alpha > 0) shape({fill: sh.color, stroke: sh.color}, sh.sigma, a * sh.alpha, sh.dy);
      if (gl && gl.alpha > 0 && gl.sigma > 0) shape({fill: gl.color, stroke: gl.color}, gl.sigma, a * gl.alpha);
      shape({fill: it.fill, fill2: it.fill2 || null, stroke: it.strokeColor}, it.blur || 0, a);
      const wp = it.wipe;
      if (wp && wp.frac > 0) shape({fill: wp.color, stroke: it.strokeColor}, it.blur || 0, wp.a ?? a, 0, wp.frac >= 1 ? it.font.px * 8 + it.w : wp.frac * it.w);
    }
  }

  const hexRgb = h => { h = (h || '#fff').replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  function coverBox(sw, sh, W, H) {
    const ar = W / H, sar = sw / sh;
    if (sar > ar) { const cw = sh * ar; return [(sw - cw) / 2, 0, (sw + cw) / 2, sh]; }
    const ch = sw / ar; return [0, (sh - ch) / 2, sw, (sh + ch) / 2];
  }
  function viewBox(box, z, cx, cy) {
    const [bx0, by0, bx1, by1] = box, bw = bx1 - bx0, bh = by1 - by0, vw = bw / z, vh = bh / z;
    return [bx0 + cx * bw - vw / 2, by0 + cy * bh - vh / 2, vw, vh];
  }

  class Stage {
    constructor(canvas) {
      this.cv = canvas; this.ctx = canvas.getContext('2d', {willReadFrequently: true});
      this.layer = document.createElement('canvas'); this.lctx = this.layer.getContext('2d');
      this.tmp = document.createElement('canvas'); this.tctx = this.tmp.getContext('2d');
      this.sc = null; this.audio = null; this.fullW = 1080;
    }
    setSize(W, H, fullW) {
      for (const c of [this.cv, this.layer, this.tmp]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      this.W = W; this.H = H; this.fullW = fullW || 1080;
    }
    setAudio(samples, sr) { this.audio = samples ? {samples, sr} : null; }
    /** cfg: {look, style, anim, lines, title, clipLen, visualizer, bgMode, image, video, trimIn, trimOut, darken, blur, zoom:{keys,target}, fx} */
    setScene(cfg) {
      const {W, H} = this;
      const style = {...cfg.style};
      if (cfg.bgMode === 'green') { style.glow = 0; style.shadowBlur = 0; style.titleShadowBlur = 0; }
      const groups = LL.prepare(cfg.lines, style, cfg.anim, cfg.clipLen);
      this.cfg = cfg;
      this.sc = {W, H, style, anim: cfg.anim, measure, groups, title: cfg.title, artist: cfg.artist || '', clipLen: cfg.clipLen, layKey: `${W}x${H}:${Math.random()}`};
      this.lineStarts = [...new Set(groups.map(g => g.words[0].s))].sort((a, b) => a - b);
      this.groups = groups;
    }
    videoTime(t) {
      const c = this.cfg, fps = c.fps || 30;
      if (c.clip) {
        const qt = Math.round(t * fps + 1e-6) / fps;
        return (c.clip.in || 0) + Math.max(0, qt - (c.clip.start || 0));
      }
      const v = c.video; if (!v) return 0;
      const vin = c.trimIn || 0, vout = c.trimOut && c.trimOut > vin + 0.1 ? c.trimOut : (v.duration || 1e9);
      const seg = Math.max(1 / fps, vout - vin);
      const f = Math.floor(t * fps + 1e-6), n = Math.max(1, Math.round(seg * fps));
      return vin + (f % n) / fps;
    }
    drawFrame(t) {
      if (!this.sc) return;
      const fps = (this.cfg && this.cfg.fps) || 30;
      t = Math.round(t * fps + 1e-6) / fps;  // show exactly the frames the chosen render fps will contain
      const {ctx, W, H, cfg} = this, sc = this.sc;
      const z0 = LL.zoomAt(t, cfg.zoom?.keys || []), target = cfg.zoom?.target || 'bg';
      const zb = target === 'bg' ? z0 : {z: 1, x: 0.5, y: 0.5};
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      const m = cfg.bgMode;
      if (m === 'black' || m === 'green') { ctx.fillStyle = m === 'green' ? '#00ff00' : '#000'; ctx.fillRect(0, 0, W, H); }
      else if (m === 'gradient') {
        const [x0, y0, vw, vh] = viewBox([0, 0, W, H], zb.z, zb.x, zb.y);
        ctx.save(); ctx.scale(W / vw, H / vh); ctx.translate(-x0, -y0);
        const th = 0.785 + 0.12 * t, c = Math.cos(th), s = Math.sin(th), R = W / 2 * Math.abs(c) + H / 2 * Math.abs(s);
        const g = ctx.createLinearGradient(W / 2 - R * c, H / 2 - R * s, W / 2 + R * c, H / 2 + R * s);
        const cols = cfg.grad; cols.forEach((col, i) => g.addColorStop(i / (cols.length - 1), col));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
      } else if (m === 'image' && cfg.image && cfg.image.naturalWidth) {
        const im = cfg.image, [x0, y0, vw, vh] = viewBox(coverBox(im.naturalWidth, im.naturalHeight, W, H), zb.z, zb.x, zb.y);
        ctx.drawImage(im, x0, y0, vw, vh, 0, 0, W, H);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
      } else if (m === 'video' && cfg.video && cfg.video.videoWidth) {
        const v = cfg.video;
        const place = (cfg.place) || (cfg.clip && cfg.clip.place) || null;
        const fitted = G.LLLayers && place && !G.LLLayers.isCoverDefault(place);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        const bl = (cfg.blur || 0) * W / this.fullW;
        ctx.filter = bl > 0.05 ? `blur(${bl}px)` : 'none';
        if (fitted) {
          const box = G.LLLayers.placeBox(v.videoWidth, v.videoHeight, W, H, place);
          ctx.drawImage(v, box.x, box.y, box.w, box.h);
        } else {
          const [x0, y0, vw, vh] = viewBox(coverBox(v.videoWidth, v.videoHeight, W, H), zb.z, zb.x, zb.y);
          ctx.drawImage(v, x0, y0, vw, vh, 0, 0, W, H);
        }
        ctx.filter = 'none';
        if (fitted && zb.z > 1.0005) {
          const [x0, y0, vw, vh] = viewBox([0, 0, W, H], zb.z, zb.x, zb.y);
          this.tctx.clearRect(0, 0, W, H); this.tctx.drawImage(this.cv, 0, 0);
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
          ctx.drawImage(this.tmp, x0, y0, vw, vh, 0, 0, W, H);
        }
        if (cfg.darken > 0) { ctx.fillStyle = `rgba(0,0,0,${Math.min(0.9, cfg.darken)})`; ctx.fillRect(0, 0, W, H); }
      } else if (m === 'video') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
      else if (m !== 'transparent') { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H); }
      // waveform — line/bars/mirror, same placement as app/compose.py draw_wave
      if (cfg.visualizer && this.audio) {
        const st = cfg.style || {};
        const vizStyle = st.vizStyle || 'line';
        const vizY = st.vizY == null ? 0.86 : +st.vizY;
        const vizH = st.vizH == null ? 0.10 : +st.vizH;
        const vizA = st.vizAlpha == null ? 0.75 : +st.vizAlpha;
        const classic = vizStyle === 'line' && vizY === 0.86 && vizH === 0.10 && vizA === 0.75 && fps === 30;
        const {samples, sr} = this.audio;
        const i0 = Math.trunc(t * sr), n = Math.max(1, Math.floor(sr / fps)), len = Math.max(0, Math.min(n, samples.length - i0));
        let col = hexRgb(st.vizColor || cfg.wave);
        if (m === 'green') col = [col[0], Math.min(col[1], 77), col[2]];
        const ampAt = x => (len > 0 ? Math.sqrt(Math.min(1, Math.abs(samples[i0 + Math.floor(x * len / W)]))) : 0);
        const strokeLine = (y, height, alpha) => {
          if (len <= 0 || height < 1 || alpha <= 0) return;
          ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
          ctx.beginPath();
          for (let x = 0; x < W; x++) {
            const hh = Math.max(0.5, ampAt(x) * height / 2);
            ctx.rect(x, y + (height - 1) / 2 - hh + 0.5, 1, hh * 2);
          }
          ctx.fill();
        };
        if (classic) {
          const wh = Math.trunc(H * 0.10), mid = Math.trunc(H * 0.86), y0 = mid - Math.floor(wh / 2);
          ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.75)`;
          if (len > 0) {
            ctx.beginPath();
            for (let x = 0; x < W; x++) {
              const v = Math.sqrt(Math.min(1, Math.abs(samples[i0 + Math.floor(x * len / W)]))), hh = Math.max(0.5, v * wh / 2);
              ctx.rect(x, y0 + (wh - 1) / 2 - hh + 0.5, 1, hh * 2);
            }
            ctx.fill();
          }
        } else {
          let wh = Math.trunc(H * vizH), mid = Math.trunc(H * vizY), y0 = mid - Math.floor(wh / 2);
          if (wh < 1) wh = 1;
          if (y0 < 0) y0 = 0;
          if (y0 + wh > H) y0 = Math.max(0, H - wh);
          if (vizStyle === 'bars') {
            ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${vizA})`;
            const nb = 32;
            for (let i = 0; i < nb; i++) {
              const x0 = Math.trunc(i * W / nb), x1 = Math.trunc((i + 1) * W / nb);
              if (x1 <= x0) continue;
              const xc = Math.min(W - 1, Math.floor((x0 + x1) / 2));
              const bh = Math.max(1, Math.round(ampAt(xc) * wh));
              const gap = x1 - x0 > 2 ? 1 : 0;
              ctx.fillRect(x0, y0 + wh - bh, Math.max(1, x1 - x0 - gap), bh);
            }
          } else {
            strokeLine(y0, wh, vizA);
            if (vizStyle === 'mirror') strokeLine(y0 + Math.trunc(wh * 0.85), Math.max(1, Math.trunc(wh * 0.45)), vizA * 0.4);
          }
        }
      }
      // lyrics
      const l = this.lctx; l.setTransform(1, 0, 0, 1, 0, 0); l.clearRect(0, 0, W, H);
      drawItems(l, LL.buildItems(t, sc).items);
      const ovs = cfg.overlays || [];
      if (ovs.length) {
        l.save();
        for (const ov of ovs) {
          if (!ov || t < (+ov.start || 0) || t > (+ov.end || 1e9)) continue;
          const px = Math.max(10, Math.round((+ov.size || 0.06) * Math.min(W, H) * (+ov.scale || 1)));
          l.font = `700 ${px}px Poppins, sans-serif`;
          l.fillStyle = ov.color || '#ffffff';
          l.textAlign = 'center';
          l.textBaseline = 'middle';
          l.globalAlpha = 1;
          l.fillText(String(ov.text || ''), (+ov.x || 0.5) * W, (+ov.y || 0.12) * H);
        }
        l.restore();
      }
      ctx.drawImage(this.layer, 0, 0);
      let textCanvas = this.layer;
      if (target === 'all' && z0.z > 1.0005) {
        const [x0, y0, vw, vh] = viewBox([0, 0, W, H], z0.z, z0.x, z0.y);
        this.tctx.clearRect(0, 0, W, H); this.tctx.drawImage(this.cv, 0, 0);
        ctx.clearRect(0, 0, W, H); ctx.drawImage(this.tmp, x0, y0, vw, vh, 0, 0, W, H);
        this.tctx.clearRect(0, 0, W, H); this.tctx.drawImage(this.layer, x0, y0, vw, vh, 0, 0, W, H); textCanvas = this.tmp;
      }
      ctx.restore();
      if (m !== 'transparent' && G.LLFX && cfg.fx && cfg.fx.length) G.LLFX.apply(ctx, W, H, textCanvas, t, cfg.fx, this.lineStarts, m);
    }
  }
  G.LLStage = {Stage, measure, fontStr, loadFonts, drawItems, coverBox, viewBox};
})(window);
