"""Rasterises the draw list from textanim.build_items into an RGBA layer with Pillow.
Mirror of drawItems() in static/engine/stage.js (canvas)."""
import math
import threading
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .runtime import RENDER_FONTS

FACES = {
    "Poppins": {400: "Poppins-Regular.ttf", 700: "Poppins-Bold.ttf", 800: "Poppins-ExtraBold.ttf"},
    "Bebas Neue": {400: "BebasNeue-Regular.ttf"},
    "Pacifico": {400: "Pacifico-Regular.ttf"},
}


def snap_weight(family, weight):
    ws = sorted(FACES.get(family, FACES["Poppins"]))
    return min(ws, key=lambda w: (abs(w - weight), -w))


class Fonts:
    """Resolves {family, weight, px, fontId} -> FreeType font. Custom uploads are looked up in font_files."""

    def __init__(self, font_files=None):
        self.font_files = font_files or {}
        self._lock = threading.Lock()
        self._cache = {}

    def path(self, f):
        if f.get("fontId") and f["fontId"] in self.font_files:
            return str(self.font_files[f["fontId"]])
        fam = f["family"] if f["family"] in FACES else "Poppins"
        return str(RENDER_FONTS / FACES[fam][snap_weight(fam, f.get("weight", 400))])

    def get(self, f):
        key = (self.path(f), int(f["px"]))
        ft = self._cache.get(key)
        if ft is None:
            with self._lock:
                ft = self._cache.get(key) or ImageFont.truetype(key[0], key[1])
                self._cache[key] = ft
        return ft

    def measure(self, text, f):
        if not text:
            return 0.0
        return float(self.get(f).getlength(text))


def rgb(hexcol):
    h = (hexcol or "#ffffff").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class Raster:
    def __init__(self, fonts: Fonts):
        self.fonts = fonts
        self._sprites = {}
        self._lock = threading.Lock()

    # ---- sprites ----
    def sprite(self, text, font, fill, stroke, stroke_color, fill2=None):
        key = (text, self.fonts.path(font), int(font["px"]), round(stroke * 4) / 4, stroke_color if stroke > 0 else "", fill, fill2)
        s = self._sprites.get(key)
        if s is not None:
            return s
        ft = self.fonts.get(font)
        sw = max(0.0, stroke)
        l, t, r, b = ft.getbbox(text, anchor="ls", stroke_width=sw)
        pad = int(math.ceil(sw)) + 3
        ox, oy = -l + pad, -t + pad
        im = Image.new("RGBA", (int(r - l) + 2 * pad, int(b - t) + 2 * pad), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        if sw > 0:
            d.text((ox, oy), text, font=ft, anchor="ls", fill=rgb(stroke_color) + (255,), stroke_width=sw,
                   stroke_fill=rgb(stroke_color) + (255,))
        if fill2:
            # vertical gradient fill, baseline-relative (same stops as the canvas: y-0.75px -> y+0.05px)
            mask = Image.new("L", im.size, 0)
            ImageDraw.Draw(mask).text((ox, oy), text, font=ft, anchor="ls", fill=255)
            px = float(font["px"]); c1, c2 = rgb(fill), rgb(fill2)
            col = Image.new("RGBA", (1, im.height))
            for v in range(im.height):
                f = min(1.0, max(0.0, ((v + 0.5 - oy) + 0.75 * px) / (0.8 * px)))
                col.putpixel((0, v), tuple(int(round(c1[i] + (c2[i] - c1[i]) * f)) for i in range(3)) + (255,))
            grad = col.resize(im.size, Image.Resampling.NEAREST)
            im.paste(grad, (0, 0), mask)
        else:
            d.text((ox, oy), text, font=ft, anchor="ls", fill=rgb(fill) + (255,))
        s = (im, ox, oy)
        with self._lock:
            if len(self._sprites) > 4000:
                self._sprites.clear()
            self._sprites[key] = s
        return s

    @staticmethod
    def _expand(im, ox, oy, sigma):
        p = int(math.ceil(sigma * 3)) + 1
        out = Image.new("RGBA", (im.width + 2 * p, im.height + 2 * p), (0, 0, 0, 0))
        out.paste(im, (p, p))
        return out, ox + p, oy + p

    def silhouette(self, base, color, sigma):
        im, ox, oy = base
        if sigma > 0.3:
            im, ox, oy = self._expand(im, ox, oy, sigma)
        sil = Image.new("RGBA", im.size, rgb(color) + (0,))
        sil.putalpha(im.getchannel("A"))
        if sigma > 0.3:
            sil = sil.filter(ImageFilter.GaussianBlur(sigma))
        return sil, ox, oy

    def cached_silhouette(self, base, key, color, sigma):
        k = ("sil", key, color, round(sigma * 2) / 2)
        s = self._sprites.get(k)
        if s is None:
            s = self.silhouette(base, color, round(sigma * 2) / 2)
            with self._lock:
                self._sprites[k] = s
        return s

    # ---- placement ----
    @staticmethod
    def place(layer, spr, x, y, it, alpha, extra_dy=0.0):
        """Draw sprite so that sprite point (ox,oy) lands on frame point (x,y), then apply the item transform
        p' = C + R*S*(p + d - C)  (C = item pivot, d = item offset) - same as the canvas transform chain."""
        im, ox, oy = spr
        if alpha <= 0.002:
            return
        s = it.get("scale", 1) or 1e-3
        rot = math.radians(it.get("rot", 0) or 0)
        cx, cy = it["cx"], it["cy"]
        dx, dy = it.get("dx", 0), it.get("dy", 0) + extra_dy
        c, si = math.cos(rot), math.sin(rot)
        m = ((c * s, -si * s), (si * s, c * s))

        def fwd(u, v):
            px, py = x - ox + u + dx - cx, y - oy + v + dy - cy
            return cx + m[0][0] * px + m[0][1] * py, cy + m[1][0] * px + m[1][1] * py
        pts = [fwd(u, v) for u, v in ((0, 0), (im.width, 0), (0, im.height), (im.width, im.height))]
        X0, Y0 = math.floor(min(p[0] for p in pts)), math.floor(min(p[1] for p in pts))
        X1, Y1 = math.ceil(max(p[0] for p in pts)), math.ceil(max(p[1] for p in pts))
        W, H = layer.size
        if X1 <= 0 or Y1 <= 0 or X0 >= W or Y0 >= H:
            return
        # inverse: p = M^-1 (p' - C) + C - d ; u = p.x - (x - ox)
        ia, ib = c / s, si / s
        idd, ie = -si / s, c / s
        offx, offy = cx - dx - (x - ox), cy - dy - (y - oy)
        a_ = ia; b_ = ib; c_ = ia * (X0 - cx) + ib * (Y0 - cy) + offx
        d_ = idd; e_ = ie; f_ = idd * (X0 - cx) + ie * (Y0 - cy) + offy
        out = im.transform((X1 - X0, Y1 - Y0), Image.Transform.AFFINE, (a_, b_, c_, d_, e_, f_), Image.Resampling.BICUBIC)
        if alpha < 0.999:
            a = out.getchannel("A").point(lambda v: int(v * alpha + 0.5))
            out.putalpha(a)
        # clip to the layer
        sx0, sy0 = max(0, -X0), max(0, -Y0)
        sx1, sy1 = min(out.width, W - X0), min(out.height, H - Y0)
        if sx1 <= sx0 or sy1 <= sy0:
            return
        if (sx0, sy0, sx1, sy1) != (0, 0, out.width, out.height):
            out = out.crop((sx0, sy0, sx1, sy1))
        layer.alpha_composite(out, (X0 + sx0, Y0 + sy0))

    def draw_items(self, layer, items):
        for it in items:
            if it["k"] == "box":
                self._box(layer, it)
                continue
            base = self.sprite(it["text"], it["font"], it["fill"], it.get("stroke", 0), it.get("strokeColor", "#000000"), it.get("fill2"))
            key = (it["text"], self.fonts.path(it["font"]), int(it["font"]["px"]), round(it.get("stroke", 0) * 4) / 4)
            a = it["alpha"]
            sh = it.get("shadow")
            if sh and sh["alpha"] > 0:
                self.place(layer, self.cached_silhouette(base, key, sh["color"], sh["sigma"]), it["x"], it["y"], it,
                           a * sh["alpha"], extra_dy=sh["dy"])
            gl = it.get("glow")
            if gl and gl["alpha"] > 0 and gl["sigma"] > 0:
                self.place(layer, self.cached_silhouette(base, key, gl["color"], gl["sigma"]), it["x"], it["y"], it, a * gl["alpha"])
            spr = base
            bl = it.get("blur", 0)
            if bl > 0.3:
                im, ox, oy = self._expand(*base, bl)
                spr = (im.filter(ImageFilter.GaussianBlur(bl)), ox, oy)
            self.place(layer, spr, it["x"], it["y"], it, a)
            wp = it.get("wipe")
            if wp and wp["frac"] > 0:
                act = self.sprite(it["text"], it["font"], wp["color"], it.get("stroke", 0), it.get("strokeColor", "#000000"))
                im, ox, oy = act
                cut = int(round(ox + wp["frac"] * it["w"]))
                if wp["frac"] >= 1:
                    cut = im.width
                if cut > 0:
                    crop = Image.new("RGBA", im.size, (0, 0, 0, 0))
                    crop.paste(im.crop((0, 0, cut, im.height)), (0, 0))
                    if bl > 0.3:
                        crop, ox, oy = self._expand(crop, ox, oy, bl)
                        crop = crop.filter(ImageFilter.GaussianBlur(bl))
                    self.place(layer, (crop, ox, oy), it["x"], it["y"], it, wp.get("a", a))

    def _box(self, layer, it):
        w, h = max(1, it["w"]), max(1, it["h"])
        im = Image.new("RGBA", (int(math.ceil(w)) + 4, int(math.ceil(h)) + 4), (0, 0, 0, 0))
        r = max(0, min(it.get("r", 0), min(w, h) / 2))
        ImageDraw.Draw(im).rounded_rectangle((2, 2, 2 + w - 1, 2 + h - 1), radius=int(round(r)), fill=rgb(it["color"]) + (255,))
        self.place(layer, (im, 2, 2), it["x"], it["y"], dict(it, dx=0, dy=0, rot=0), it["alpha"])
