"""Post-install check for Luciel Lyric (run by the Install script: scripts/setup.sh / scripts/setup.ps1).

  python scripts/check_setup.py [--fetch-ffmpeg]

Verifies the Python packages, bundled models and fonts, and finds a suitable ffmpeg.
With --fetch-ffmpeg it downloads a static ffmpeg build (pip package `static-ffmpeg`) when no
suitable system ffmpeg exists. That is the only download; after it the app runs offline.
"""
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

ok = True


def say(flag, msg):
    global ok
    print(f"  [{'OK' if flag else '!!'}] {msg}")
    if flag is False:
        ok = False


print("Checking Luciel Lyric install...")
v = sys.version_info
say(v >= (3, 12), f"Python {v.major}.{v.minor}.{v.micro}" + ("" if v >= (3, 12) else " (need 3.12 or newer)"))
for mod in ("fastapi", "uvicorn", "multipart", "faster_whisper", "ctranslate2", "rapidfuzz", "numpy", "fontTools"):
    say(importlib.util.find_spec(mod) is not None, f"python package {mod}")
has_demucs = all(importlib.util.find_spec(m) for m in ("torch", "demucs"))
print(f"  [{'OK' if has_demucs else '--'}] vocal isolation (torch + demucs)"
      + ("" if has_demucs else ": not installed - the app works, just without the 'isolate vocals' option"))

models = ROOT / "models"
say((models / "faster-whisper-base.en" / "model.bin").exists(), "speech model models/faster-whisper-base.en")
has_vm = any((models / "hf" / "hub" / "models--adefossez--HTDemucs").rglob("*.safetensors"))
print(f"  [{'OK' if has_vm else '--'}] vocal model models/hf/.../HTDemucs"
      + ("" if has_vm else ": missing - run  python scripts/fetch_models.py  (needed for 'isolate vocals')"))
fonts = list((ROOT / "static" / "fonts" / "render").glob("*.ttf"))
say(len(fonts) >= 4, f"{len(fonts)} bundled render fonts")

from app import runtime  # noqa: E402

if runtime.FFMPEG_SOURCE == "unverified" and "--fetch-ffmpeg" in sys.argv:
    print(f"  [..] no suitable ffmpeg on this computer ({runtime.FFMPEG_NOTE or 'not found'})")
    print("       downloading a portable ffmpeg build (one time, ~50-80 MB)...", flush=True)
    try:
        from static_ffmpeg import run as sf
        sf.get_or_fetch_platform_executables_else_raise()
    except Exception as e:  # noqa: BLE001
        print(f"       download failed: {e}")
    runtime.FFMPEG, runtime.FFPROBE, runtime.FFMPEG_SOURCE, runtime.FFMPEG_NOTE = runtime.find_ffmpeg()

if runtime.FFMPEG_SOURCE == "unverified":
    say(False, f"ffmpeg: {runtime.FFMPEG_NOTE or 'not found'}")
    print("""
  ffmpeg is needed to read audio and render videos. Either run Install again with internet
  (it downloads a portable copy automatically) or install it yourself:
    macOS   : brew install ffmpeg
    Windows : winget install Gyan.FFmpeg   (then open a new terminal)
    Linux   : sudo apt install ffmpeg   /  sudo dnf install ffmpeg  /  sudo pacman -S ffmpeg
""")
else:
    say(True, f"ffmpeg: {runtime.FFMPEG} ({runtime.FFMPEG_SOURCE})")

print("\nAll checks passed." if ok else
      "\nSome checks failed - see the messages above and INSTALL.md.")
sys.exit(0 if ok else 1)
