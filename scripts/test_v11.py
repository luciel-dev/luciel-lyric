"""v1.1 checks: quality profiles, timeline cuts, waveform styles, artist text. No network and no ffmpeg."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import numpy as np

from app.compose import draw_wave, even_px, quality_profile
from app.textanim import PRESETS, build_items
from app.timeline import clip_at, clip_dur, split_at


def test_quality():
    assert quality_profile("draft")["fps"] == 24 and quality_profile("draft")["crf"] == "28"
    assert quality_profile("standard")["crf"] == "20" and quality_profile("standard")["maxrate"] == "6M"
    assert quality_profile("high")["maxrate"] == "12M" and quality_profile("high")["fps"] == 30
    assert quality_profile("max")["fps"] == 60 and quality_profile("max")["crf"] == "14"
    assert quality_profile("nope")["name"] == "standard"
    assert (even_px(1080 * 0.5), even_px(1920 * 0.5)) == (540, 960)
    assert (even_px(1920), even_px(1080)) == (1920, 1080)
    assert (even_px(1080), even_px(1920)) == (1080, 1920)


def legacy_wave(frame, amp, color, H):
    wh = int(H * 0.10); mid = int(H * 0.86)
    y0 = mid - wh // 2
    ys = np.arange(wh, dtype=np.float32)[:, None] - (wh - 1) / 2
    hh = (amp * wh / 2)[None, :]
    m = (np.abs(ys) <= np.maximum(hh, 0.5)).astype(np.float32) * 0.75
    reg = frame[y0:y0 + wh].astype(np.float32)
    col = np.array(color, np.float32)
    reg[..., :3] = reg[..., :3] * (1 - m[..., None]) + col * m[..., None]
    frame[y0:y0 + wh] = (reg + 0.5).astype(np.uint8)


def test_wave():
    rng = np.random.default_rng(0)
    amp = rng.random(64).astype(np.float32)
    H, W = 200, 64
    a = np.full((H, W, 3), 10, np.uint8)
    b = np.full((H, W, 3), 10, np.uint8)
    draw_wave(a, amp, (255, 20, 40), H)
    legacy_wave(b, amp, (255, 20, 40), H)
    assert np.array_equal(a, b), "default line must match the 1.0 waveform"
    styles = {}
    for s in ("line", "bars", "mirror"):
        f = np.zeros((H, W, 3), np.uint8)
        draw_wave(f, amp, (0, 255, 0), H, viz={"style": s, "y": 0.7, "h": 0.2, "alpha": 0.9})
        styles[s] = f
        assert int(f.sum()) > 0
    assert not np.array_equal(styles["line"], styles["bars"])
    assert not np.array_equal(styles["line"], styles["mirror"])


def test_timeline():
    clips = [
        {"id": "a", "in": 0, "out": 4, "start": 0},
        {"id": "b", "in": 1, "out": 3, "start": 3},
    ]
    assert clip_dur(clips[0]) == 4
    hit = clip_at(clips, 3.5)
    assert hit[0] == 1 and abs(hit[2] - 0.5) < 1e-9
    assert clip_at(clips, 10) is None
    try:
        split_at(clips, 0.05)
        raise AssertionError("edge cut should fail")
    except ValueError:
        pass
    out = split_at([{"id": "a", "in": 0, "out": 4, "start": 0}], 1.5)
    assert len(out) == 2
    assert abs(out[0]["out"] - 1.5) < 1e-9
    assert abs(out[1]["in"] - 1.5) < 1e-9 and abs(out[1]["start"] - 1.5) < 1e-9
    assert abs(clip_dur(out[0]) + clip_dur(out[1]) - 4) < 1e-9


def measure(s, f):
    return max(1, len(s)) * f["px"] * 0.5


def test_artist():
    style = dict(PRESETS["styleDefaults"])
    anim = dict(PRESETS["animDefaults"])
    sc = {"W": 1080, "H": 1920, "style": style, "anim": anim, "measure": measure,
          "groups": [], "title": "Hello", "clipLen": 20, "layKey": "a"}
    items = build_items(0.5, sc)
    assert len(items) == 1 and items[0]["text"] == "Hello"
    sc["artist"] = "Ada"
    items = build_items(0.5, sc)
    assert [it["text"] for it in items] == ["Hello", "Ada"]
    assert items[1]["fill"] == "#ffffff"
    sc["artist"] = ""
    assert len(build_items(0.5, sc)) == 1


if __name__ == "__main__":
    test_quality()
    test_wave()
    test_timeline()
    test_artist()
    print("v1.1 tests ok")
