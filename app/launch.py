"""Cross-platform launcher: start the Luciel Lyric server on localhost and open the browser.

Usage: python -m app.launch [--port 8000] [--no-browser] [--host 127.0.0.1]
"""
import argparse
import os
import socket
import threading
import time
import urllib.request
import webbrowser

os.environ.setdefault("PYTHONUTF8", "1")


def _free_port(host, start):
    for port in range(start, start + 50):
        with socket.socket() as s:
            if os.name != "nt":  # match uvicorn: ignore TIME_WAIT leftovers (on Windows this flag would allow port stealing)
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise SystemExit(f"No free port found between {start} and {start + 49}")


def main():
    ap = argparse.ArgumentParser(description="Start Luciel Lyric")
    ap.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    ap.add_argument("--no-browser", action="store_true", default=os.environ.get("NO_BROWSER") == "1")
    a = ap.parse_args()
    port = _free_port(a.host, a.port)
    url = f"http://localhost:{port}/"

    from app import runtime  # sets offline env, locates ffmpeg
    st = runtime.status()
    print("=" * 60)
    print(" Luciel Lyric - lyric video maker")
    print(f" ffmpeg : {st['ffmpeg']} ({st['ffmpeg_source']})")
    if st["ffmpeg_source"] == "unverified":
        print(f" WARNING: no suitable ffmpeg found: {st['ffmpeg_note']}")
        print("          Run Install again, or see INSTALL.md > 'ffmpeg'.")
    print(f" models : {', '.join(st['whisper_models']) or 'NONE (see INSTALL.md)'}"
          f"{' + demucs htdemucs' if st['demucs_weights'] else ''}  (offline: {st['offline']})")
    print(f" Open   : {url}")
    print(" Stop   : press Ctrl+C in this window")
    print("=" * 60, flush=True)

    if not a.no_browser:
        def opener():
            for _ in range(240):  # wait up to 2 min for the server to come up
                try:
                    urllib.request.urlopen(url + "api/config", timeout=1)
                    break
                except Exception:  # noqa: BLE001
                    time.sleep(0.5)
            webbrowser.open(url)
        threading.Thread(target=opener, daemon=True).start()

    import uvicorn
    uvicorn.run("app.main:app", host=a.host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
