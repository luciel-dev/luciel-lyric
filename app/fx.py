"""Stackable post effects. MIRROR of static/engine/fx.js (same parameters, normalised to frame size,
same deterministic random draws) so the browser preview matches the render.
Order: grade -> leaks -> streak -> vignette -> vhs -> glitch -> grain."""
import math
from functools import lru_cache

import numpy as np
from PIL import Image

from .textanim import PRESETS, js_round, mulberry32, hash2, rand1

ORDER = ["grade", "leaks", "streak", "vignette", "vhs", "glitch", "grain"]
FX_DEFS = {f["id"]: f for f in PRESETS["fx"]}
LUM = (0.299, 0.587, 0.114)


def _sat(s):
    return [[LUM[j] * (1 - s) + (s if i == j else 0) for j in range(3)] for i in range(3)]


def _mat(rows, offs):
    return [list(r) + [o] for r, o in zip(rows, offs)]


GRADES = {
    "warm": _mat([[1.10, 0.04, 0.0], [0.02, 1.02, 0.0], [0.0, 0.0, 0.82]], [6, 2, -4]),
    "cool": _mat([[0.88, 0.0, 0.0], [0.0, 1.0, 0.04], [0.0, 0.05, 1.12]], [-2, 2, 10]),
    "bw": _mat([[LUM[0] * 1.12, LUM[1] * 1.12, LUM[2] * 1.12]] * 3, [-10, -10, -10]),
    "faded": _mat([[v * 0.78 for v in r] for r in _sat(0.72)], [38, 34, 30]),
}


def grade_matrix(kind, I):
    M = GRADES.get(kind, GRADES["warm"])
    out = []
    for i in range(3):
        for j in range(4):
            idv = (1.0 if i == j else 0.0) if j < 3 else 0.0
            out.append(idv + (M[i][j] - idv) * I)
    return out


def allowed(fx_id, option, bg_mode):
    """Is this effect safe for the export mode? (black = screen-blend overlay, green = chroma key, transparent = alpha)"""
    if bg_mode in ("green", "transparent"):
        return False
    if bg_mode == "black":
        if fx_id not in FX_DEFS or "black" not in FX_DEFS[fx_id].get("overlay", []):
            return False
        if fx_id == "grade" and option == "faded":
            return False   # lifts black -> breaks screen blending
    return True


def boxblur_h(a, r, passes=3):
    """Horizontal box blur with edge clamp along the last-but-one axis (rows). a: float32 (h, w)."""
    if r < 1:
        return a
    for _ in range(passes):
        p = np.pad(a, ((0, 0), (r + 1, r)), mode="edge")
        c = np.cumsum(p, axis=1, dtype=np.float32)
        a = (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
    return a


@lru_cache(maxsize=8)
def _vignette_mask(W, H, I256):
    I = I256 / 256
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    nx = (x + 0.5) / W * 2 - 1; ny = (y + 0.5) / H * 2 - 1
    d = np.sqrt(nx * nx + ny * ny) / math.sqrt(2)
    s = np.clip((d - 0.35) / 0.65, 0, 1); s = s * s * (3 - 2 * s)
    return ((1 - I * 0.85 * s) * 256).astype(np.uint16)[..., None]


@lru_cache(maxsize=4)
def _grain_tiles(H, W):
    rng = np.random.default_rng(1234)
    return [(rng.standard_normal((H, W), dtype=np.float32) * 22).clip(-100, 100).astype(np.int16) for _ in range(3)]


LEAK_COLS = [(255, 140, 50), (255, 70, 130), (255, 210, 120)]


def leak_product(t, W, H, I, w, h):
    """Screen-blend product P=prod(1-L_k/255) of 3 drifting gaussian light blobs at (w,h) resolution."""
    ys = (np.arange(h, dtype=np.float32) + 0.5) / h * H
    xs = (np.arange(w, dtype=np.float32) + 0.5) / w * W
    P = np.ones((h, w, 3), np.float32)
    for k in range(3):
        cx = W * (0.5 + 0.45 * math.sin(t * 0.23 * (k + 1) + k * 2.1))
        cy = H * (0.5 + 0.45 * math.cos(t * 0.17 * (k + 1.3) + k * 1.3))
        r = 0.55 * max(W, H) * (0.8 + 0.2 * math.sin(t * 0.5 + k))
        s = I * 0.6 * (0.7 + 0.3 * math.sin(t * 0.9 + k * 1.7))
        wgt = s * np.exp(-3 * (((xs[None, :] - cx) ** 2 + (ys[:, None] - cy) ** 2) / (r * r)))
        for c in range(3):
            P[..., c] *= 1 - np.clip(LEAK_COLS[k][c] * wgt, 0, 255) / 255
    return P


def glitch_amount(t, I, mode, line_starts):
    if mode == "constant":
        return I * (0.35 + 0.65 * (1 if rand1(999, math.floor(t * 10)) > 0.55 else 0))
    g = 0.0
    for s in line_starts:
        dt = t - s
        if 0 <= dt < 0.35:
            g = max(g, I * (1 - dt / 0.35))
    if g > 0 and rand1(998, math.floor(t * 30)) < 0.3:
        g *= 0.4
    return g


def glitch_plan(t, g, W, H):
    """All random decisions for one glitch frame, in normalised units (shared with fx.js)."""
    R = mulberry32(hash2(777, math.floor(t * 30)))
    split = g * 0.012 * (R() * 2 - 1)
    bands = []
    nb = 1 + math.floor(R() * (1 + 3 * g))
    for _ in range(nb):
        y0 = R(); hh = 0.008 + R() * 0.04; sh = (R() * 2 - 1) * 0.06 * g
        bands.append((y0, hh, sh))
    blocks = []
    nbk = math.floor(g * 7 + R())
    for _ in range(nbk):
        bx, by = R(), R(); bw, bh = 0.05 + R() * 0.25, 0.01 + R() * 0.05
        ox, oy = (R() * 2 - 1) * 0.05, (R() * 2 - 1) * 0.02
        blocks.append((bx, by, bw, bh, ox, oy))
    return split, bands, blocks


def _shift_rows(a, y0, y1, sh):
    if sh and y1 > y0:
        a[y0:y1] = np.roll(a[y0:y1], sh, axis=1)


def apply(frame, text_rgba, t, fx_list, line_starts, bg_mode="gradient"):
    """frame: HxWx3 uint8 (modified copy returned). text_rgba: HxWx4 uint8 lyric layer or None."""
    H, W = frame.shape[:2]
    by_id = {f["id"]: f for f in fx_list if f.get("on", True) and float(f.get("amount", 0)) > 0}
    if not by_id:
        return frame
    fno = math.floor(t * 30)
    img = None
    for fid in ORDER:
        f = by_id.get(fid)
        if not f or not allowed(fid, f.get("option"), bg_mode):
            continue
        I = max(0.0, min(1.0, float(f["amount"]) / 100))
        opt = f.get("option") or (FX_DEFS[fid].get("options") or [None])[0]
        if fid == "grade":
            frame = np.asarray(Image.fromarray(frame).convert("RGB", tuple(grade_matrix(opt, I))))
        elif fid == "leaks":
            w, h = max(8, W // 8), max(8, H // 8)
            P = leak_product(t, W, H, I, w, h)
            Pim = Image.fromarray((P * 255 + 0.5).astype(np.uint8)).resize((W, H), Image.Resampling.BILINEAR)
            P8 = np.asarray(Pim).astype(np.uint16)
            frame = (255 - ((255 - frame.astype(np.uint16)) * P8 + 127) // 255).astype(np.uint8)
        elif fid == "streak" and text_rgba is not None:
            w, h = max(16, W // 8), max(16, H // 8)
            small = np.asarray(Image.fromarray(text_rgba, "RGBA").resize((w, h), Image.Resampling.BOX)).astype(np.float32)
            sm = small[..., 3] / 255 * small[..., :3].max(axis=2) / 255
            wide = boxblur_h(sm, max(1, js_round(w * 0.12)))
            narrow = boxblur_h(sm, max(1, js_round(w * 0.03)))
            s = np.clip(wide * 2.4 + narrow * 0.5, 0, 1)
            S = np.asarray(Image.fromarray((s * 255 + 0.5).astype(np.uint8)).resize((W, H), Image.Resampling.BILINEAR)).astype(np.uint16)
            out = frame.copy()
            for c, tint in enumerate((110, 170, 255)):
                k = int(tint / 255 * I * 1.1 * 256)
                out[..., c] = np.minimum(frame[..., c].astype(np.uint16) + ((S * k) >> 8), 255).astype(np.uint8)
            frame = out
        elif fid == "vignette":
            m = _vignette_mask(W, H, int(I * 256))
            frame = ((frame.astype(np.uint16) * m) >> 8).astype(np.uint8)
        elif fid == "vhs":
            frame = vhs(frame, t, I, fno)
        elif fid == "glitch":
            g = glitch_amount(t, I, opt or "bursts", line_starts)
            if g > 0.01:
                frame = glitch(frame, t, g)
        elif fid == "grain":
            tiles = _grain_tiles(H, W)
            n = tiles[fno % 3]
            oy, ox = int(rand1(55, fno) * H), int(rand1(56, fno) * W)
            n = np.roll(n, (oy, ox), axis=(0, 1))
            frame = np.clip(frame.astype(np.int16) + (n * I).astype(np.int16)[..., None], 0, 255).astype(np.uint8)
    return frame


def vhs(frame, t, I, fno):
    H, W = frame.shape[:2]
    out = frame.copy()
    s = js_round(I * 0.004 * W)
    if s:
        out[:, s:, 0] = frame[:, :-s, 0]; out[:, :-s, 2] = frame[:, s:, 2]
    nw = max(8, js_round(W / (1 + 1.5 * I)))
    im = Image.fromarray(out).resize((nw, H), Image.Resampling.BILINEAR).resize((W, H), Image.Resampling.BILINEAR)
    sat = 1 - 0.3 * I; M = _sat(sat)
    mat = []
    for i in range(3):
        mat += M[i] + [8 * I]
    out = np.array(im.convert("RGB", tuple(mat)))
    p = max(2, js_round(H / 360))
    rows = (np.arange(H) % p) >= p / 2
    out[rows] = (out[rows].astype(np.uint16) * int(256 * (1 - 0.2 * I)) >> 8).astype(np.uint8)
    yc = ((t * 0.11) % 1.3 - 0.15) * H; hb = 0.03 * H
    for y in range(max(0, int(yc - hb)), min(H, int(yc + hb) + 1)):
        k = 1 - abs(y - yc) / hb
        if k <= 0:
            continue
        rq = math.floor(y / H * 360)
        sh = js_round((rand1(rq, fno) - 0.5) * 0.03 * W * I * k)
        _shift_rows(out, y, y + 1, sh)
        out[y] = np.clip(out[y].astype(np.int16) + int(25 * I * k), 0, 255).astype(np.uint8)
    for y in range(int(H * 0.955), H):
        rq = math.floor(y / H * 360)
        _shift_rows(out, y, y + 1, js_round((rand1(rq + 5000, fno) - 0.5) * 0.02 * W * I))
    return out


def glitch(frame, t, g):
    H, W = frame.shape[:2]
    split, bands, blocks = glitch_plan(t, g, W, H)
    out = frame.copy()
    dx = js_round(split * W)
    if dx:
        out[..., 0] = np.roll(frame[..., 0], dx, axis=1); out[..., 2] = np.roll(frame[..., 2], -dx, axis=1)
    for y0, hh, sh in bands:
        a = math.floor(y0 * H); b = min(H, a + max(1, js_round(hh * H)))
        _shift_rows(out, a, b, js_round(sh * W))
    src = out.copy()
    for bx, by, bw, bh, ox, oy in blocks:
        x0, y0 = math.floor(bx * W), math.floor(by * H)
        w, h = js_round(bw * W), js_round(bh * H)
        sx, sy = x0 + js_round(ox * W), y0 + js_round(oy * H)
        # clamp both rectangles to the frame
        x0c, y0c = max(0, x0, x0 - sx), max(0, y0, y0 - sy)
        x1c, y1c = min(W, x0 + w, W - (sx - x0)), min(H, y0 + h, H - (sy - y0))
        if x1c > x0c and y1c > y0c:
            out[y0c:y1c, x0c:x1c] = src[y0c + sy - y0:y1c + sy - y0, x0c + sx - x0:x1c + sx - x0]
    return out
