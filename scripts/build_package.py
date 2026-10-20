"""Build the distributable LucielLyric.zip (app folder named LucielLyric/).

  .venv/bin/python scripts/build_package.py [--lite] [out.zip]
  --lite: no model weights and no demo MP4 (~15 MB zip); setup downloads the weights once.
Excludes data/, .venv/, samples/, logs and caches; includes models/, docs/ and the setup/start scripts.
"""
import os
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LITE = "--lite" in sys.argv   # leave out the model weights; setup downloads them (scripts/fetch_models.py)
args = [a for a in sys.argv[1:] if not a.startswith("--")]
OUT = Path(args[0] if args else ("/workspace/LucielLyric-lite.zip" if LITE else "/workspace/LucielLyric.zip"))
INCLUDE = ["Install.command", "Install.bat", "install.sh", "Start Luciel Lyric.command", "Start Luciel Lyric.bat",
           "start.sh", "INSTALL.md", "README.md", "app", "static", "models", "docs", "scripts"]
SKIP_DIRS = {"__pycache__", ".pytest_cache", ".mypy_cache", ".git"}
SKIP_SUFFIX = {".pyc", ".pyo", ".log"}
EXEC = {"Install.command", "install.sh", "Start Luciel Lyric.command", "start.sh", "setup.sh"}
STORE = {".mp3", ".mp4", ".png", ".webp", ".webm", ".woff2"}  # already compressed

n = 0
OUT.unlink(missing_ok=True)
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    def add(p: Path):
        global n
        arc = "LucielLyric/" + p.relative_to(ROOT).as_posix()
        zi = zipfile.ZipInfo.from_file(p, arc)
        zi.external_attr = ((0o755 if p.name in EXEC else 0o644) | 0o100000) << 16
        zi.compress_type = zipfile.ZIP_STORED if p.suffix.lower() in STORE else zipfile.ZIP_DEFLATED
        with open(p, "rb") as f:
            z.writestr(zi, f.read(), compresslevel=9 if zi.compress_type == zipfile.ZIP_DEFLATED else None)
        n += 1
    for item in INCLUDE:
        p = ROOT / item
        if p.is_file():
            add(p)
            continue
        for dp, dns, fns in os.walk(p):
            dns[:] = sorted(d for d in dns if d not in SKIP_DIRS)
            for fn in sorted(fns):
                f = Path(dp) / fn
                if f.suffix in SKIP_SUFFIX or f.is_symlink() or f.name.endswith(".part"):
                    continue
                if LITE and item == "models" and f.name != "README.txt":
                    continue
                if LITE and item == "docs" and f.suffix == ".mp4":   # big demo render: full zip / sent separately
                    continue
                add(f)
print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB, {n} files)")
