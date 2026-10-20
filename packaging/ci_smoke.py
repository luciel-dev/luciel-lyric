"""Headless smoke test of a *frozen* Luciel Lyric build (used by CI and for local Linux checks).

    python packaging/ci_smoke.py --exe dist/LucielLyric/LucielLyric            # Linux
    python packaging/ci_smoke.py --exe dist/LucielLyric/LucielLyric.exe        # Windows
    python packaging/ci_smoke.py --exe "dist/Luciel Lyric.app/Contents/MacOS/LucielLyric"

1. starts the app in --server-only mode with a fresh temporary data folder, Python networking pointed
   at a dead proxy (and, on Linux, optionally inside a network namespace with `unshare -rn` via --netns),
2. checks /api/status: frozen, bundled ffmpeg, bundled models, offline, demucs (unless --no-vocals),
3. runs scripts/smoke_test.py against it (upload -> sync with vocal isolation -> render -> still -> download),
4. checks the single-instance guard (a 2nd launch exits immediately and reports the running URL),
5. POST /api/shutdown and requires the process to exit cleanly ("stopped cleanly" in its log).
"""
import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get(url, timeout=5):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", required=True)
    ap.add_argument("--no-vocals", action="store_true", help="build without demucs (e.g. Intel Mac)")
    ap.add_argument("--netns", action="store_true", help="Linux: run the app with no network at all (unshare -rn)")
    ap.add_argument("--timeout", type=float, default=240)
    a = ap.parse_args()
    exe = str(Path(a.exe).resolve())
    data = Path(tempfile.mkdtemp(prefix="luciel_ci_"))
    port = free_port()
    env = dict(os.environ, LUCIEL_DATA_DIR=str(data), PYTHONUNBUFFERED="1",
               # anything that tries the internet fails fast (localhost is exempt)
               HTTP_PROXY="http://127.0.0.1:9", HTTPS_PROXY="http://127.0.0.1:9", ALL_PROXY="http://127.0.0.1:9",
               NO_PROXY="127.0.0.1,localhost", no_proxy="127.0.0.1,localhost", HF_HUB_OFFLINE="1")
    cmd = [exe, "--server-only", "--port", str(port)]
    if a.netns:
        # the smoke-test client must share the namespace, so run *this whole test* inside it instead:
        if os.environ.get("LUCIEL_IN_NETNS") != "1":
            r = subprocess.run(["unshare", "-rn", "sh", "-c", "ip link set lo up 2>/dev/null; exec \"$@\"", "sh",
                                sys.executable, *sys.argv], env=dict(os.environ, LUCIEL_IN_NETNS="1"))
            return r.returncode
    log = open(data / "app_stdout.log", "w", encoding="utf-8")
    t0 = time.time()
    p = subprocess.Popen(cmd, env=env, stdout=log, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    ok = False
    try:
        while time.time() - t0 < a.timeout:
            if p.poll() is not None:
                break
            try:
                get(base + "/api/config", 2); ok = True; break
            except Exception:  # noqa: BLE001
                time.sleep(1)
        if not ok:
            raise SystemExit("FAIL: server did not come up")
        print(f"server up in {time.time() - t0:.1f}s")
        st = get(base + "/api/status")
        print("status:", json.dumps(st))
        checks = {"frozen": st.get("frozen") is True, "bundled ffmpeg": st.get("ffmpeg_source") == "bundled (app)",
                  "whisper model": "faster-whisper-base.en" in st.get("whisper_models", []), "offline": st.get("offline") is True,
                  "data dir": Path(st.get("data_dir", "")).resolve() == data.resolve()}
        if not a.no_vocals:
            checks["demucs"] = st.get("demucs") is True and st.get("demucs_weights") is True
        bad = [k for k, v in checks.items() if not v]
        if bad:
            raise SystemExit(f"FAIL: status checks {bad}")
        args = [sys.executable, str(ROOT / "scripts" / "smoke_test.py"), "--url", base]
        if a.no_vocals:
            args.append("--no-vocals")
        r = subprocess.run(args, env=dict(os.environ, NO_PROXY="127.0.0.1,localhost", no_proxy="127.0.0.1,localhost"))
        if r.returncode != 0:
            raise SystemExit("FAIL: smoke_test.py")
        renders = list((data / "renders").glob("*.mp4"))
        print(f"renders in user data dir: {[x.name for x in renders]}")
        if not renders:
            raise SystemExit("FAIL: no render in the data folder")
        # single instance: a second launch must exit at once and point at the running one
        r2 = subprocess.run(cmd[:1] + ["--server-only"], env=env, capture_output=True, text=True, timeout=120)
        lf = data / "logs" / "luciel.log"     # windowed builds print to the log file, not stdout
        said = (r2.stdout or "") + (lf.read_text(encoding="utf-8", errors="replace") if lf.exists() else "")
        print("second instance:", r2.returncode, [x for x in said.splitlines() if "already running" in x][-1:])
        if r2.returncode != 0 or "already running" not in said:
            raise SystemExit("FAIL: single-instance guard")
        # clean shutdown
        req = urllib.request.Request(base + "/api/shutdown", data=b"", method="POST")
        urllib.request.urlopen(req, timeout=5).read()
        p.wait(timeout=30)
        log.flush()
        out = (data / "app_stdout.log").read_text(encoding="utf-8", errors="replace")
        if "stopped cleanly" not in out:
            # windowed builds log to <data>/logs/luciel.log instead of stdout
            lf = data / "logs" / "luciel.log"
            out += lf.read_text(encoding="utf-8", errors="replace") if lf.exists() else ""
        if p.returncode != 0 or "stopped cleanly" not in out:
            print(out[-3000:])
            raise SystemExit(f"FAIL: unclean shutdown (exit {p.returncode})")
        print(f"clean shutdown (exit {p.returncode})")
        print("CI SMOKE: PASS")
        return 0
    finally:
        if p.poll() is None:
            p.kill()
        log.close()
        out = (data / "app_stdout.log").read_text(encoding="utf-8", errors="replace")
        lf = data / "logs" / "luciel.log"
        if lf.exists():
            out += lf.read_text(encoding="utf-8", errors="replace")
        print("---- app log (tail) ----\n" + out[-2500:])
        shutil.rmtree(data, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
