"""Luciel Lyric desktop launcher (used by the PyInstaller build; also runnable from source).

    python -m app.desktop                 # native window (pywebview)
    python -m app.desktop --browser       # always use the default browser
    python -m app.desktop --server-only   # headless: just serve on localhost (CI smoke test)
    options: --port N (default: first free from 8000), --data-dir PATH (default: OS user data folder)

What it does:
  * starts the FastAPI app with uvicorn in a background thread on a free localhost port,
  * opens a normal native window with the system title bar (WebView2 on Windows, WKWebView on macOS).
    Windows minimize, maximize/restore and close sit in the top-right corner; macOS keeps the
    traffic lights. The window is resizable and shows the Luciel Lyric name and icon.
  * on Windows, installs the bundled WebView2 bootstrapper when the runtime is missing. A fixed
    runtime in WebView2Fixed/ next to the exe is the offline native path. The system browser is
    only used if a native window still cannot be created, and a dialog says so.
  * closing the window stops the server and its child processes (ffmpeg, vocal isolation),
  * a second launch focuses the existing window instead of opening a browser,
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
        # Windows: msvcrt.locking needs a binary file with at least one locked byte.
        # Text mode (and an empty file) makes the first launch fail the lock, so the
        # smoke test's single-instance guard never sees a running server.
        self.fh = open(self.path, "a+b")
        try:
            if os.name == "nt":
                import msvcrt
                self.fh.seek(0, os.SEEK_END)
                if self.fh.tell() == 0:
                    self.fh.write(b"\0")
                    self.fh.flush()
                self.fh.seek(0)
                msvcrt.locking(self.fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            self.fh.close(); self.fh = None
            return False

    def publish(self, url, mode="window"):
        self.info.write_text(json.dumps({"url": url, "pid": os.getpid(), "mode": mode, "started": time.time()}), encoding="utf-8")

    def running_info(self):
        try:
            data = json.loads(self.info.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:  # noqa: BLE001
            return {}

    def running_url(self):
        return self.running_info().get("url")

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


def _raise_running(info) -> bool:
    """Focus an existing native window. Returns True when this launch should not open a browser."""
    if info.get("mode") != "window":
        return False
    if sys.platform == "win32":
        from app.win_window import focus_pid, message_box
        pid = int(info.get("pid") or 0)
        if focus_pid(pid):
            print("brought the existing window forward", flush=True)
            return True
        message_box("Luciel Lyric is already running.\n\nUse the window that is already open.")
        return True
    return False


def _announce_browser(reason: str, log) -> None:
    where = f"\n\nDetails were written to:\n{log}" if log else ""
    if reason == "missing":
        text = (
            "Luciel Lyric could not open its own window because the Microsoft Edge WebView2 "
            "Runtime is not installed, and the bundled installer could not add it "
            "(this computer may be offline).\n\n"
            "The app will open in your web browser instead. It still works offline. "
            "Closing the browser tab does not quit Luciel Lyric — use the Quit button "
            "in the header so the background server shuts down."
            + where
        )
    elif reason == "mshtml":
        text = (
            "Luciel Lyric could not open its WebView2 window (it would have used the old "
            "Internet Explorer engine instead).\n\n"
            "The app will open in your web browser instead. Use the Quit button in the "
            "header so the background server shuts down."
            + where
        )
    else:
        text = (
            "Luciel Lyric could not open its own window"
            + (f" ({reason})" if reason else "")
            + ".\n\nIt will open in your web browser instead. Use the Quit button in the "
            "header to shut it down."
            + where
        )
    print(text, flush=True)
    if sys.platform == "win32":
        from app.win_window import message_box
        message_box(text)


def _open_native(url, data, window_ref, shutdown) -> str:
    """Show a system-framed window. Returns 'ok' after the user closes it, or a failure reason."""
    import webview
    from app.version import APP_NAME
    if sys.platform == "win32":
        from app.win_window import prepare_webview2, set_app_id
        set_app_id()
        state = prepare_webview2()
        print(f"webview2: {state}", flush=True)
        if state == "missing":
            return "missing"
    # frameless stays false: Windows gets the corner min/max/close buttons, macOS the traffic lights.
    w = webview.create_window(
        APP_NAME, url, width=1280, height=860, min_size=(900, 640), resizable=True, frameless=False,
        easy_drag=False, minimized=False, shadow=True, background_color="#111318", text_select=True,
    )
    window_ref["w"] = w
    accepted = {"ok": False}

    def _shown():
        import webview as wv
        if sys.platform == "win32" and getattr(wv, "renderer", "") == "mshtml":
            # The IE engine is not the app window we ship. Fall back instead of pretending.
            accepted["reject"] = True
            try:
                w.destroy()
            except Exception:  # noqa: BLE001
                pass
            return
        accepted["ok"] = True
        if sys.platform == "win32":
            try:
                from app.win_window import enforce_caption_buttons
                enforce_caption_buttons(w)
            except Exception as e:  # noqa: BLE001
                print(f"could not confirm window buttons ({type(e).__name__}: {e})", flush=True)

    def _closed():
        if accepted.get("ok"):
            shutdown()

    w.events.shown += _shown
    w.events.closed += _closed
    start_kw = {"private_mode": False, "storage_path": str(data / "webview")}
    if sys.platform == "win32":
        start_kw["gui"] = "edgechromium"
    webview.start(**start_kw)
    if accepted.get("reject"):
        return "mshtml"
    return "ok" if accepted.get("ok") else "no-window"


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

    if sys.platform == "win32":
        from app.win_window import arm_kill_on_job_close
        runtime.WIN_JOB = arm_kill_on_job_close()  # kept alive so children die with this process

    lock = InstanceLock(data)
    if not lock.acquire():
        info = lock.running_info()
        url = info.get("url")
        if url and _alive(url):
            print(f"{APP_NAME} is already running at {url}", flush=True)
            if not a.server_only and not _raise_running(info):
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
        runtime.stop_children()
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
    lock.publish(url, mode)
    print(f"ready in {time.time() - t0:.1f}s", flush=True)

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, lambda *_: shutdown())
        except (ValueError, OSError):
            pass

    try:
        if mode == "window":
            reason = ""
            try:
                status = _open_native(url, data, window_ref, shutdown)
                if status == "ok":
                    shutdown()           # window closed
                else:
                    reason = status
                    mode = "browser"
            except Exception as e:  # noqa: BLE001
                import traceback
                traceback.print_exc()
                reason = f"{type(e).__name__}: {e}"
                print(f"native window unavailable ({reason})", flush=True)
                mode = "browser"
            if mode == "browser":
                os.environ["LUCIEL_DESKTOP_MODE"] = runtime.DESKTOP_MODE = "browser"
                lock.publish(url, "browser")
                _announce_browser(reason, log)
                webbrowser.open(url)
        elif mode == "browser":
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
