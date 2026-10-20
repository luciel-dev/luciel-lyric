"""Runtime environment for Luciel Lyric: bundled models (offline), ffmpeg location, bundled fonts.

Imported first by app/__init__.py so the environment variables are in place before
faster-whisper / huggingface_hub are imported, and are inherited by the demucs subprocess.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Frozen (PyInstaller desktop build): read-only resources live in sys._MEIPASS, user data in the OS data folder.
FROZEN = bool(getattr(sys, "frozen", False))
ROOT = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).resolve().parent.parent)
MODELS_DIR = ROOT / "models"
HF_CACHE = MODELS_DIR / "hf"
RENDER_FONTS = ROOT / "static" / "fonts" / "render"
APP_FFMPEG_DIR = ROOT / "ffmpeg"          # static ffmpeg/ffprobe shipped inside the desktop app


def env(name: str, default: str = "") -> str:
    """Read LUCIEL_<name>; the old LYRICCLIP_<name> spelling is still accepted."""
    return os.environ.get(f"LUCIEL_{name}", os.environ.get(f"LYRICCLIP_{name}", default))


def user_data_dir() -> Path:
    """Per-user writable folder: %APPDATA%\\LucielLyric, ~/Library/Application Support/LucielLyric, ~/.local/share/LucielLyric."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "LucielLyric"


# uploads, renders, custom fonts, presets, logs. Script installs keep ./data next to the app (as before);
# the desktop build uses the OS user data folder; LUCIEL_DATA_DIR overrides both.
DATA_DIR = Path(env("DATA_DIR")) if env("DATA_DIR") else (user_data_dir() if FROZEN else ROOT / "data")
DATA_DIR.mkdir(parents=True, exist_ok=True)
DESKTOP_MODE = env("DESKTOP_MODE")         # "window" | "browser" | "server" when started by app.desktop
SHUTDOWN_HOOK = None                       # set by app.desktop: callable that stops the server/app


# Remember children so closing the window can stop ffmpeg/demucs, and hide their consoles
# on the windowed Windows build (a GUI-subsystem exe has no console of its own).
_CHILD_PROCS = []
_popen_init = subprocess.Popen.__init__


def _popen_tracked(self, *a, **kw):
    if FROZEN and sys.platform == "win32" and not kw.get("creationflags"):
        kw["creationflags"] = subprocess.CREATE_NO_WINDOW
    _popen_init(self, *a, **kw)
    _CHILD_PROCS.append(self)


subprocess.Popen.__init__ = _popen_tracked


def stop_children():
    """Stop subprocesses started by this process (encode, probe, vocal isolation)."""
    alive = [p for p in list(_CHILD_PROCS) if p.poll() is None]
    for p in alive:
        try:
            p.terminate()
        except Exception:  # noqa: BLE001
            pass
    for p in alive:
        try:
            p.wait(timeout=2)
        except Exception:  # noqa: BLE001
            try:
                p.kill()
            except Exception:  # noqa: BLE001
                pass
    if sys.platform == "win32":
        try:
            from .win_window import kill_descendants
            kill_descendants(os.getpid())
        except Exception:  # noqa: BLE001
            pass


def demucs_command(args):
    """Command line for the Demucs subprocess. Frozen apps have no `python -m`, so the app executable
    re-launches itself with --demucs (handled in desktop/luciel_desktop.py before anything else is imported)."""
    if FROZEN:
        return [sys.executable, "--demucs", *args]
    return [sys.executable, "-m", "demucs", *args]


ALLOW_DOWNLOADS = env("ALLOW_DOWNLOADS") == "1"


def _setup_env():
    os.environ.setdefault("HF_HOME", str(HF_CACHE))
    os.environ.setdefault("HF_HUB_CACHE", str(HF_CACHE / "hub"))
    os.environ.setdefault("TORCH_HOME", str(MODELS_DIR / "torch"))
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")
    os.environ.setdefault("DO_NOT_TRACK", "1")
    if not ALLOW_DOWNLOADS:
        # never touch the network at runtime: everything is loaded from ./models
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"


_setup_env()


# ---------------------------------------------------------------- whisper models
def whisper_model_path(name: str):
    """Local folder for a bundled faster-whisper model, or None."""
    p = MODELS_DIR / f"faster-whisper-{name}"
    return p if (p / "model.bin").exists() else None


def available_whisper_models(all_models):
    if ALLOW_DOWNLOADS:
        return list(all_models)
    return [m for m in all_models if whisper_model_path(m)] or ["base.en"]


# ---------------------------------------------------------------- ffmpeg
_EXE = ".exe" if os.name == "nt" else ""


def _run_txt(cmd, timeout=20):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as e:  # noqa: BLE001
        return -1, str(e)


def ffmpeg_ok(ffmpeg: str, ffprobe: str) -> tuple[bool, str]:
    """Does this ffmpeg have everything the renderer needs? (Frames are composed in Python; ffmpeg decodes
    background videos, encodes x264/AAC and, for alpha exports, ProRes 4444 / VP9.)"""
    if not ffmpeg or not ffprobe:
        return False, "ffmpeg/ffprobe not found"
    rc, out = _run_txt([ffmpeg, "-hide_banner", "-filters"])
    if rc != 0:
        return False, "ffmpeg does not run"
    for f in ("gblur", "colorchannelmixer", "amix", "afade", "tile"):
        if f" {f} " not in out:
            return False, f"ffmpeg is missing the '{f}' filter"
    rc, out = _run_txt([ffmpeg, "-hide_banner", "-encoders"])
    for e in ("libx264", "aac", "prores_ks"):
        if f" {e} " not in out:
            return False, f"ffmpeg is missing the '{e}' encoder"
    rc, _ = _run_txt([ffprobe, "-version"])
    if rc != 0:
        return False, "ffprobe does not run"
    return True, "ok"


def _static_ffmpeg_dir():
    """Folder of the static-ffmpeg pip package binaries (only if already downloaded by setup)."""
    try:
        from static_ffmpeg import run as sf  # noqa: WPS433
        d = Path(sf.get_platform_dir())
    except Exception:  # noqa: BLE001
        return None
    return d if (d / f"ffmpeg{_EXE}").exists() and (d / f"ffprobe{_EXE}").exists() else None


def find_ffmpeg():
    """Return (ffmpeg, ffprobe, source, note). LUCIEL_FFMPEG (or legacy LYRICCLIP_FFMPEG) = auto | system | bundled | <folder>."""
    pref = (env("FFMPEG", "auto") or "auto").strip()
    cands = []
    sys_pair = (shutil.which("ffmpeg"), shutil.which("ffprobe"), "system")
    sd = _static_ffmpeg_dir()
    bundled = (str(sd / f"ffmpeg{_EXE}"), str(sd / f"ffprobe{_EXE}"), "bundled (static-ffmpeg)") if sd else None
    if (APP_FFMPEG_DIR / f"ffmpeg{_EXE}").exists():   # desktop build: the app's own static ffmpeg wins
        bundled = (str(APP_FFMPEG_DIR / f"ffmpeg{_EXE}"), str(APP_FFMPEG_DIR / f"ffprobe{_EXE}"), "bundled (app)")
        if pref in ("auto", ""):
            pref = "bundled"
    if pref not in ("auto", "system", "bundled", ""):
        d = Path(pref)
        cands.append((str(d / f"ffmpeg{_EXE}"), str(d / f"ffprobe{_EXE}"), f"custom ({d})"))
    elif pref == "bundled":
        cands += [c for c in (bundled, sys_pair) if c]
    else:
        cands += [c for c in (sys_pair, bundled) if c]
    notes = []
    for ff, fp, src in cands:
        ok, why = ffmpeg_ok(ff, fp)
        if ok:
            return ff, fp, src, "; ".join(notes)
        notes.append(f"{src}: {why}")
    # nothing suitable - fall back to whatever exists so errors are visible
    ff = (bundled or sys_pair)[0] or "ffmpeg"
    fp = (bundled or sys_pair)[1] or "ffprobe"
    return ff, fp, "unverified", "; ".join(notes) or "ffmpeg not found"


FFMPEG, FFPROBE, FFMPEG_SOURCE, FFMPEG_NOTE = find_ffmpeg()
# Demucs (run as a subprocess) calls plain "ffmpeg"/"ffprobe" - make sure it finds the same ones.
_ffdir = str(Path(FFMPEG).parent) if os.path.isabs(FFMPEG) else None
if _ffdir and _ffdir not in os.environ.get("PATH", "").split(os.pathsep):
    os.environ["PATH"] = _ffdir + os.pathsep + os.environ.get("PATH", "")


def status():
    hub = HF_CACHE / "hub"
    return {
        "python": sys.version.split()[0], "frozen": FROZEN, "data_dir": str(DATA_DIR), "desktop_mode": DESKTOP_MODE or None,
        "ffmpeg": FFMPEG, "ffprobe": FFPROBE, "ffmpeg_source": FFMPEG_SOURCE, "ffmpeg_note": FFMPEG_NOTE,
        "whisper_models": [p.name for p in sorted(MODELS_DIR.glob("faster-whisper-*")) if (p / "model.bin").exists()],
        "demucs_weights": (hub / "models--adefossez--HTDemucs").exists(),
        "offline": os.environ.get("HF_HUB_OFFLINE") == "1",
        "render_fonts": sorted(p.name for p in RENDER_FONTS.glob("*.[ot]tf")),
    }
