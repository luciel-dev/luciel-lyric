"""Offline wav2vec2 CTC aligner.

Weights download once into the user model cache (see app/model_store.py) and then
load with onnxruntime, which this app already ships for Whisper's VAD. Torch stays
out of the server process: loading it next to CTranslate2 corrupts transcription.
"""
import json
import os
import threading

import numpy as np

from . import model_store
from .ctc_align import align_lyrics_to_emissions, log_softmax

_lock = threading.Lock()
_session = None
_table = None
_normalize = True


def available() -> bool:
    return model_store.aligner_ready()


def _load():
    global _session, _table, _normalize
    if _session is not None:
        return
    folder = model_store.aligner_dir()
    if folder is None:
        raise RuntimeError("The alignment model is not downloaded yet.")
    import onnxruntime as ort
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = max(1, (os.cpu_count() or 2) // 2)
    opts.log_severity_level = 3
    _session = ort.InferenceSession(str(folder / "model.onnx"), sess_options=opts,
                                    providers=["CPUExecutionProvider"])
    vocab = json.loads((folder / "vocab.json").read_text(encoding="utf-8"))
    _table = {str(k): int(v) for k, v in vocab.items()}
    pre = folder / "preprocessor_config.json"
    _normalize = True
    if pre.exists():
        _normalize = bool(json.loads(pre.read_text(encoding="utf-8")).get("do_normalize", True))


def emissions(audio16: np.ndarray) -> np.ndarray:
    """Log-probabilities, shape (frames, classes), for a mono 16 kHz waveform."""
    with _lock:
        _load()
        session = _session
        normalize = _normalize
    audio = np.ascontiguousarray(audio16, dtype=np.float32)
    if audio.ndim != 1:
        audio = audio.reshape(-1)
    if normalize:
        audio = audio - float(audio.mean())
        audio = audio / (float(audio.std()) + 1e-7)
    logits = session.run(None, {"input_values": audio.reshape(1, -1)})[0][0]
    return log_softmax(np.asarray(logits, dtype=np.float32))


def align(audio16: np.ndarray, lyrics: str, sample_rate: int = 16000):
    """Force-align pasted lyrics. Returns the ctc_align result dict."""
    if audio16 is None or len(audio16) < sample_rate // 5:
        from .ctc_align import lyric_lines, _failed
        lines = lyric_lines(lyrics)
        return _failed(lines, 1.0, "That clip is too short to align.")
    logp = emissions(audio16)
    duration = len(audio16) / float(sample_rate)
    frame_dur = duration / max(1, logp.shape[0])
    with _lock:
        table = dict(_table)
    return align_lyrics_to_emissions(logp, lyrics, frame_dur, table, sep_id=table.get("|", 4))
