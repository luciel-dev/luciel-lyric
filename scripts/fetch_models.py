"""Download the AI models Luciel Lyric needs into ./models (one time, ~230 MB). Afterwards the app is offline.

  python scripts/fetch_models.py            # download whatever is missing, verify everything
  python scripts/fetch_models.py --check    # only verify, never download (exit 1 if something is missing)
  python scripts/fetch_models.py --no-vocals  # skip the Demucs vocal-isolation model

Every file is pinned to an exact Hugging Face revision and checked by size + SHA-256. Downloads resume
after interruptions and are retried. Set HF_ENDPOINT to use a mirror (e.g. https://hf-mirror.com).
You can also place the files by hand - see INSTALL.md ("Installing the models manually").
"""
import hashlib
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
ENDPOINT = os.environ.get("HF_ENDPOINT", "https://huggingface.co").rstrip("/")

WHISPER_REV = "3d3d5dee26484f91867d81cb899cfcf72b96be6c"
DEMUCS_REV = "cbc8a9b1a87023b7fd74e7b3412e6321c0eab003"
DEMUCS_DIR = MODELS / "hf" / "hub" / "models--adefossez--HTDemucs"

# (group, repo, revision, filename, local path, size, sha256)
FILES = [
    ("whisper", "Systran/faster-whisper-base.en", WHISPER_REV, "config.json",
     MODELS / "faster-whisper-base.en" / "config.json", 2227,
     "f3bc3821e9fc76a27bae538e11ae5b677dcdd352b4600429ce7951d398569aeb"),
    ("whisper", "Systran/faster-whisper-base.en", WHISPER_REV, "model.bin",
     MODELS / "faster-whisper-base.en" / "model.bin", 145216508,
     "2a166925539a16005f14ff328359f9b9adb9dc4fb631bb3b227526862e93e2ef"),
    ("whisper", "Systran/faster-whisper-base.en", WHISPER_REV, "tokenizer.json",
     MODELS / "faster-whisper-base.en" / "tokenizer.json", 2128466,
     "929c5252409436dce1b38a75d1abbcb5e132d170d8e324e4e04ed915fa2d22df"),
    ("whisper", "Systran/faster-whisper-base.en", WHISPER_REV, "vocabulary.txt",
     MODELS / "faster-whisper-base.en" / "vocabulary.txt", 422309,
     "ff77588746d3a2595d32ab5b69ffd7b95ce2441ac57533cb66fc3eb575a115cf"),
    ("vocals", "adefossez/HTDemucs", DEMUCS_REV, "htdemucs.yaml",
     DEMUCS_DIR / "snapshots" / DEMUCS_REV / "htdemucs.yaml", 21,
     "239c445d0b14454d541ad8bd9bb271c9e536d267e8a4625208744cbb2e7bb66c"),
    ("vocals", "adefossez/HTDemucs", DEMUCS_REV, "955717e8.safetensors",
     DEMUCS_DIR / "snapshots" / DEMUCS_REV / "955717e8.safetensors", 84025440,
     "d9fa14133cfcc034a6758923bb3a8ca9f8dfd0b582134643bbf83f72c17576dd"),
]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ok(path: Path, size: int, digest: str) -> bool:
    return path.is_file() and path.stat().st_size == size and sha256(path) == digest


def _session():
    try:
        import requests  # installed by setup (uses certifi, avoids macOS certificate problems)
        s = requests.Session()
        s.headers["User-Agent"] = "LucielLyric-setup"
        return s
    except ImportError:
        return None


def download(url: str, dest: Path, size: int, digest: str, tries: int = 4):
    part = dest.with_name(dest.name + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)
    sess = _session()
    last = None
    for attempt in range(1, tries + 1):
        try:
            have = part.stat().st_size if part.exists() else 0
            if have > size:
                part.unlink(); have = 0
            headers = {"Range": f"bytes={have}-"} if have else {}
            if sess is not None:
                r = sess.get(url, headers=headers, stream=True, timeout=(15, 60), allow_redirects=True)
                if r.status_code == 416:
                    pass
                elif r.status_code not in (200, 206):
                    raise IOError(f"HTTP {r.status_code}")
                else:
                    if r.status_code == 200:
                        have = 0
                    _write(part, r.iter_content(1 << 20), have, size, dest.name)
            else:
                import urllib.request
                req = urllib.request.Request(url, headers=dict(headers, **{"User-Agent": "LucielLyric-setup"}))
                with urllib.request.urlopen(req, timeout=60) as r:
                    if r.status == 200:
                        have = 0
                    _write(part, iter(lambda: r.read(1 << 20), b""), have, size, dest.name)
            if part.stat().st_size != size:
                raise IOError(f"incomplete download ({part.stat().st_size} of {size} bytes)")
            if sha256(part) != digest:
                part.unlink()
                raise IOError("checksum mismatch (file corrupted) - will download again")
            os.replace(part, dest)
            return
        except Exception as e:  # noqa: BLE001
            last = _friendly(e)
            print(f"\n     attempt {attempt}/{tries} failed: {last}", flush=True)
            if attempt < tries:
                time.sleep(min(30, 3 * attempt))
    raise RuntimeError(f"could not download {dest.name}: {last}")


def _friendly(e: Exception) -> str:
    t = f"{type(e).__name__}: {e}"
    host = ENDPOINT.split("://", 1)[-1]
    if any(k in t for k in ("NameResolution", "getaddrinfo", "Name or service", "nodename", "Failed to resolve")):
        return f"no internet connection (cannot look up {host})"
    if any(k in t for k in ("ConnectionError", "ConnectTimeout", "Connection refused", "Network is unreachable", "URLError")):
        return f"cannot connect to {host} (offline, firewall or proxy?)"
    if "SSL" in t or "CERTIFICATE" in t:
        return f"secure connection to {host} failed ({e}) - a proxy may be intercepting HTTPS"
    return str(e)


def _write(part: Path, chunks, have: int, size: int, name: str):
    mode = "ab" if have else "wb"
    done, t0, shown = have, time.time(), -1
    with open(part, mode) as f:
        for c in chunks:
            if not c:
                continue
            f.write(c)
            done += len(c)
            pct = int(done * 100 / size) if size else 100
            if pct != shown and (pct % 5 == 0 or done == size):
                mb = done / 1e6
                rate = (done - have) / 1e6 / max(0.1, time.time() - t0)
                print(f"\r     {name}: {mb:7.1f} / {size / 1e6:.1f} MB  ({pct}%, {rate:.1f} MB/s)  ", end="", flush=True)
                shown = pct
    print(flush=True)


def offline_hint():
    print("""
  !! The models could not be downloaded. Check that this computer is online (and that
     huggingface.co is not blocked by a firewall/proxy), then run Install again - finished files
     are kept and partial downloads resume. Alternatives:
       * use a mirror:   HF_ENDPOINT=https://hf-mirror.com  (then run Install again)
       * copy the models in by hand: see INSTALL.md, "Installing the models manually".""")


def main():
    check_only = "--check" in sys.argv
    groups = {"whisper"} if "--no-vocals" in sys.argv else {"whisper", "vocals"}
    print("Checking AI models in models/ ...")
    missing, failed = [], []
    for grp, repo, rev, fname, path, size, digest in FILES:
        if grp not in groups:
            continue
        rel = path.relative_to(ROOT).as_posix()
        if ok(path, size, digest):
            print(f"  [OK] {rel}")
            continue
        if check_only:
            print(f"  [!!] {rel} missing or damaged")
            missing.append(rel)
            continue
        print(f"  [..] downloading {rel} ({size / 1e6:.1f} MB)", flush=True)
        try:
            download(f"{ENDPOINT}/{repo}/resolve/{rev}/{fname}", path, size, digest)
            print(f"  [OK] {rel} (verified)")
        except Exception as e:  # noqa: BLE001
            print(f"  [!!] {e}")
            failed.append(rel)
    if "vocals" in groups and not failed and not missing:
        ref = DEMUCS_DIR / "refs" / "main"   # makes huggingface_hub find the snapshot offline
        ref.parent.mkdir(parents=True, exist_ok=True)
        if not ref.exists() or ref.read_text().strip() != DEMUCS_REV:
            ref.write_text(DEMUCS_REV)
    if failed or missing:
        if failed:
            offline_hint()
        bad = failed + missing
        # 2 = only the optional vocal-isolation model is missing (the app still works without it)
        return 2 if all("HTDemucs" in b for b in bad) else 1
    print("  All models present - Luciel Lyric can run offline.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
