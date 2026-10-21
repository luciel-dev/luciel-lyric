"""On-demand model cache for desktop sync.

Fast / Accurate / Best Whisper models and the wav2vec2 aligner are downloaded
the first time they're needed, checksum-checked, and then reused offline.
They are not part of the installer. Bundled base.en (the smoke-test model)
still lives in the read-only models directory.
"""
import hashlib
import os
import sys
import threading
import urllib.request
from pathlib import Path

from . import runtime

ENDPOINT = os.environ.get("HF_ENDPOINT", "https://huggingface.co").rstrip("/")

# (repo, revision, remote path, filename in the model dir, size, sha256)
_SMALL = "d1d751a5f8271d482d14ca55d9e2deeebbae577f"
_MEDIUM = "a29b04bd15381511a9af671baec01072039215e3"
_DISTIL = "c3058b475261292e64a0412df1d2681c06260fab"
_ALIGN = "a19f851b3d42865797e410752b4c570c871e4825"
_TOK_JSON = ("tokenizer.json", 2128466, "929c5252409436dce1b38a75d1abbcb5e132d170d8e324e4e04ed915fa2d22df")
_TOK_TXT = ("vocabulary.txt", 422309, "ff77588746d3a2595d32ab5b69ffd7b95ce2441ac57533cb66fc3eb575a115cf")

def _en_files(repo, rev, config_size, config_sha, bin_size, bin_sha):
    return [
        (repo, rev, "config.json", "config.json", config_size, config_sha),
        (repo, rev, "model.bin", "model.bin", bin_size, bin_sha),
        (repo, rev, "tokenizer.json", "tokenizer.json", _TOK_JSON[1], _TOK_JSON[2]),
        (repo, rev, "vocabulary.txt", "vocabulary.txt", _TOK_TXT[1], _TOK_TXT[2]),
    ]


TIERS = {
    "fast": {
        "label": "Fast",
        "detail": "small",
        "model": "small.en",
        "files": _en_files(
            "Systran/faster-whisper-small.en", _SMALL,
            2657, "666a9605530ac1f61fa8177f3702b4dacec9966749e42610839fcc32661d5fae",
            483545366, "62b2a45b05ee59acb4a5341b33ee35e041395d378d418a18acfe4c9e768ee37a",
        ),
    },
    "accurate": {
        "label": "Accurate",
        "detail": "medium",
        "model": "medium.en",
        "files": _en_files(
            "Systran/faster-whisper-medium.en", _MEDIUM,
            2643, "4a1848ebabe7938d9797c15a2e8e4ce1d36e6fd4a43d096ae5955257c67c7962",
            1527904330, "11b220779aea4c6f3ce9d2549c8a95ea869ed84066864b999531ef53e594fe5b",
        ),
    },
    "best": {
        "label": "Best",
        "detail": "large",
        "model": "distil-large-v3",
        "files": [
            ("Systran/faster-distil-whisper-large-v3", _DISTIL, "config.json", "config.json",
             2690, "90c55f775cc4e0bb17293d0bf12f96557a486f20dea886fabd8e6075a3588b21"),
            ("Systran/faster-distil-whisper-large-v3", _DISTIL, "model.bin", "model.bin",
             1512927867, "b79368e19b6623813609431a6e5ee309a71506701ebc49fd7820e692dec7c5f5"),
            ("Systran/faster-distil-whisper-large-v3", _DISTIL, "preprocessor_config.json", "preprocessor_config.json",
             340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"),
            ("Systran/faster-distil-whisper-large-v3", _DISTIL, "tokenizer.json", "tokenizer.json",
             2480617, "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca"),
            ("Systran/faster-distil-whisper-large-v3", _DISTIL, "vocabulary.json", "vocabulary.json",
             1068114, "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"),
        ],
    },
}

ALIGNER_FILES = [
    ("Xenova/wav2vec2-base-960h", _ALIGN, "vocab.json", "vocab.json",
     358, "4178db26b3c7570f6a47f14ac6a1c7b32950b8c2800fb097287e53776934f1c5"),
    ("Xenova/wav2vec2-base-960h", _ALIGN, "onnx/model_int8.onnx", "model.onnx",
     95286006, "a4249bb7b7bcbe391be19980922b0523c0907e976a9e5d5aabfadb40fcea5058"),
]

# Names the frozen app already ships, or that a caller (the smoke test) asks for by id.
BUNDLED_OK = {"base.en", "tiny.en", "base", "small", "small.en", "medium.en", "distil-large-v3"}

_lock = threading.Lock()
_progress = {"active": False, "name": "", "done": 0, "total": 0, "fraction": 0.0, "message": "", "error": None}
_verified = set()


def cache_root() -> Path:
    p = runtime.DATA_DIR / "models"
    p.mkdir(parents=True, exist_ok=True)
    return p


def progress():
    with _lock:
        return dict(_progress)


def set_progress(**kw):
    with _lock:
        _progress.update(kw)
        total = _progress.get("total") or 0
        done = _progress.get("done") or 0
        _progress["fraction"] = min(1.0, done / total) if total else 0.0
        _progress["active"] = bool(_progress.get("active"))


def clear_progress():
    set_progress(active=False, name="", done=0, total=0, fraction=0.0, message="", error=None)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _file_ok(path: Path, size: int, digest: str) -> bool:
    key = str(path)
    if key in _verified and path.is_file():
        return True
    if path.is_file() and path.stat().st_size == size and _sha256(path) == digest:
        _verified.add(key)
        return True
    return False


def _mem_gb() -> float:
    if sys.platform == "win32":
        try:
            import ctypes
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(stat)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                return stat.ullTotalPhys / 1e9
        except Exception:  # noqa: BLE001
            return 8.0
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1e9
    except (ValueError, OSError, AttributeError):
        return 8.0


def default_tier() -> str:
    """Best model that still finishes a clip on CPU. distil-large-v3 int8 needs ~8 GB."""
    mem = _mem_gb()
    if mem >= 7.5:
        return "best"
    if mem >= 4.0:
        return "accurate"
    return "fast"


def resolve_model(name: str) -> tuple[str, str]:
    """Map a tier id or a whisper folder name to (tier_or_empty, model_name)."""
    key = (name or "").strip()
    if key in TIERS:
        return key, TIERS[key]["model"]
    for tid, tier in TIERS.items():
        if tier["model"] == key:
            return tid, key
    if key in BUNDLED_OK:
        return "", key
    return default_tier(), TIERS[default_tier()]["model"]


def _search_dirs():
    # User cache first, then the read-only bundle (base.en + demucs).
    return [cache_root(), runtime.MODELS_DIR]


def whisper_path(model_name: str):
    for root in _search_dirs():
        p = root / f"faster-whisper-{model_name}"
        if (p / "model.bin").is_file():
            return p
    return None


def aligner_path():
    for root in _search_dirs():
        p = root / "wav2vec2-base-960h"
        if (p / "model.onnx").is_file() and (p / "vocab.json").is_file():
            return p
    return None


def aligner_ready() -> bool:
    p = aligner_path()
    if p is None:
        return False
    spec = {name: (size, digest) for *_, name, size, digest in ALIGNER_FILES}
    return all(_file_ok(p / name, size, digest) for name, (size, digest) in spec.items())


def tier_ready(tier_id: str) -> bool:
    tier = TIERS[tier_id]
    path = whisper_path(tier["model"])
    if path is None:
        return False
    # Bundled or previously checked files. Re-hash only the cache copy's model.bin once.
    return (path / "model.bin").is_file()


def tier_status():
    out = []
    default = default_tier()
    for tid, tier in TIERS.items():
        nbytes = sum(f[4] for f in tier["files"])
        out.append({
            "id": tid, "label": tier["label"], "detail": tier["detail"], "model": tier["model"],
            "bytes": nbytes, "ready": tier_ready(tid), "default": tid == default,
        })
    return out


def _download(url: str, dest: Path, size: int, digest: str, progress_base: int = 0, progress_total: int = 0):
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    if have > size:
        part.unlink()
        have = 0
    headers = {"User-Agent": "LucielLyric"}
    if have:
        headers["Range"] = f"bytes={have}-"
    req = urllib.request.Request(url, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=30)
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"couldn't download {dest.name}: {e}") from e
    code = getattr(resp, "status", 200)
    if code == 200 and have:
        have = 0
    mode = "ab" if have and code == 206 else "wb"
    if mode == "wb":
        have = 0
    done = have
    with resp, part.open(mode) as out:
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            cur = progress()
            set_progress(active=True, name=cur.get("name") or dest.name,
                         done=progress_base + done, total=progress_total or size,
                         message=cur.get("message") or f"Downloading {dest.name}")
    got_size = part.stat().st_size
    if got_size != size:
        part.unlink(missing_ok=True)
        raise RuntimeError(f"{dest.name} was {got_size} bytes, expected {size}")
    got = _sha256(part)
    if got != digest:
        part.unlink(missing_ok=True)
        raise RuntimeError(f"{dest.name} checksum didn't match")
    os.replace(part, dest)
    _verified.add(str(dest))


def _ensure(files, dest_dir: Path, label: str):
    missing = []
    for repo, rev, remote, name, size, digest in files:
        dest = dest_dir / name
        if not _file_ok(dest, size, digest):
            missing.append((repo, rev, remote, dest, size, digest))
    if not missing:
        return dest_dir
    total = sum(item[4] for item in missing)
    set_progress(active=True, name=label, done=0, total=total, message=f"Downloading {label}…", error=None)
    done_base = 0
    try:
        for repo, rev, remote, dest, size, digest in missing:
            set_progress(active=True, name=label, done=done_base, total=total,
                         message=f"Downloading {label}…")
            url = f"{ENDPOINT}/{repo}/resolve/{rev}/{remote}"
            _download(url, dest, size, digest, progress_base=done_base, progress_total=total)
            done_base += size
            set_progress(active=True, name=label, done=done_base, total=total, message=f"Downloading {label}…")
    except Exception as e:  # noqa: BLE001
        set_progress(active=False, error=str(e), message=str(e))
        raise
    set_progress(active=False, name=label, done=total, total=total, fraction=1.0, message=f"{label} ready", error=None)
    return dest_dir


def ensure_whisper(model_name: str) -> Path:
    found = whisper_path(model_name)
    if found is not None and (found / "model.bin").is_file():
        # Bundled base.en is trusted (the installer checksums it). Cached tiers are rechecked.
        tier_id = next((tid for tid, tier in TIERS.items() if tier["model"] == model_name), "")
        if not tier_id:
            return found
        files = TIERS[tier_id]["files"]
        if all(_file_ok(found / name, size, digest) for *_, name, size, digest in files):
            return found
    tier_id = next((tid for tid, tier in TIERS.items() if tier["model"] == model_name), "")
    if not tier_id:
        raise RuntimeError(f"Speech model {model_name} isn't on this computer.")
    dest = cache_root() / f"faster-whisper-{model_name}"
    label = f"{TIERS[tier_id]['label']} ({TIERS[tier_id]['detail']})"
    return _ensure(TIERS[tier_id]["files"], dest, label)


def ensure_aligner() -> Path:
    found = aligner_path()
    if found is not None and aligner_ready():
        return found
    return _ensure(ALIGNER_FILES, cache_root() / "wav2vec2-base-960h", "lyric aligner")
