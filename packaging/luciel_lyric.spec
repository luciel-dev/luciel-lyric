# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Luciel Lyric desktop app (onedir).

    python packaging/fetch_ffmpeg.py && python scripts/fetch_models.py && python packaging/make_icons.py
    pyinstaller packaging/luciel_lyric.spec --noconfirm

Output: dist/LucielLyric/ (Windows/Linux)  or  dist/Luciel Lyric.app (macOS).
LUCIEL_NO_VOCALS=1 builds without torch/demucs (vocal isolation disabled), e.g. for Intel Macs.
"""
import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = Path(SPECPATH).resolve().parent
sys.path.insert(0, str(ROOT))
from app.version import __version__, APP_NAME, APP_ID  # noqa: E402

NO_VOCALS = os.environ.get("LUCIEL_NO_VOCALS") == "1"
BUILD = ROOT / "packaging" / "build"
FF = BUILD / "ffmpeg"
for need in (FF, ROOT / "models" / "faster-whisper-base.en" / "model.bin"):
    if not need.exists():
        raise SystemExit(f"missing {need} - run packaging/fetch_ffmpeg.py and scripts/fetch_models.py first")

datas = [(str(ROOT / "static"), "static"), (str(FF), "ffmpeg"),
         (str(ROOT / "models" / "faster-whisper-base.en"), "models/faster-whisper-base.en"),
         (str(ROOT / "models" / "README.txt"), "models")]
if not NO_VOCALS:
    datas.append((str(ROOT / "models" / "hf"), "models/hf"))
binaries, hiddenimports = [], []
pkgs = ["faster_whisper", "ctranslate2", "onnxruntime", "av", "tokenizers", "webview"]
if not NO_VOCALS:
    pkgs += ["demucs", "julius", "lameenc", "sphn", "einops"]
for pkg in pkgs:
    try:
        d, b, h = collect_all(pkg)
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: collect_all({pkg}) failed: {e}")
        continue
    datas += d; binaries += b; hiddenimports += h
hiddenimports += collect_submodules("app") + collect_submodules("uvicorn") + [
    "python_multipart", "multipart", "rapidfuzz", "fontTools.ttLib", "fontTools.ttLib.woff2", "brotli",
    "PIL._imagingft", "huggingface_hub", "yaml"]
WIN, MAC = sys.platform == "win32", sys.platform == "darwin"
if WIN:
    boot = BUILD / "webview2" / "MicrosoftEdgeWebview2Setup.exe"
    if not boot.is_file():
        raise SystemExit("missing WebView2 bootstrapper - run packaging/fetch_webview2.py first")
    datas.append((str(boot), "."))
    hiddenimports += ["clr", "clr_loader", "pythonnet", "webview.platforms.winforms", "webview.platforms.edgechromium"]
if not NO_VOCALS:
    hiddenimports += ["torch", "demucs.separate", "demucs.pretrained", "demucs.htdemucs", "demucs.apply", "safetensors.torch"]

excludes = ["tkinter", "matplotlib", "IPython", "jupyter", "notebook", "pytest", "twine", "docutils", "keyring",
            "readme_renderer", "rich", "pygments", "static_ffmpeg", "torchvision", "tensorboard",
            "torch.utils.tensorboard", "sympy.testing"]
if NO_VOCALS:
    excludes += ["torch", "demucs", "julius", "sympy", "networkx", "jinja2"]

a = Analysis([str(ROOT / "desktop" / "luciel_desktop.py")], pathex=[str(ROOT)], binaries=binaries, datas=datas,
             hiddenimports=hiddenimports, hookspath=[], runtime_hooks=[], excludes=excludes, noarchive=False)
pyz = PYZ(a.pure)

icon = str(BUILD / ("icon.ico" if WIN else "icon.icns" if MAC else "icon.png"))
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="LucielLyric", debug=False, strip=False, upx=False,
          console=not (WIN or MAC),   # windowed on Windows/macOS (logs go to <data>/logs/luciel.log)
          icon=icon, codesign_identity=None, entitlements_file=None,
          version=str(BUILD / "version_info.txt") if WIN and (BUILD / "version_info.txt").exists() else None)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="LucielLyric")
if MAC:
    app = BUNDLE(coll, name=f"{APP_NAME}.app", icon=icon, bundle_identifier=APP_ID, version=__version__,
                 info_plist={"CFBundleName": APP_NAME, "CFBundleDisplayName": APP_NAME,
                             "CFBundleShortVersionString": __version__, "CFBundleVersion": __version__,
                             "LSMinimumSystemVersion": "14.0", "NSHighResolutionCapable": True,
                             "NSRequiresAquaSystemAppearance": False,
                             "LSApplicationCategoryType": "public.app-category.video"})
