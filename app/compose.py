"""Frame compositor: background (+ trim/loop, keyframed zoom/pan) -> waveform -> animated lyrics -> post FX,
piped as raw frames into ffmpeg. Mirrors the browser stage (static/engine/stage.js)."""
import math
import subprocess
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

from . import fx as FX
from .raster import Fonts, Raster, rgb
from .runtime import FFMPEG, FFPROBE
from .textanim import PRESETS, build_items, prepare, resolve, zoom_at
from .timeline import clip_at

FPS = 30
SIZES = {"9:16": (1080, 1920), "4:5": (1080, 1350), "1:1": (1080, 1080), "16:9": (1920, 1080)}
BG_MODES = ("gradient", "image", "video", "black", "green", "transparent")
OVERLAY_MODES = ("black", "green", "transparent")
# Output quality. scale is applied to SIZES; text animation still clocks at 30 fps internally.
QUALITIES = {
    "draft": {"scale": 0.5, "fps": 24, "crf": "28", "maxrate": "2M", "bufsize": "4M"},
    "standard": {"scale": 1.0, "fps": 30, "crf": "20", "maxrate": "6M", "bufsize": "12M"},
    "high": {"scale": 1.0, "fps": 30, "crf": "16", "maxrate": "12M", "bufsize": "24M"},
    "max": {"scale": 1.0, "fps": 60, "crf": "14", "maxrate": "20M", "bufsize": "40M"},
}


def quality_profile(name):
    key = (name or "standard").strip().lower()
    if key not in QUALITIES:
        key = "standard"
    return dict(QUALITIES[key], name=key)


def even_px(n):
    n = int(round(float(n)))
    if n % 2:
        n -= 1
    return max(2, n)


def zoom_preset(pid, clip_len, groups):
    """Same keyframe sets as LL.zoomPreset in textanim.js."""
    L = clip_len
    if pid == "pushin":
        return [{"t": 0, "z": 1, "x": .5, "y": .5, "ease": "linear"}, {"t": L, "z": 1.18, "x": .5, "y": .5, "ease": "inOutSine"}]
    if pid == "pullout":
        return [{"t": 0, "z": 1.25, "x": .5, "y": .5, "ease": "linear"}, {"t": L, "z": 1, "x": .5, "y": .5, "ease": "outCubic"}]
    if pid == "kenburns":
        return [{"t": 0, "z": 1.15, "x": .42, "y": .46, "ease": "linear"}, {"t": L, "z": 1.15, "x": .58, "y": .54, "ease": "inOutSine"}]
    if pid == "punch":
        ks = [{"t": 0, "z": 1, "x": .5, "y": .5, "ease": "linear"}]
        last, seen = 0.0, []
        for g in groups:
            if g["line"] not in seen:
                seen.append(g["line"])
                s = g["words"][0]["s"]
                if s < last + 0.75 or s > L - 0.2:
                    continue
                ks += [{"t": round(s - 0.01, 3), "z": 1, "x": .5, "y": .5, "ease": "linear"},
                       {"t": round(s + 0.1, 3), "z": 1.12, "x": .5, "y": .5, "ease": "outCubic"},
                       {"t": round(min(L, s + 0.65), 3), "z": 1, "x": .5, "y": .5, "ease": "inOutSine"}]
                last = s + 0.65
        return ks
    return []


def gradient_frame(cols, t, W, H, scale=4):
    """Slowly rotating linear gradient (same formula as the canvas preview)."""
    w, h = max(2, W // scale), max(2, H // scale)
    th = 0.785 + 0.12 * t
    c, s = math.cos(th), math.sin(th)
    R = W / 2 * abs(c) + H / 2 * abs(s)
    xs = (np.arange(w, dtype=np.float32) + 0.5) / w * W - W / 2
    ys = (np.arange(h, dtype=np.float32) + 0.5) / h * H - H / 2
    u = np.clip((xs[None, :] * c + ys[:, None] * s) / R * 0.5 + 0.5, 0, 1)
    C = np.array([rgb(x) for x in cols], np.float32)
    n = len(C) - 1
    pos = u * n; i = np.minimum(pos.astype(np.int32), n - 1); f = (pos - i)[..., None]
    img = C[i] * (1 - f) + C[i + 1] * f
    return Image.fromarray((img + 0.5).astype(np.uint8)).resize((W, H), Image.Resampling.BILINEAR)


def zoom_img(im, z, cx, cy, W, H, src_box=None):
    """Crop a (z, centre) viewport out of im (or out of src_box inside im) and scale to WxH. Float box = sub-pixel
    accurate so slow zooms/pans don't step or jitter."""
    bx0, by0, bx1, by1 = src_box or (0, 0, im.width, im.height)
    bw, bh = bx1 - bx0, by1 - by0
    vw, vh = bw / z, bh / z
    x0 = min(max(bx0, bx0 + cx * bw - vw / 2), bx1 - vw); y0 = min(max(by0, by0 + cy * bh - vh / 2), by1 - vh)
    return im.resize((W, H), Image.Resampling.BICUBIC, box=(x0, y0, x0 + vw, y0 + vh))


def _even(n):
    n = int(round(n))
    if n % 2:
        n -= 1
    return max(2, n)


def normalize_place(place):
    """Video box inside the output frame. Absent values mean fill, scale 1, centered."""
    p = place if isinstance(place, dict) else {}
    fit = p.get("fit") if p.get("fit") in ("fill", "fit", "crop") else "fill"
    try:
        scale = float(p.get("scale", 1) if p.get("scale") is not None else 1)
    except (TypeError, ValueError):
        scale = 1.0
    scale = min(4.0, max(0.2, scale))
    try:
        x = 0.5 if p.get("x") is None else float(p.get("x"))
        y = 0.5 if p.get("y") is None else float(p.get("y"))
    except (TypeError, ValueError):
        x, y = 0.5, 0.5
    return {"fit": fit, "scale": scale, "x": x, "y": y}


def place_is_cover(place):
    p = normalize_place(place)
    return p["fit"] == "fill" and abs(p["scale"] - 1) < 1e-3 and abs(p["x"] - 0.5) < 1e-3 and abs(p["y"] - 0.5) < 1e-3


def place_box(sw, sh, W, H, place):
    """Destination rectangle. Mirrors static/engine/layers.js placeBox."""
    p = normalize_place(place)
    sw, sh, W, H = float(max(1, sw)), float(max(1, sh)), float(max(1, W)), float(max(1, H))
    cover = p["fit"] != "fit"
    sar, ar = sw / sh, W / H
    if cover:
        dw, dh = (H * sar, H) if sar > ar else (W, W / sar)
    elif sar > ar:
        dw, dh = W, W / sar
    else:
        dh, dw = H, H * sar
    dw *= p["scale"]
    dh *= p["scale"]
    return p["x"] * W - dw / 2, p["y"] * H - dh / 2, dw, dh


def place_video(im, W, H, place):
    x, y, dw, dh = place_box(im.width, im.height, W, H, place)
    canvas = Image.new("RGB", (int(W), int(H)), (0, 0, 0))
    resized = im.resize((max(1, int(round(dw))), max(1, int(round(dh)))), Image.Resampling.BICUBIC)
    canvas.paste(resized, (int(round(x)), int(round(y))))
    return canvas


def probe_video_wh(path):
    r = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(path)],
                       capture_output=True, text=True)
    parts = (r.stdout or "").strip().split("x")
    try:
        return max(2, int(float(parts[0]))), max(2, int(float(parts[1])))
    except (IndexError, ValueError):
        return 1280, 720


def cover_box(sw, sh, W, H):
    """Centred crop of a sw x sh source that has the W:H aspect."""
    ar, sar = W / H, sw / sh
    if sar > ar:
        cw = sh * ar; return ((sw - cw) / 2, 0, (sw + cw) / 2, sh)
    ch = sw / ar; return (0, (sh - ch) / 2, sw, (sh + ch) / 2)


class VideoSource:
    """Decodes the trimmed segment [vin, vout) of a background video at WxH rgb24, looping it."""

    def __init__(self, path, vin, vout, W, H, blur=0.0, darken=0.0, oversample=1.0, fps=None, raw=False):
        self.path, self.vin, self.vout = str(path), vin, vout
        self.fps = int(fps or FPS)
        self.raw = raw
        if raw:
            sw, sh = probe_video_wh(path)
            cap = max(W, H)
            scale = min(1.0, cap / max(sw, sh))
            self.W, self.H = _even(sw * scale), _even(sh * scale)
            chain = [f"fps={self.fps}", f"scale={self.W}:{self.H}:flags=bicubic", "setsar=1"]
        else:
            self.W, self.H = int(round(W * oversample / 2) * 2), int(round(H * oversample / 2) * 2)
            chain = [f"fps={self.fps}", f"scale={self.W}:{self.H}:force_original_aspect_ratio=increase:flags=bicubic",
                     f"crop={self.W}:{self.H}", "setsar=1"]
        if blur > 0.05:
            chain.append(f"gblur=sigma={blur * oversample:.2f}")
        k = 1.0 - max(0.0, min(0.9, darken))
        if k < 0.999:
            chain.append(f"colorchannelmixer=rr={k:.3f}:gg={k:.3f}:bb={k:.3f}")
        self.vf = ",".join(chain)
        self.p = None; self.n = 0
        self.fsz = self.W * self.H * 3

    def _open(self):
        if self.p:
            self.p.kill(); self.p.wait()
        cmd = [FFMPEG, "-v", "error", "-ss", f"{self.vin:.3f}"]
        if self.vout and self.vout > self.vin:
            cmd += ["-t", f"{self.vout - self.vin:.3f}"]
        cmd += ["-i", self.path, "-an", "-vf", self.vf, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]
        self.p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=self.fsz * 2)
        self.n = 0

    def read(self):
        for _ in range(2):
            if self.p is None:
                self._open()
            buf = self.p.stdout.read(self.fsz)
            if buf and len(buf) == self.fsz:
                self.n += 1
                return Image.frombuffer("RGB", (self.W, self.H), buf, "raw", "RGB", 0, 1)
            if self.n == 0 and self.p is not None:   # decoded nothing at all
                break
            self._open()   # loop the trimmed segment
        raise RuntimeError("could not decode background video")

    def close(self):
        if self.p:
            self.p.kill(); self.p.wait()


class ClipDeck:
    """One video track. Frame ``fi`` shows the clip covering that time, or black in a gap.
    The decoder stays open while frames are read in order and reopens on a seek or a new clip."""

    def __init__(self, clips, W, H, fps, blur=0.0, darken=0.0, oversample=1.0):
        self.clips = list(clips)
        self.W, self.H, self.fps = W, H, int(fps)
        self.blur, self.darken, self.oversample = blur, darken, oversample
        self.src = None
        self.key = None
        self.raw = None
        self.next_local = None

    def close(self):
        if self.src:
            self.src.close()
            self.src = None
        self.key = None
        self.raw = None
        self.next_local = None

    def _blank(self):
        return Image.new("RGB", (self.W, self.H), (0, 0, 0))

    def read_at(self, fi):
        hit = clip_at(self.clips, fi / self.fps)
        if hit is None:
            self.close()
            return self._blank()
        i, clip, local = hit
        local_fi = int(math.floor(local * self.fps + 1e-6))
        place = clip.get("place")
        raw = not place_is_cover(place)
        if self.src is None or self.key != i or self.raw != raw or self.next_local != local_fi:
            self.close()
            vin = float(clip.get("in") or 0) + local_fi / self.fps
            self.src = VideoSource(clip["path"], vin, clip.get("out"), self.W, self.H,
                                   self.blur, self.darken, self.oversample, fps=self.fps, raw=raw)
            self.key = i
            self.raw = raw
            self.next_local = local_fi
        frame = self.src.read()
        self.next_local = local_fi + 1
        if raw:
            frame = place_video(frame, self.W, self.H, place)
        return frame


def load_audio_mono(path, start, length, sr=44100):
    r = subprocess.run([FFMPEG, "-v", "error", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(path),
                        "-ac", "1", "-ar", str(sr), "-f", "f32le", "pipe:1"], capture_output=True)
    return np.frombuffer(r.stdout, np.float32), sr


def wave_columns(samples, sr, t, W, fps=FPS):
    """Per-column amplitude (0..1, sqrt scaled) for the frame at time t - same as stage.js."""
    i0 = int(t * sr); n = max(1, sr // int(fps or FPS))
    seg = samples[i0:i0 + n]
    if len(seg) == 0:
        return np.zeros(W, np.float32)
    idx = (np.arange(W) * len(seg) // W)
    return np.sqrt(np.clip(np.abs(seg[idx]), 0, 1))


def _viz_params(viz):
    viz = viz or {}
    style = viz.get("style") or "line"
    if style not in ("line", "bars", "mirror"):
        style = "line"
    try:
        y = float(viz.get("y", 0.86))
    except (TypeError, ValueError):
        y = 0.86
    try:
        h = float(viz.get("h", 0.10))
    except (TypeError, ValueError):
        h = 0.10
    try:
        alpha = float(viz.get("alpha", 0.75))
    except (TypeError, ValueError):
        alpha = 0.75
    return style, y, h, max(0.0, min(1.0, alpha))


def _paint_line(frame, amp, col, y0, wh, alpha, alpha_mode):
    """Centred line. Default y/h/alpha matches the historical draw_wave pixels."""
    H = frame.shape[0]
    if wh < 1 or alpha <= 0 or y0 >= H:
        return
    if y0 < 0:
        wh += y0
        y0 = 0
    if wh < 1:
        return
    wh = min(wh, H - y0)
    ys = np.arange(wh, dtype=np.float32)[:, None] - (wh - 1) / 2
    hh = (amp * wh / 2)[None, :]
    m = (np.abs(ys) <= np.maximum(hh, 0.5)).astype(np.float32) * alpha
    reg = frame[y0:y0 + wh].astype(np.float32)
    reg[..., :3] = reg[..., :3] * (1 - m[..., None]) + col * m[..., None]
    if alpha_mode and frame.shape[2] == 4:
        reg[..., 3] = reg[..., 3] * (1 - m) + 255 * m
    frame[y0:y0 + wh] = (reg + 0.5).astype(np.uint8)


def draw_wave(frame, amp, color, H, alpha_mode=False, viz=None):
    """frame: HxWx(3|4) uint8 array (modified in place).

    viz: {style: line|bars|mirror, y, h, alpha}. Defaults are the original line at 0.86H.
    """
    style, yf, hf, alpha = _viz_params(viz)
    W = frame.shape[1]
    wh = int(H * hf)
    mid = int(H * yf)
    y0 = mid - wh // 2
    if wh < 1:
        wh = 1
    if y0 < 0 or y0 + wh > H:
        y0 = min(max(0, y0), max(0, H - wh))
    col = np.array(color, np.float32)
    if style == "bars":
        nb = 32
        for i in range(nb):
            x0 = int(i * W / nb)
            x1 = int((i + 1) * W / nb)
            if x1 <= x0:
                continue
            xc = min(W - 1, (x0 + x1) // 2)
            v = float(amp[xc]) if len(amp) else 0.0
            bh = max(1, int(round(v * wh)))
            gap = 1 if x1 - x0 > 2 else 0
            bw = max(1, x1 - x0 - gap)
            by = y0 + wh - bh
            if by < 0:
                bh += by
                by = 0
            if by >= H or bh < 1:
                continue
            bh = min(bh, H - by)
            reg = frame[by:by + bh, x0:x0 + bw].astype(np.float32)
            reg[..., :3] = reg[..., :3] * (1 - alpha) + col * alpha
            if alpha_mode and frame.shape[2] == 4:
                reg[..., 3] = reg[..., 3] * (1 - alpha) + 255 * alpha
            frame[by:by + bh, x0:x0 + bw] = (reg + 0.5).astype(np.uint8)
        return
    _paint_line(frame, amp, col, y0, wh, alpha, alpha_mode)
    if style == "mirror":
        _paint_line(frame, amp, col, y0 + int(wh * 0.85), max(1, int(wh * 0.45)), alpha * 0.4, alpha_mode)


def _paint_overlays(base, overlays, t, W, H):
    """Extra titles and credits. They are not lyric lines."""
    if not overlays:
        return base
    from PIL import ImageDraw, ImageFont
    im = base.convert("RGBA")
    dr = ImageDraw.Draw(im)
    font_path = next((p for p in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ) if Path(p).exists()), None)
    for ov in overlays:
        if not isinstance(ov, dict):
            continue
        try:
            if t < float(ov.get("start") or 0) or t > float(ov.get("end") or 1e9):
                continue
            text = str(ov.get("text") or "")
            if not text:
                continue
            px = max(10, int(float(ov.get("size") or 0.06) * min(W, H) * float(ov.get("scale") or 1)))
            x = float(ov.get("x") if ov.get("x") is not None else 0.5) * W
            y = float(ov.get("y") if ov.get("y") is not None else 0.12) * H
        except (TypeError, ValueError):
            continue
        font = ImageFont.truetype(font_path, px) if font_path else ImageFont.load_default()
        dr.text((x, y), text, fill=ov.get("color") or "#ffffff", font=font, anchor="mm")
    return im.convert(base.mode)


def build(audio_path, start, length, *, aspect="9:16", look="neon", anim_id="karaoke",
          style=None, anim=None, lines=(), title="", artist="", visualizer=True, bg_mode="gradient", bg_image=None,
          bg_video=None, video_clips=None, zoom=None, fx_list=(), font_files=None, size=None, full_width=None,
          quality="standard", fps=None, overlays=()):
    """Set up a scene. Returns (compose(frame_index, bg_frame) -> bytes, video_source_or_None, info)."""
    prof = quality_profile(quality)
    out_fps = int(fps or prof["fps"])
    base_w, base_h = SIZES.get(aspect, SIZES["9:16"])
    if size is None:
        W, H = even_px(base_w * prof["scale"]), even_px(base_h * prof["scale"])
    else:
        W, H = size
    if bg_mode not in BG_MODES:
        raise RuntimeError(f"unknown background mode {bg_mode}")
    st, an, lk = resolve(look, anim_id, style, anim)
    if bg_mode == "green":   # soft halos mix with the key colour
        st["glow"] = 0; st["shadowBlur"] = 0; st["titleShadowBlur"] = 0
    fonts = Fonts(font_files); raster = Raster(fonts)
    groups = prepare(list(lines), st, an, length)
    line_starts = sorted({g["words"][0]["s"] for g in groups if g["words"]})
    sc = {"W": W, "H": H, "style": st, "anim": an, "measure": fonts.measure, "groups": groups, "title": title,
          "artist": artist or "", "clipLen": length, "layKey": f"{W}x{H}"}
    zoom = zoom or {}
    keys = zoom.get("keys") or zoom_preset(zoom.get("preset") or "none", length, groups)
    target = zoom.get("target") or "bg"
    fx_list = [f for f in (fx_list or []) if f.get("on", True)]
    skipped = [f["id"] for f in fx_list if not FX.allowed(f["id"], f.get("option"), bg_mode)]
    fx_on = [f for f in fx_list if f["id"] not in skipped]
    alpha = bg_mode == "transparent"
    wave_col = rgb(st.get("vizColor") or lk.get("wave", "#ffffff"))
    if bg_mode == "green":
        wave_col = (wave_col[0], min(wave_col[1], 77), wave_col[2])
    viz = {"style": st.get("vizStyle") or "line", "y": st.get("vizY", 0.86), "h": st.get("vizH", 0.10),
           "alpha": st.get("vizAlpha", 0.75)}
    samples, sr = load_audio_mono(audio_path, start, length) if visualizer else (None, 44100)

    # background sources
    src_img = src_box = None
    vsrc = None
    if bg_mode == "image":
        im = Image.open(bg_image).convert("RGB")
        box = cover_box(im.width, im.height, W, H)
        bw = box[2] - box[0]
        if bw > W * 1.6:   # pre-shrink huge photos; keep 1.6x headroom for zooming in
            f = W * 1.6 / bw
            im = im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.Resampling.LANCZOS)
            box = cover_box(im.width, im.height, W, H)
        src_img = im.point(lambda v: int(v * 0.65 + 0.5)); src_box = box
    elif bg_mode == "video":
        v = bg_video or {}
        zmax = max([k["z"] for k in keys] + [1.0]) if target == "bg" else 1.0
        blur_px = float(v.get("blur", 0)) * W / (full_width or base_w)   # blur is specified at full output size
        over = 1.25 if zmax > 1.05 else 1.0
        darken = float(v.get("darken", 0))
        if video_clips is not None:
            if video_clips:
                vsrc = ClipDeck(video_clips, W, H, out_fps, blur_px, darken, over)
        elif v.get("path"):
            vsrc = VideoSource(v["path"], float(v.get("in", 0) or 0), v.get("out"), W, H, blur_px,
                               darken, oversample=over, fps=out_fps)
    solid = {"black": (0, 0, 0), "green": (0, 255, 0)}.get(bg_mode)

    def compose(fi, bg):
        t = fi / out_fps
        z, zx, zy = zoom_at(t, keys)
        if bg_mode == "transparent":
            frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        elif solid:
            frame = Image.new("RGB", (W, H), solid)
        elif bg_mode == "gradient":
            frame = gradient_frame(lk["grad"], t, W, H)
            if target == "bg" and z > 1.0005:
                frame = zoom_img(frame, z, zx, zy, W, H)
        elif bg_mode == "image":
            frame = zoom_img(src_img, z if target == "bg" else 1, zx, zy, W, H, src_box)
        else:
            if bg is None:
                frame = Image.new("RGB", (W, H), (0, 0, 0))
            elif (target == "bg" and z > 1.0005) or bg.size != (W, H):
                frame = zoom_img(bg, z if target == "bg" else 1, zx, zy, W, H)
            else:
                frame = bg
        arr = np.array(frame)
        if visualizer and samples is not None:
            draw_wave(arr, wave_columns(samples, sr, t, W, out_fps), wave_col, H, alpha_mode=alpha, viz=viz)
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        raster.draw_items(layer, build_items(t, sc))
        if alpha:
            base = Image.fromarray(arr, "RGBA"); base.alpha_composite(layer)
        else:
            base = Image.fromarray(arr, "RGB").convert("RGBA"); base.alpha_composite(layer); base = base.convert("RGB")
        if target == "all" and z > 1.0005:
            base = zoom_img(base, z, zx, zy, W, H)
            if fx_on and any(f["id"] == "streak" for f in fx_on):
                layer = zoom_img(layer, z, zx, zy, W, H)
        out = np.asarray(base)
        if fx_on and not alpha:
            out = FX.apply(out, np.asarray(layer), t, fx_on, line_starts, bg_mode)
        base = Image.fromarray(out, "RGBA" if alpha else "RGB")
        base = _paint_overlays(base, overlays, t, W, H)
        out = np.asarray(base)
        return np.ascontiguousarray(out).tobytes()

    info = {"W": W, "H": H, "alpha": alpha, "skipped": skipped, "style": st, "fps": out_fps,
            "quality": prof["name"]}
    return compose, vsrc, info


def _pull_bg(vsrc, fi):
    if vsrc is None:
        return None
    if isinstance(vsrc, ClipDeck):
        return vsrc.read_at(fi)
    bg = None
    for _ in range(fi + 1):
        bg = vsrc.read()
    return bg


def still(t, audio_path, start, length, **kw):
    """One composed frame as a PIL image (used for preview/render parity checks and /api/still)."""
    compose, vsrc, info = build(audio_path, start, length, **kw)
    fps = info.get("fps", FPS)
    fi = int(math.floor(t * fps + 0.5 + 1e-6))
    try:
        bg = _pull_bg(vsrc, fi)
    finally:
        if vsrc:
            vsrc.close()
    raw = compose(fi, bg)
    return Image.frombytes("RGBA" if info["alpha"] else "RGB", (info["W"], info["H"]), raw)


def render(audio_path, start, length, out_path, work_dir, *, transparent_format="mov", threads=6, progress=None,
           bg_video=None, bg_mode="gradient", quality="standard", **kw):
    """zoom: {"keys": [...], "preset": id, "target": "bg"|"all"}; bg_video: {path, in, out, darken, blur,
    mix_audio, video_volume, has_audio}. quality selects resolution, fps and x264 rate control.
    Returns dict with output path, timings and skipped FX. ``fps`` stays the encode throughput;
    ``output_fps`` is the file's frame rate."""
    work_dir = Path(work_dir); work_dir.mkdir(parents=True, exist_ok=True)
    prof = quality_profile(quality)
    compose, vsrc, info = build(audio_path, start, length, bg_video=bg_video, bg_mode=bg_mode, quality=quality, **kw)
    W, H, alpha, skipped, st = info["W"], info["H"], info["alpha"], info["skipped"], info["style"]
    out_fps = info["fps"]
    fonts = Fonts(kw.get("font_files"))

    # encoder
    L = f"{length:.3f}"
    pix = "rgba" if alpha else "rgb24"
    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", pix, "-s", f"{W}x{H}",
           "-r", str(out_fps), "-i", "pipe:0", "-ss", f"{start:.3f}", "-t", L, "-i", str(audio_path)]
    a_in = "[1:a]"; fg = []
    if bg_mode == "video" and bg_video and bg_video.get("mix_audio") and bg_video.get("has_audio"):
        vol = max(0.0, min(2.0, float(bg_video.get("video_volume", 0.5))))
        vin = float(bg_video.get("in", 0) or 0)
        vout = float(bg_video.get("out") or bg_video.get("duration") or 0)
        cmd += ["-i", str(bg_video["path"])]
        chain = f"[2:a]aresample=44100,atrim=start={vin:.3f}" + (f":end={vout:.3f}" if vout > vin else "") + ",asetpts=N/SR/TB"
        if bg_video.get("loop_audio", True) and vout > vin:   # legacy single clip loops with the picture
            chain += f",aloop=loop=-1:size={int((vout - vin) * 44100)}"
        fg += [f"{chain},volume={vol:.2f}[va]", f"{a_in}[va]amix=inputs=2:duration=first:normalize=0[am]"]
        a_in = "[am]"
    fade_out = max(0.0, length - 0.6)
    fg.append(f"{a_in}afade=t=in:d=0.3,afade=t=out:st={fade_out:.2f}:d=0.6[aout]")
    cmd += ["-filter_complex", ";".join(fg), "-map", "0:v", "-map", "[aout]", "-t", L]
    out_path = Path(out_path).resolve()
    if alpha and transparent_format == "webm":
        out_path = out_path.with_suffix(".webm")
        cmd += ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30", "-deadline", "good",
                "-cpu-used", "5", "-row-mt", "1", "-auto-alt-ref", "0", "-c:a", "libopus", "-b:a", "160k"]
    elif alpha:
        out_path = out_path.with_suffix(".mov")
        cmd += ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0", "-c:a", "pcm_s16le"]
    else:
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", prof["crf"], "-maxrate", prof["maxrate"],
                "-bufsize", prof["bufsize"], "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]
    cmd.append(str(out_path))
    log = open(work_dir / "ffmpeg.log", "w", encoding="utf-8", errors="replace")
    log.write(" ".join(cmd) + "\n\n"); log.flush()
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=log)
    n_frames = int(round(length * out_fps))
    t0 = time.time()
    err = None
    try:
        with ThreadPoolExecutor(max_workers=max(1, threads)) as ex:
            q = deque()
            for fi in range(n_frames):
                if vsrc is None:
                    bg = None
                elif isinstance(vsrc, ClipDeck):
                    bg = vsrc.read_at(fi)
                else:
                    bg = vsrc.read()
                q.append(ex.submit(compose, fi, bg))
                while len(q) >= threads * 2:
                    enc.stdin.write(q.popleft().result())
                if progress and fi % 30 == 0:
                    progress(fi / n_frames)
            while q:
                enc.stdin.write(q.popleft().result())
    except BrokenPipeError:
        err = "encoder stopped early"
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        raise
    finally:
        try:
            enc.stdin.close()
        except Exception:
            pass
        rc = enc.wait()
        if vsrc:
            vsrc.close()
        log.close()
    if rc != 0 or err:
        tail = (work_dir / "ffmpeg.log").read_text(encoding="utf-8", errors="replace").splitlines()[-12:]
        raise RuntimeError(f"ffmpeg failed ({err or rc}): " + "\n".join(tail))
    return {"out": str(out_path), "bg_mode": bg_mode, "fx_skipped": skipped, "frames": n_frames,
            "compose_s": round(time.time() - t0, 2), "fps": round(n_frames / max(1e-6, time.time() - t0), 1),
            "output_fps": out_fps, "quality": prof["name"],
            "font_file": Path(fonts.path({"family": st["font"], "weight": st["weight"], "fontId": st.get("fontId") or ""})).name}
