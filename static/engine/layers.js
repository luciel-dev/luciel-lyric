/* Shared video-layer math. Video edits never receive lyric lines or lyric style.
   Mirrored by place_box() in app/compose.py. */
(function (G) {
  const FITS = {fill: 1, fit: 1, crop: 1};

  function defaultPlace() {
    return {fit: 'fill', scale: 1, x: 0.5, y: 0.5};
  }

  function normalizePlace(place) {
    const p = place && typeof place === 'object' ? place : {};
    const fit = FITS[p.fit] ? p.fit : 'fill';
    let scale = +p.scale;
    if (!isFinite(scale) || scale <= 0) scale = 1;
    scale = Math.max(0.2, Math.min(4, scale));
    let x = p.x == null ? 0.5 : +p.x;
    let y = p.y == null ? 0.5 : +p.y;
    if (!isFinite(x)) x = 0.5;
    if (!isFinite(y)) y = 0.5;
    return {fit, scale, x, y};
  }

  function isCoverDefault(place) {
    const p = normalizePlace(place);
    return p.fit === 'fill' && Math.abs(p.scale - 1) < 1e-3 && Math.abs(p.x - 0.5) < 1e-3 && Math.abs(p.y - 0.5) < 1e-3;
  }

  /** Destination rectangle of a sw×sh video inside a W×H frame. */
  function placeBox(sw, sh, W, H, place) {
    const p = normalizePlace(place);
    sw = Math.max(1, +sw || 1);
    sh = Math.max(1, +sh || 1);
    W = Math.max(1, +W || 1);
    H = Math.max(1, +H || 1);
    const cover = p.fit !== 'fit';
    const sar = sw / sh;
    const ar = W / H;
    let dw;
    let dh;
    if (cover) {
      if (sar > ar) { dh = H; dw = H * sar; }
      else { dw = W; dh = W / sar; }
    } else if (sar > ar) {
      dw = W; dh = W / sar;
    } else {
      dh = H; dw = H * sar;
    }
    dw *= p.scale;
    dh *= p.scale;
    return {x: p.x * W - dw / 2, y: p.y * H - dh / 2, w: dw, h: dh};
  }

  function placeFromBox(box, sw, sh, W, H, fit) {
    const base = placeBox(sw, sh, W, H, {fit: fit || 'fill', scale: 1, x: 0.5, y: 0.5});
    const scale = base.w > 0 ? box.w / base.w : 1;
    return normalizePlace({
      fit: fit || 'fill',
      scale,
      x: (box.x + box.w / 2) / W,
      y: (box.y + box.h / 2) / H,
    });
  }

  const STYLE_KEYS = ['posY', 'size', 'color', 'active', 'sung', 'strokeColor', 'strokeWidth', 'shadowColor', 'shadowAlpha', 'shadowBlur', 'shadowY', 'glow', 'glowColor', 'glowAlpha', 'weight', 'align', 'font', 'upper'];

  function textFingerprint(lines, style) {
    const words = [];
    for (const ln of lines || []) {
      const row = [];
      for (const w of (ln && ln.words) || []) row.push([String(w.text == null ? '' : w.text), +w.start, +w.end]);
      words.push({w: row, s: ln && ln.style ? ln.style : null});
    }
    const st = {};
    if (style && typeof style === 'object') {
      for (const k of STYLE_KEYS) if (style[k] != null) st[k] = style[k];
    }
    return JSON.stringify({words, st});
  }

  function snap(t, points, threshold) {
    const th = threshold == null ? 0.08 : threshold;
    let best = t;
    let dist = th;
    for (const p of points || []) {
      const d = Math.abs(p - t);
      if (d <= dist) { dist = d; best = p; }
    }
    return best;
  }

  function applyVideoEdit(video, edit) {
    const src = video && typeof video === 'object' ? video : {};
    const next = {
      clips: (src.clips || []).map(c => Object.assign({}, c)),
      place: normalizePlace(src.place),
      aspect: src.aspect || '9:16',
      overlays: (src.overlays || []).map(o => Object.assign({}, o)),
    };
    const op = edit && edit.op;
    const clip = () => next.clips[edit.index == null ? 0 : edit.index];
    if (op === 'trim') {
      const c = clip();
      if (c) {
        if (edit.edge === 'in') {
          const inn = Math.max(0, Math.min((+c.out || 0) - 0.12, (+c.in || 0) + (+edit.delta || 0)));
          const delta = inn - (+c.in || 0);
          c.in = inn;
          c.start = Math.max(0, (+c.start || 0) + delta);
        } else {
          c.out = Math.max((+c.in || 0) + 0.12, Math.min(+c.duration || 1e9, (+c.out || 0) + (+edit.delta || 0)));
        }
      }
    } else if (op === 'move') {
      const c = clip();
      if (c) c.start = Math.max(0, +edit.start || 0);
    } else if (op === 'scale') {
      next.place.scale = normalizePlace(Object.assign({}, next.place, {scale: edit.scale})).scale;
    } else if (op === 'position') {
      next.place.x = +edit.x;
      next.place.y = +edit.y;
      next.place = normalizePlace(next.place);
    } else if (op === 'fit') {
      next.place.fit = edit.fit;
      next.place = normalizePlace(next.place);
    } else if (op === 'aspect') {
      next.aspect = edit.aspect || next.aspect;
    } else if (op === 'split') {
      const c = clip();
      const at = +edit.at;
      if (c && at > (+c.start || 0) + 0.12 && at < (+c.start || 0) + ((+c.out || 0) - (+c.in || 0)) - 0.12) {
        const local = at - (+c.start || 0);
        const a = Object.assign({}, c, {out: +((+c.in || 0) + local).toFixed(3)});
        const b = Object.assign({}, c, {
          id: (c.id || 'c') + 'b',
          in: +((+c.in || 0) + local).toFixed(3),
          start: +at.toFixed(3),
        });
        next.clips.splice(edit.index || 0, 1, a, b);
      }
    } else if (op === 'swap' && next.clips.length > 1) {
      const i = edit.index || 0;
      const j = edit.with == null ? i + 1 : edit.with;
      if (next.clips[i] && next.clips[j]) {
        const tmp = next.clips[i];
        next.clips[i] = next.clips[j];
        next.clips[j] = tmp;
      }
    } else if (op === 'overlay') {
      next.overlays.push({
        id: 'o' + Math.random().toString(36).slice(2, 8),
        text: String(edit.text || 'Title'),
        start: +edit.start || 0,
        end: +edit.end || 3,
        x: edit.x == null ? 0.5 : +edit.x,
        y: edit.y == null ? 0.12 : +edit.y,
        scale: edit.scale == null ? 1 : +edit.scale,
        size: edit.size == null ? 0.06 : +edit.size,
        color: edit.color || '#ffffff',
      });
    }
    return next;
  }

  G.LLLayers = {defaultPlace, normalizePlace, isCoverDefault, placeBox, placeFromBox, textFingerprint, snap, applyVideoEdit, STYLE_KEYS};
})(typeof window !== 'undefined' ? window : globalThis);
