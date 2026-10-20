"""Download the Microsoft Edge WebView2 Evergreen bootstrapper for the Windows build.

The file is small and installs the runtime on first launch (it needs a network that once).
An offline native window is still possible if WebView2Fixed/msedgewebview2.exe is placed
next to LucielLyric.exe. Official link: https://go.microsoft.com/fwlink/p/?LinkId=2124703
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "packaging" / "build" / "webview2" / "MicrosoftEdgeWebview2Setup.exe"


def main():
    DEST.parent.mkdir(parents=True, exist_ok=True)
    if DEST.is_file() and DEST.stat().st_size > 100_000 and DEST.read_bytes()[:2] == b"MZ":
        print(f"WebView2 bootstrapper already present ({DEST.stat().st_size} bytes)")
        return 0
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    print(f"downloading {URL}")
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if data[:2] != b"MZ" or not (100_000 < len(data) < 30_000_000):
        raise SystemExit(f"download is not a WebView2 bootstrapper ({len(data)} bytes, head {data[:20]!r})")
    DEST.write_bytes(data)
    print(f"wrote {DEST} ({len(data)} bytes, sha256 {hashlib.sha256(data).hexdigest()})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
