"""Offline forced alignment of typed lyrics to audio.

Wav2vec2 CTC (the same idea as WhisperX) assigns every typed word a start and
an end. It does not listen with Whisper and then fuzzy-match. Line breaks in
the paste are kept, and punctuation stays on the word it was typed with.
"""
import json
import threading

import numpy as np

from .model_store import ensure_aligner

_BLANK_TOKEN = "<pad>"
_WORD_BREAK = "|"
# Log score per typed word. The sung fixture lands near -13; a lyric sheet that
# isn't in the clip lands near -30. Low lines are marked from the acoustic
# posterior, which is spiky even when the time is right, so the cut is relative.
OK_SCORE_PER_WORD = -20.0
# Extra pasted lines are dropped only when they make the alignment clearly worse.
WINDOW_MARGIN = 0.03

_lock = threading.Lock()
_session = None
_session_key = None
_vocab = None


def _load():
    global _session, _session_key, _vocab
    folder = ensure_aligner()
    key = str(folder)
    with _lock:
        if _session is not None and _session_key == key:
            return _session, _vocab
        import onnxruntime as ort
        opts = ort.SessionOptions()
        # One thread keeps the CTC path stable. The default pool can move a word by a few frames.
        opts.intra_op_num_threads = 1
        opts.inter_op_num_threads = 1
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        _session = ort.InferenceSession(str(folder / "model.onnx"), opts, providers=["CPUExecutionProvider"])
        _vocab = json.loads((folder / "vocab.json").read_text(encoding="utf-8"))
        _session_key = key
        return _session, _vocab


def parse_lyrics(text: str):
    """Split a paste into words, keeping punctuation and the typed line breaks."""
    rows = []
    for li, line in enumerate(text.splitlines()):
        for token in line.split():
            if token:
                rows.append({"text": token, "line": li})
    return rows


def _chars(token: str, vocab: dict):
    out = []
    for ch in token.upper().replace("’", "'").replace("‘", "'"):
        if ch in vocab and ch not in ("<pad>", "<s>", "</s>", "<unk>", "|"):
            out.append(vocab[ch])
    return out


def _log_probs(logits: np.ndarray):
    m = logits.max(axis=1, keepdims=True)
    exp = np.exp(logits - m)
    probs = exp / np.clip(exp.sum(axis=1, keepdims=True), 1e-12, None)
    return probs, np.log(np.clip(probs, 1e-10, 1.0))


def _viterbi(log_probs: np.ndarray, targets: np.ndarray, blank: int):
    """CTC forced alignment. Returns the frame path and the total log score."""
    T = log_probs.shape[0]
    L = int(targets.shape[0])
    if T == 0 or L == 0:
        return None, -1e30
    ext = np.empty(2 * L + 1, dtype=np.int64)
    ext[0::2] = blank
    ext[1::2] = targets
    S = ext.shape[0]
    neg = -1e30
    emit = log_probs[:, ext].astype(np.float64)
    can_skip = np.zeros(S, dtype=bool)
    if S > 2:
        can_skip[2:] = (ext[2:] != blank) & (ext[2:] != ext[:-2])
    dp = np.full(S, neg, dtype=np.float64)
    dp[0] = emit[0, 0]
    if S > 1:
        dp[1] = emit[0, 1]
    ptr = np.zeros((T, S), dtype=np.int8)
    cols = np.arange(S)
    for t in range(1, T):
        prev = np.full(S, neg, dtype=np.float64)
        prev[1:] = dp[:-1]
        skip = np.full(S, neg, dtype=np.float64)
        if S > 2:
            skip[2:] = dp[:-2]
            skip = np.where(can_skip, skip, neg)
        stacked = np.vstack((dp, prev, skip))
        src = np.argmax(stacked, axis=0).astype(np.int8)
        dp = stacked[src, cols] + emit[t]
        ptr[t] = src
    end_tok = dp[S - 2] if S >= 2 else neg
    s = S - 1 if dp[S - 1] >= end_tok else S - 2
    score = float(dp[s])
    if score < -1e20:
        return None, score
    states = np.empty(T, dtype=np.int32)
    for t in range(T - 1, -1, -1):
        states[t] = s
        if t == 0:
            break
        step = int(ptr[t, s])
        if step == 1:
            s -= 1
        elif step == 2:
            s -= 2
        if s < 0:
            s = 0
    return ext[states], score


def _align_slice(log_probs, probs, rows, vocab, blank, frame_s):
    pieces = []  # (token id, word index or -1 for a boundary)
    for wi, row in enumerate(rows):
        chars = _chars(row["text"], vocab)
        if not chars:
            continue
        if pieces:
            pieces.append((vocab[_WORD_BREAK], -1))
        for tok in chars:
            pieces.append((tok, wi))
    if not pieces:
        return None
    targets = np.asarray([p[0] for p in pieces], dtype=np.int64)
    path, score = _viterbi(log_probs, targets, blank)
    if path is None:
        return None
    frames = [[] for _ in rows]
    mass = [0.0 for _ in rows]
    count = [0 for _ in rows]
    ti = t = 0
    T = len(path)
    while t < T and ti < len(pieces):
        tok = int(path[t])
        if tok == blank:
            t += 1
            continue
        if tok != pieces[ti][0]:
            return None
        wi = pieces[ti][1]
        while t < T and int(path[t]) == tok:
            if wi >= 0:
                frames[wi].append(t)
                mass[wi] += float(probs[t, tok])
                count[wi] += 1
            t += 1
        ti += 1
    if ti != len(pieces):
        return None
    words = []
    for wi, row in enumerate(rows):
        fr = frames[wi]
        if not fr:
            words.append({
                "text": row["text"], "line": row["line"], "start": None, "end": None,
                "confidence": 0.0, "low_confidence": True,
            })
            continue
        conf = mass[wi] / count[wi] if count[wi] else 0.0
        words.append({
            "text": row["text"], "line": row["line"],
            "start": fr[0] * frame_s, "end": (fr[-1] + 1) * frame_s,
            "confidence": conf, "low_confidence": False,
        })
    return words, score


def _fill_gaps(words, duration):
    """Words with no letters (emoji, pure punctuation) borrow a slice of the neighbours."""
    for i, w in enumerate(words):
        if w["start"] is not None:
            continue
        prev_end = words[i - 1]["end"] if i and words[i - 1]["end"] is not None else 0.0
        nxt = next((words[j]["start"] for j in range(i + 1, len(words)) if words[j]["start"] is not None), None)
        nxt_start = nxt if nxt is not None else min(duration, prev_end + 0.12)
        w["start"] = prev_end
        w["end"] = max(prev_end + 0.04, nxt_start)
        w["confidence"] = 0.0
        w["low_confidence"] = True
    prev = 0.0
    for w in words:
        start = max(float(w["start"]), prev)
        end = max(float(w["end"]), start + 0.02)
        if duration:
            end = min(duration, end)
            start = min(start, max(0.0, end - 0.02))
        w["start"] = round(start, 3)
        w["end"] = round(max(end, start + 0.02), 3)
        prev = w["end"]
    return words


def _group_lines(words):
    lines, cur, cur_line = [], [], None
    for w in words:
        if cur and w["line"] != cur_line:
            lines.append(cur)
            cur = []
        cur_line = w["line"]
        cur.append(w)
    if cur:
        lines.append(cur)
    return lines


def _calibrate(score_per_word: float) -> float:
    """Map a CTC score per word onto something a person can read as confidence."""
    return float(np.clip((score_per_word - (-36.0)) / ((-10.0) - (-36.0)), 0.0, 1.0))


def _pack_lines(groups, ok: bool):
    means = []
    packed = []
    for group in groups:
        cs = [w["confidence"] for w in group]
        mean = sum(cs) / len(cs) if cs else 0.0
        means.append(mean)
        packed.append((group, mean))
    overall = sum(means) / len(means) if means else 0.0
    out = []
    for group, mean in packed:
        # A line well below the rest of the clip, or simply very weak. The absolute
        # floor stays under ~0.15: a correct line on CPU can land there, and the
        # wrong line in the sung fixture is the one that falls away from the others.
        low = (not ok) or mean < 0.12 or (mean < overall - 0.12 and mean < overall * 0.55)
        out.append({
            "words": [{
                "text": w["text"], "start": w["start"], "end": w["end"],
                "confidence": round(float(w["confidence"]), 3), "low_confidence": low,
            } for w in group],
            "confidence": round(mean, 3),
            "low_confidence": low,
        })
    return out


def _windows(rows, duration):
    """Contiguous typed lines. The whole paste is always one of the choices."""
    if not rows:
        return []
    bounds = []
    start = 0
    for i in range(1, len(rows) + 1):
        if i == len(rows) or rows[i]["line"] != rows[start]["line"]:
            bounds.append((start, i))
            start = i
    n = len(bounds)
    spans = []
    for i in range(n):
        for j in range(i + 1, n + 1):
            a, _ = bounds[i]
            _, b = bounds[j - 1]
            count = b - a
            if count < 1:
                continue
            if (i == 0 and j == n) or duration * 0.45 <= count <= max(8, duration * 4.5):
                spans.append((a, b))
    if len(spans) > 40:
        step = max(1, len(spans) // 36)
        kept = spans[::step]
        full = (0, len(rows))
        if full not in kept:
            kept.append(full)
        spans = kept
    # unique, full text last so a tie keeps what the user typed
    seen = set()
    out = []
    for span in spans:
        if span not in seen:
            seen.add(span)
            out.append(span)
    return out


def align_lyrics_audio(audio, sample_rate: int, text: str) -> dict:
    """Align `text` to a mono waveform. `audio` is float32 in about -1..1."""
    rows = parse_lyrics(text or "")
    duration = float(len(audio)) / float(sample_rate or 16000) if len(audio) else 0.0
    if not rows:
        return {"ok": False, "error": "Paste the lyrics first.", "confidence": 0.0, "lines": [], "words": []}
    if duration < 0.4:
        return {"ok": False, "error": "That clip is too short to align.", "confidence": 0.0, "lines": [], "words": []}
    rms = float(np.sqrt(np.mean(np.square(audio)))) if len(audio) else 0.0
    if rms < 0.004:
        return {
            "ok": False,
            "error": "This section is silent, so the lyrics can't be aligned.",
            "confidence": 0.0, "lines": [], "words": [],
        }
    session, vocab = _load()
    wave = np.asarray(audio, dtype=np.float32)
    if sample_rate != 16000:
        n = int(round(len(wave) * 16000 / sample_rate))
        wave = np.interp(np.linspace(0, len(wave) - 1, n), np.arange(len(wave)), wave).astype(np.float32)
        duration = len(wave) / 16000.0
    norm = (wave - wave.mean()) / (wave.std() + 1e-7)
    logits = session.run(None, {"input_values": norm[None, :]})[0][0]
    probs, logp = _log_probs(logits.astype(np.float64))
    frame_s = duration / max(1, logp.shape[0])
    blank = int(vocab[_BLANK_TOKEN])
    cands = []
    for a, b in _windows(rows, duration):
        aligned = _align_slice(logp, probs, rows[a:b], vocab, blank, frame_s)
        if aligned is None:
            continue
        words, score = aligned
        n = max(1, b - a)
        cands.append((score / n, n, words, score))
    if not cands:
        return {
            "ok": False,
            "error": "Couldn't align these lyrics to the vocals.",
            "confidence": 0.0, "lines": [], "words": [],
        }
    best_key = max(c[0] for c in cands)
    # Among spans that fit about as well, keep the most words (the user's lines).
    close = [c for c in cands if c[0] >= best_key - abs(best_key) * WINDOW_MARGIN]
    _, _, words, score = max(close, key=lambda c: c[1])
    words = _fill_gaps(words, duration)
    per = score / max(1, len(words))
    ok = per >= OK_SCORE_PER_WORD and all(w["end"] > w["start"] for w in words)
    lines = _pack_lines(_group_lines(words), ok)
    error = None
    if not ok:
        error = (
            "These lyrics don't match the singing closely enough. "
            "Low-confidence lines are marked on the timeline — fix the words, or tap them in."
        )
    flat = [w for ln in lines for w in ln["words"]]
    return {
        "ok": ok,
        "error": error,
        "confidence": round(_calibrate(per), 3),
        "score": score,
        "lines": lines,
        "words": flat,
        "ref_words": len(rows),
        "ref_words_used": len(words),
    }
