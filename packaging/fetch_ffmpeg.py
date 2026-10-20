"""Download a static ffmpeg + ffprobe for the desktop build into packaging/build/ffmpeg/ (SHA-256 verified).

    python packaging/fetch_ffmpeg.py [--platform win32|darwin|darwin_arm64|linux|linux_arm64]

Source: the FFmpeg 8.0 static builds published by the static-ffmpeg project (github.com/zackees/ffmpeg_bins,
built by its GitHub Actions; same binaries the script-installed app already uses). Pinned to an exact git
commit; the SHA-256 + size of each zip are the Git LFS object ids recorded in that commit, so a changed or
corrupted download is rejected. The binaries must provide everything app/runtime.ffmpeg_ok() checks
(libx264, aac, prores_ks, gblur, colorchannelmixer, amix, afade, tile) - verified after download when the
binary can run on this machine.
"""
import argparse
import hashlib
import io
import os
import platform
import shutil
import stat
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

COMMIT = "df95abcb0ce6efff710dda5ef28a2f6f1dc21493"   # zackees/ffmpeg_bins "Add FFmpeg v8.0 binaries" (2026-01-16)
URL = "https://media.githubusercontent.com/media/zackees/ffmpeg_bins/{commit}/v8.0/{name}.zip"
PINS = {  # name: (sha256, size)
    "win32": ("92662c2241e93fe71b3f3a01e94a0b0dc8cfad726019f96b83bc109ce44c5d0b", 72065209),
    "darwin": ("70fd5b21cb37b6ea97c8b584cf76b3cc6a90179831c9c269811b9716c28605fb", 53079896),
    "darwin_arm64": ("b2da44a8169c4d09a97db996250690c3346f72e4795521d23d3dbb1e72421207", 41925556),
    "linux": ("ca75b05e887c7a97676632f673031875847be83daa9794298fed9cef8cac14ad", 142008975),
}
OUT = Path(__file__).resolve().parent / "build" / "ffmpeg"


def current_platform():
    arm = platform.machine().lower() in ("arm64", "aarch64")
    if sys.platform == "win32":
        return "win32"
    if sys.platform == "darwin":
        return "darwin_arm64" if arm else "darwin"
    return "linux_arm64" if arm else "linux"


def download(url, size, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = r.read()
            if len(data) == size:
                return data
            print(f"  size mismatch ({len(data)} != {size}), retrying")
        except Exception as e:  # noqa: BLE001
            print(f"  download error: {e}; retrying")
        time.sleep(3 * (i + 1))
    raise SystemExit(f"could not download {url}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", default=current_platform(), choices=sorted(PINS))
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args()
    sha, size = PINS[a.platform]
    out = Path(a.out)
    exe = ".exe" if a.platform == "win32" else ""
    if all((out / f"{n}{exe}").exists() for n in ("ffmpeg", "ffprobe")) and (out / ".source").exists() \
            and (out / ".source").read_text().strip() == sha:
        print(f"ffmpeg already present in {out}")
        return 0
    url = URL.format(commit=COMMIT, name=a.platform)
    print(f"downloading {url} ({size / 1e6:.0f} MB)")
    data = download(url, size)
    got = hashlib.sha256(data).hexdigest()
    if got != sha:
        raise SystemExit(f"SHA-256 mismatch for {a.platform}.zip: {got} != {sha}")
    print("  sha256 ok")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for n in ("ffmpeg", "ffprobe"):
            member = next(m for m in z.namelist() if m.rsplit("/", 1)[-1] == f"{n}{exe}")
            (out / f"{n}{exe}").write_bytes(z.read(member))
            os.chmod(out / f"{n}{exe}", os.stat(out / f"{n}{exe}").st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    (out / ".source").write_text(sha + "\n")
    (out / "SOURCE.txt").write_text(
        f"FFmpeg 8.0 static build ({a.platform}) from https://github.com/zackees/ffmpeg_bins @ {COMMIT}\n"
        f"zip sha256 {sha}\nFFmpeg is licensed under the GPL (static builds include x264); see https://ffmpeg.org/legal.html\n")
    if a.platform == current_platform():   # check the features the renderer needs
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        os.environ.setdefault("LUCIEL_DATA_DIR", str(Path(a.out).parent / "tmpdata"))
        from app.runtime import ffmpeg_ok
        ok, why = ffmpeg_ok(str(out / f"ffmpeg{exe}"), str(out / f"ffprobe{exe}"))
        print(f"  feature check: {why}")
        if not ok:
            raise SystemExit(1)
    print(f"ffmpeg ready in {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
