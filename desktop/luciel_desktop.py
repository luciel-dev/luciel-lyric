"""PyInstaller entry point for the Luciel Lyric desktop app.

The frozen executable doubles as the Demucs worker: app.runtime.demucs_command() re-launches
`<this exe> --demucs <args>` because a frozen app cannot run `python -m demucs`. That branch must run
before anything else is imported (Demucs/torch must never load inside the server process).
"""
import sys
from pathlib import Path

if not getattr(sys, "frozen", False):      # running from source: make the repo root importable
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _run_demucs(args):
    from app import runtime  # noqa: F401  (offline HF env + ffmpeg on PATH for the worker too)
    from demucs.separate import main as demucs_main
    sys.argv = ["demucs", *args]
    demucs_main(args)
    return 0


def _main():
    if len(sys.argv) > 1 and sys.argv[1] == "--demucs":
        return _run_demucs(sys.argv[2:])
    import multiprocessing
    multiprocessing.freeze_support()
    from app.desktop import main
    return main(sys.argv[1:])


if __name__ == "__main__":
    sys.exit(_main() or 0)
