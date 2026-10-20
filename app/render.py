"""Render entry point. Frames are composed in Python (app/compose.py: background + zoom/pan, waveform,
animated lyrics from app/textanim.py + app/raster.py, post FX from app/fx.py) and encoded with ffmpeg.
The browser preview (static/engine/*.js) runs the same maths."""
from .compose import BG_MODES, OVERLAY_MODES, SIZES, render  # noqa: F401
from .textanim import PRESETS as ENGINE

LOOKS = ENGINE["looks"]
# legacy name kept for API compatibility (/api/config "presets" = looks)
PRESETS = {k: {"label": v["label"], "font": v["style"]["font"], "hi": v["style"]["active"], "grad": v["grad"],
               "upper": v["style"]["upper"]} for k, v in LOOKS.items()}
