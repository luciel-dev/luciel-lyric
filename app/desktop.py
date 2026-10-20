"""Luciel Lyric desktop launcher (used by the PyInstaller build; also runnable from source).

    python -m app.desktop                 # native window (pywebview), falls back to the default browser
    python -m app.desktop --browser       # always use the default browser
    python -m app.desktop --server-only   # headless: just serve on localhost (CI smoke test)
    options: --port N (default: first free from 8000), --data-dir PATH (default: OS user data folder)

What it does:
  * starts the FastAPI app with uvicorn in a background thread on a free localhost port,
  * opens it in a native window (WebView2 on Windows, WKWebView on macOS, GTK/Qt on Linux if available)
    or, if no webview backend works, in the default browser (a Quit button appears in the app header),
  * stops the server cleanly when the window is closed (or on Ctrl+C / SIGTERM / POST /api/shutdown),
  * single-instance guard: a second launch just brings up the running instance's URL in the browser,
  * stores uploads/renders/fonts/presets/logs in the OS user data folder.
"""
import argparse
import json
import os
import signal
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

os.environ.setdefault("PYTHONUTF8", "1")


# ------------------------------------------------------------------ helpers
def _free_port(host, start):
    for port in range(start, start + 100):
        with socket.socket() as s:
            if os.name != "nt":
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    with socket.socket() as s:      # anything the OS gives us
        s.bind((host, 0))
        return s.getsockname()[1]


def _alive(url, timeout=1.0):
    try:
        urllib.request.urlopen(url + "api/config", timeout=timeout).read(64)
        return True
    except Exception:  # noqa: BLE001
        return False


class InstanceLock:
    """OS file lock in the data folder (released automatically if the process dies)."""

    def __init__(self, folder: Path):
        self.path = folder / "instance.lock"
        self.info = folder / "instance.json"
        self.fh = None

    def acquire(self) -> bool:
        self.fh = open(self.path, "a+")
        try:
            if os.name == "nt":
                import msvcrt
                self.fh.seek(0)
                msvcrt.locking(self.fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            self.fh.close(); self.fh = None
            return False

    def publish(self, url):
        self.info.write_text(json.dumps({"url": url, "pid": os.getpid(), "started": time.time()}), encoding="utf-8")

    def running_url(self):
        try:
            return json.loads(self.info.read_text(encoding="utf-8")).get("url")
        except Exception:  # noqa: BLE001
            return None

    def release(self):
        try:
            self.info.unlink(missing_ok=True)
        except OSError:
            pass
        if self.fh:
            try:
                if os.name == "nt":
                    import msvcrt
                    self.fh.seek(0)
                    msvcrt.locking(self.fh.fileno(), msvcrt.LK_UNLCK, 1)
                self.fh.close()
            except OSError:
                pass
            self.fh = None


def _redirect_output_if_needed(data_dir: Path):
    """Windowed builds have no console (sys.stdout is None): log to <data>/logs/luciel.log instead."""
    if sys.stdout is not None and sys.stderr is not None:
        return None
    logs = data_dir / "logs"; logs.mkdir(parents=True, exist_ok=True)
    f = open(logs / "luciel.log", "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stdout or f
    sys.stderr = sys.stderr or f
    return logs / "luciel.log"


# ------------------------------------------------------------------ main
def main(argv=None):
    ap = argparse.ArgumentParser(prog="LucielLyric", description="Luciel Lyric - lyric video maker")
    ap.add_argument("--server-only", action="store_true", help="no window/browser; serve until stopped")
    ap.add_argument("--browser", action="store_true", help="open the default browser instead of a native window")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=0, help="port (default: first free port from 8000)")
    ap.add_argument("--data-dir", default=None, help="folder for uploads/renders/fonts/presets")
    a = ap.parse_args(argv)

    if a.data_dir:
        os.environ["LUCIEL_DATA_DIR"] = str(Path(a.data_dir).resolve())
    mode = "server" if a.server_only else ("browser" if a.browser else "window")
    os.environ["LUCIEL_DESKTOP_MODE"] = mode

    from app import runtime          # offline env, data dir, ffmpeg
    from app.version import __version__, APP_NAME
    data = runtime.DATA_DIR
    log = _redirect_output_if_needed(data)

    lock = InstanceLock(data)
    if not lock.acquire():
        url = lock.running_url()
        if url and _alive(url):
            print(f"{APP_NAME} is already running at {url}", flush=True)
            if not a.server_only:
                webbrowser.open(url)
            return 0
        print("Another Luciel Lyric is starting up (data folder is locked). Try again in a moment.", flush=True)
        return 1

    port = a.port or _free_port(a.host, 8000)
    url = f"http://127.0.0.1:{port}/"
    st = runtime.status()
    print("=" * 60)
    print(f" {APP_NAME} {__version__}  ({'desktop build' if runtime.FROZEN else 'from source'}, mode: {mode})")
    print(f" data   : {data}" + (f"   log: {log}" if log else ""))
    print(f" ffmpeg : {st['ffmpeg']} ({st['ffmpeg_source']})")
    print(f" models : {', '.join(st['whisper_models']) or 'NONE'}{' + htdemucs' if st['demucs_weights'] else ''}"
          f"  (offline: {st['offline']})")
    print(f" url    : {url}")
    print("=" * 60, flush=True)

    import uvicorn
    from app.main import app as asgi_app
    server = uvicorn.Server(uvicorn.Config(asgi_app, host=a.host, port=port, log_level="warning",
                                           access_log=False, lifespan="off"))
    stop = threading.Event()
    window_ref = {}

    def shutdown():
        if stop.is_set():
            return
        stop.set()
        server.should_exit = True
        w = window_ref.get("w")
        if w is not None:            # closing the window ends webview.start() in the main thread
            try:
                w.destroy()
            except Exception:  # noqa: BLE001
                pass
    runtime.SHUTDOWN_HOOK = shutdown

    th = threading.Thread(target=server.run, name="uvicorn", daemon=True)
    th.start()
    t0 = time.time()
    while not server.started and th.is_alive() and time.time() - t0 < 120:
        time.sleep(0.05)
    if not server.started:
        print("ERROR: the server did not start", flush=True)
        lock.release()
        return 2
    lock.publish(url)
    print(f"ready in {time.time() - t0:.1f}s", flush=True)

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, lambda *_: shutdown())
        except (ValueError, OSError):
            pass

    try:
        if mode == "window":
            try:
                import webview  # pywebview
                w = webview.create_window(APP_NAME, url, width=1380, height=920, min_size=(900, 640),
                                          background_color="#111318", text_select=True)
                window_ref["w"] = w
                w.events.closed += shutdown
                webview.start(private_mode=False, storage_path=str(data / "webview"))
                shutdown()               # window closed
            except Exception as e:  # noqa: BLE001  (no WebView2 / GTK / Qt available)
                print(f"native window unavailable ({type(e).__name__}: {e}); opening the default browser", flush=True)
                os.environ["LUCIEL_DESKTOP_MODE"] = runtime.DESKTOP_MODE = "browser"
                mode = "browser"
        if mode == "browser":
            webbrowser.open(url)
        while not stop.is_set():         # browser / server-only: run until Quit, Ctrl+C or SIGTERM
            stop.wait(0.5)
    except KeyboardInterrupt:
        shutdown()
    finally:
        server.should_exit = True
        th.join(timeout=15)
        lock.release()
        print("stopped cleanly" if not th.is_alive() else "server thread did not stop in time", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
