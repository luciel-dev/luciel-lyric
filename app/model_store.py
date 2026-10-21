"""Sync models that download on first use and then stay on disk.

Fast / Accurate / Best are faster-whisper checkpoints. They are too big to put in
the installer. The wav2vec2 aligner is the same: one download, then offline.
Bundled base.en (the small offline fallback the installer already ships) is still
found in the app's models folder.
"""
import hashlib
import os
import threading
import time
import urllib.request
from pathlib import Path

from . import runtime

# Pinned Hugging Face revisions. model.bin checksums are the Git-LFS sha256.
_SMALL = "536b0662742c02347bc0e980a01041f333bce120"
_MEDIUM = "08e178d48790749d25932bbc082711ddcfdfbc4f"
_DISTIL = "c3058b475261292e64a0412df1d2681c06260fab"
_W2V = "a19f851b3d42865797e410752b4c570c871e4825"

SYNC_MODELS = {
    "small": {
        "id": "small",
        "label": "Fast",
        "detail": "small",
        "repo": "Systran/faster-whisper-small",
        "revision": _SMALL,
        "blurb": "Quicker on this computer. Fine when the vocal is clear.",
    },
    "medium": {
        "id": "medium",
        "label": "Accurate",
        "detail": "medium",
        "repo": "Systran/faster-whisper-medium",
        "revision": _MEDIUM,
        "blurb": "Slower, hears more of a busy mix.",
    },
    "distil-large-v3": {
        "id": "distil-large-v3",
        "label": "Best",
        "detail": "distil-large-v3",
        "repo": "Systran/faster-distil-whisper-large-v3",
        "revision": _DISTIL,
        "blurb": "Best quality that still runs on CPU. This is the default.",
    },
}
DEFAULT_SYNC_MODEL = "distil-large-v3"
ALIGNER_ID = "wav2vec2"

# (filename, size, sha256) per model id. Aligner files live beside model.onnx.
_FILES = {
    "small": [
        ("config.json", 2370, "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828"),
        ("model.bin", 483546902, "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671"),
        ("tokenizer.json", 2203239, "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab"),
        ("vocabulary.txt", 459861, "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913"),
    ],
    "medium": [
        ("config.json", 2257, "3622a2ddc41ec0e0fd4e68c13c6830f03b90c38d89aaad184de02c8c642cf807"),
        ("model.bin", 1527906378, "9b45e1009dcc4ab601eff815b61d80e60ce3fd8c74c1a14f4a282258286b51ae"),
        ("tokenizer.json", 2203239, "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab"),
        ("vocabulary.txt", 459861, "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913"),
    ],
    "distil-large-v3": [
        ("config.json", 2690, "90c55f775cc4e0bb17293d0bf12f96557a486f20dea886fabd8e6075a3588b21"),
        ("model.bin", 1512927867, "b79368e19b6623813609431a6e5ee309a71506701ebc49fd7820e692dec7c5f5"),
        ("preprocessor_config.json", 340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"),
        ("tokenizer.json", 2480617, "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca"),
        ("vocabulary.json", 1068114, "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"),
    ],
    ALIGNER_ID: [
        ("model.onnx", 377887594, "e46614273f03ff4b87923a965e417fa72004825522cb007c9c25633b8475490d"),
        ("vocab.json", 358, "4178db26b3c7570f6a47f14ac6a1c7b32950b8c2800fb097287e53776934f1c5"),
        ("preprocessor_config.json", 215, "8cdfd65ff4115423185a1512bdae100e2e0cd744f5b322417429944aaafd0827"),
    ],
}

_ALIGNER_REPO = "Xenova/wav2vec2-base-960h"
_jobs = {}
_job_lock = threading.Lock()
_dl_lock = threading.Lock()


def cache_dir() -> Path:
    """Writable model cache. The frozen app cannot save into its own install folder."""
    path = runtime.DATA_DIR / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _search_dirs():
    dirs = []
    for d in (cache_dir(), runtime.MODELS_DIR):
        if d not in dirs:
            dirs.append(d)
    return dirs


def whisper_dir(name: str):
    """Folder with model.bin for a faster-whisper checkpoint, or None."""
    folder_name = f"faster-whisper-{name}"
    for base in _search_dirs():
        p = base / folder_name
        if (p / "model.bin").exists():
            return p
    return None


def aligner_dir():
    for base in _search_dirs():
        p = base / "wav2vec2-base-960h"
        if all((p / name).is_file() and (p / name).stat().st_size == size
               for name, size, _sha in _FILES[ALIGNER_ID]):
            return p
    return None


def aligner_ready() -> bool:
    return aligner_dir() is not None


def _present(model_id: str, folder: Path) -> bool:
    """Size check only. Hashing a 1.5 GB checkpoint on every page load is too slow;
    ensure() verifies the checksum when a download is requested."""
    if folder is None:
        return False
    for name, size, _digest in _FILES.get(model_id, []):
        path = folder / name
        if not path.is_file() or path.stat().st_size != size:
            return False
    return True


def is_cached(model_id: str) -> bool:
    if model_id == ALIGNER_ID:
        return aligner_ready()
    if model_id in SYNC_MODELS:
        return _present(model_id, whisper_dir(model_id))
    return whisper_dir(model_id) is not None


def _complete(model_id: str, folder: Path) -> bool:
    for name, size, digest in _FILES.get(model_id, []):
        path = folder / name
        if not path.is_file() or path.stat().st_size != size or _sha256(path) != digest:
            return False
    return True


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _ok(path: Path, size: int, digest: str) -> bool:
    return path.is_file() and path.stat().st_size == size and _sha256(path) == digest


def catalog():
    """What the Sync model menu shows."""
    out = []
    for mid, meta in SYNC_MODELS.items():
        total = sum(size for _n, size, _d in _FILES[mid])
        out.append({
            "id": mid,
            "label": meta["label"],
            "detail": meta["detail"],
            "blurb": meta["blurb"],
            "cached": is_cached(mid),
            "size_mb": round(total / 1e6, 0),
            "default": mid == DEFAULT_SYNC_MODEL,
        })
    align_bytes = sum(size for _n, size, _d in _FILES[ALIGNER_ID])
    return {
        "models": out,
        "default": DEFAULT_SYNC_MODEL,
        "aligner": {"id": ALIGNER_ID, "cached": aligner_ready(), "size_mb": round(align_bytes / 1e6, 0)},
    }


def resolve_whisper_name(requested: str) -> str:
    """Accept the menu id, an old checkpoint name, or empty (meaning the default)."""
    name = (requested or "").strip()
    if not name:
        return DEFAULT_SYNC_MODEL
    return name


def folder_for(model_id: str) -> Path:
    if model_id == ALIGNER_ID:
        return cache_dir() / "wav2vec2-base-960h"
    return cache_dir() / f"faster-whisper-{model_id}"


def _url(model_id: str, filename: str) -> str:
    if model_id == ALIGNER_ID:
        repo, rev = _ALIGNER_REPO, _W2V
        if filename == "model.onnx":
            filename = "onnx/model.onnx"
    else:
        meta = SYNC_MODELS[model_id]
        repo, rev = meta["repo"], meta["revision"]
    return f"https://huggingface.co/{repo}/resolve/{rev}/{filename}"


def _download_file(url: str, dest: Path, size: int, digest: str, progress):
    if _ok(dest, size, digest):
        progress(1.0)
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    tmp = part
    have = tmp.stat().st_size if tmp.exists() else 0
    if have > size:
        tmp.unlink()
        have = 0
    headers = {"User-Agent": "LucielLyric"}
    if have:
        headers["Range"] = f"bytes={have}-"
    req = urllib.request.Request(url, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=60)
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"Could not download {dest.name}: {e}") from e
    status = getattr(resp, "status", 200)
    if status == 200 and have:
        have = 0
    mode = "ab" if have and status == 206 else "wb"
    if mode == "wb":
        have = 0
    done = have
    with resp, open(tmp, mode) as out:
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            progress(min(0.99, done / size) if size else 1.0)
    if tmp.stat().st_size != size or _sha256(tmp) != digest:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"{dest.name} failed its checksum. It will be downloaded again next time.")
    os.replace(tmp, dest)
    progress(1.0)


def ensure(model_id: str, progress=None):
    """Download anything missing for one model. progress(frac, label) is optional."""
    if model_id not in _FILES:
        raise RuntimeError(f"Unknown model {model_id}")
    folder = folder_for(model_id)
    # A bundled copy (base.en, or a model someone already fetched) counts.
    if model_id != ALIGNER_ID:
        existing = whisper_dir(model_id)
        if existing is not None and _present(model_id, existing):
            if progress:
                progress(1.0, "Already saved on this computer")
            return existing
    if model_id == ALIGNER_ID and aligner_ready():
        if progress:
            progress(1.0, "Already saved on this computer")
        return aligner_dir()
    files = _FILES[model_id]
    total = sum(size for _n, size, _d in files)
    done_bytes = 0
    label = "aligner" if model_id == ALIGNER_ID else SYNC_MODELS[model_id]["label"]
    for name, size, digest in files:
        dest = folder / name

        def one(frac, name=name, size=size, done_bytes=done_bytes):
            if progress:
                overall = (done_bytes + frac * size) / total
                progress(overall, f"Downloading {label} · {name}")

        _download_file(_url(model_id, name), dest, size, digest, one)
        done_bytes += size
    if progress:
        progress(1.0, f"{label} saved")
    return folder


def start_job(model_ids) -> dict:
    """Download these models on a background thread. Returns the job snapshot."""
    ids = []
    for mid in model_ids:
        if mid and mid not in ids:
            ids.append(mid)
    job_id = hashlib.sha1(f"{time.time()}:{ids}".encode()).hexdigest()[:12]
    job = {"id": job_id, "status": "running", "progress": 0.0, "label": "Starting download",
           "error": None, "models": ids}
    with _job_lock:
        _jobs[job_id] = job

    def run():
        try:
            with _dl_lock:
                n = len(ids) or 1
                for i, mid in enumerate(ids):
                    def cb(frac, label, i=i):
                        with _job_lock:
                            job["progress"] = (i + frac) / n
                            job["label"] = label
                    ensure(mid, cb)
            with _job_lock:
                job["status"] = "done"
                job["progress"] = 1.0
                job["label"] = "Saved on this computer. Sync works offline now."
        except Exception as e:  # noqa: BLE001
            with _job_lock:
                job["status"] = "error"
                job["error"] = str(e)
                job["label"] = str(e)

    threading.Thread(target=run, daemon=True).start()
    return dict(job)


def job_snapshot(job_id: str):
    with _job_lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None
