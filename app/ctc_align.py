"""CTC forced alignment of known lyrics.

The emission matrix comes from wav2vec2 (see app/aligner.py). This module is only
numpy, so the Viterbi path and the line-window search can be tested without the
model. Token times are monotonic by construction: each frame is assigned one
label, and labels only move forward.
"""
import numpy as np

NEG = -1e30
# A line is low-confidence when its weakest word is below this, or the line mean is.
LOW_WORD = 0.18
LOW_LINE = 0.30


def log_softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - logits.max(axis=-1, keepdims=True)
    return shifted - np.log(np.exp(shifted).sum(axis=-1, keepdims=True) + 1e-12)


def ctc_viterbi(logp: np.ndarray, tokens, blank: int = 0):
    """Best CTC path. Returns (token_at_frame, total_logprob) or None.

    token_at_frame[t] is an index into ``tokens``, or -1 where the path is blank.
    """
    tokens = [int(t) for t in tokens]
    if not tokens or any(t == blank for t in tokens):
        return None
    logp = np.ascontiguousarray(logp, dtype=np.float64)
    frames, classes = logp.shape
    if frames <= 0 or max(tokens) >= classes:
        return None
    ext = np.empty(len(tokens) * 2 + 1, dtype=np.int64)
    ext[0::2] = blank
    ext[1::2] = tokens
    states = ext.shape[0]
    dp = np.full((frames, states), NEG, dtype=np.float64)
    ptr = np.zeros((frames, states), dtype=np.int8)
    dp[0, 0] = logp[0, blank]
    dp[0, 1] = logp[0, ext[1]]
    skip_ok = np.zeros(states, dtype=bool)
    for s in range(2, states):
        if ext[s] != blank and ext[s] != ext[s - 2]:
            skip_ok[s] = True
    index = np.arange(states)
    for t in range(1, frames):
        prev = dp[t - 1]
        stay = prev
        earlier = np.empty(states)
        earlier[0] = NEG
        earlier[1:] = prev[:-1]
        skip = np.full(states, NEG)
        if skip_ok.any():
            src = np.where(skip_ok, index - 2, 0)
            skip[skip_ok] = prev[src[skip_ok]]
        choices = np.vstack((stay, earlier, skip))
        pick = np.argmax(choices, axis=0).astype(np.int8)
        ptr[t] = pick
        dp[t] = choices[pick, index] + logp[t, ext]
    tail = dp[-1, -2:]
    if not np.isfinite(tail).any() or float(tail.max()) <= NEG / 2:
        return None
    state = states - 2 + int(np.argmax(tail))
    at = np.empty(frames, dtype=np.int32)
    at[-1] = state
    for t in range(frames - 1, 0, -1):
        step = int(ptr[t, state])
        if step == 1:
            state -= 1
        elif step == 2:
            state -= 2
        at[t - 1] = state
    token_at = np.full(frames, -1, dtype=np.int32)
    for t, state in enumerate(at):
        if state % 2 == 1:
            token_at[t] = (int(state) - 1) // 2
    return token_at, float(dp[-1, int(at[-1])])


def lyric_lines(text: str):
    """Non-empty lines, each a list of display words. Blank lines are separators, not times."""
    lines = []
    for raw in (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        words = raw.split()
        if words:
            lines.append(words)
    return lines


def _spell(word: str, table: dict) -> list:
    out = []
    for ch in word.upper().replace("’", "'").replace("‘", "'"):
        if ch == "'":
            if "'" in table:
                out.append(table["'"])
            continue
        if ch.isalpha() and ch in table:
            out.append(table[ch])
    return out


def _tokenize(words, table, sep_id: int):
    """Flat CTC tokens for these display words, plus the token span of each word.

    Words with no letters (a stray dash, for example) get an empty span and are
    timed later from their neighbours.
    """
    tokens = []
    spans = []  # (word index, tok start, tok end) end exclusive; empty if unsounded
    for i, word in enumerate(words):
        ids = _spell(word, table)
        if not ids:
            spans.append((i, len(tokens), len(tokens)))
            continue
        if tokens:
            tokens.append(sep_id)
        start = len(tokens)
        tokens.extend(ids)
        spans.append((i, start, len(tokens)))
    return tokens, spans


def _times_from_path(token_at, spans, n_words, frame_dur, logp, tokens):
    words = [{"start": None, "end": None, "confidence": 0.0, "sounded": False} for _ in range(n_words)]
    for index, a, b in spans:
        if a == b:
            continue
        frames = np.nonzero((token_at >= a) & (token_at < b))[0]
        if len(frames) == 0:
            continue
        words[index]["start"] = float(frames[0] * frame_dur)
        words[index]["end"] = float((frames[-1] + 1) * frame_dur)
        words[index]["sounded"] = True
        picked = np.asarray(tokens, dtype=np.int64)[token_at[frames]]
        words[index]["confidence"] = float(np.exp(logp[frames, picked]).mean())
    return words


def _fill_gaps(words, clip_len):
    """Give unsounded words a monotonic slice between the sounded words around them."""
    n = len(words)
    i = 0
    while i < n:
        if words[i]["start"] is not None:
            i += 1
            continue
        j = i
        while j < n and words[j]["start"] is None:
            j += 1
        left = words[i - 1]["end"] if i else 0.0
        right = words[j]["start"] if j < n else clip_len
        if right < left:
            right = left
        if right - left < 0.04 * (j - i):
            right = left + 0.04 * (j - i)
        weights = [1.0] * (j - i)
        total = float(sum(weights))
        cursor = left
        for k in range(i, j):
            step = (right - left) * weights[k - i] / total
            words[k]["start"] = cursor
            words[k]["end"] = cursor + step
            words[k]["confidence"] = min(words[k]["confidence"], 0.05)
            cursor += step
        i = j
    prev = 0.0
    for w in words:
        start = max(prev, float(w["start"] or 0.0))
        end = max(start + 0.04, float(w["end"] or start))
        if end > clip_len and clip_len > start:
            end = max(start + 0.04, clip_len)
        w["start"] = round(start, 3)
        w["end"] = round(end, 3)
        prev = w["end"]
    return words


def _score_alignment(timed, total_logp, n_tokens, clip_len):
    sounded = [w for w in timed if w["sounded"]]
    if not sounded or n_tokens <= 0:
        return -1e9, 0.0
    mean_lp = total_logp / n_tokens
    span = max(0.0, sounded[-1]["end"] - sounded[0]["start"]) / max(0.1, clip_len)
    cram = sum(1 for w in sounded if (w["end"] - w["start"]) < 0.05) / len(sounded)
    return mean_lp + 0.25 * span - 1.5 * cram, float(np.mean([w["confidence"] for w in sounded]))


def align_words(logp, words, table, frame_dur, clip_len, sep_id):
    """Align one flat word list. Returns a dict or None when the path does not fit."""
    tokens, spans = _tokenize(words, table, sep_id)
    if not tokens:
        return None
    # Repeated letters need a blank between them, so the audio must be longer than the token list.
    repeats = sum(1 for a, b in zip(tokens, tokens[1:]) if a == b)
    if logp.shape[0] < len(tokens) + repeats:
        return None
    found = ctc_viterbi(logp, tokens, blank=0)
    if found is None:
        return None
    token_at, total = found
    # tokens passed to viterbi excluded nothing; sep stays in the list. Word spans index that list.
    # ctc_viterbi skips blank id 0 only. sep_id must not be 0.
    timed = _times_from_path(token_at, spans, len(words), frame_dur, logp, tokens)
    score, mean_conf = _score_alignment(timed, total, len(tokens), clip_len)
    return {"timed": timed, "score": score, "mean_confidence": mean_conf, "tokens": len(tokens)}


def align_lyrics_to_emissions(logp, pasted: str, frame_dur: float, table: dict, sep_id: int = 4):
    """Pick the lyric lines that actually fit this clip and align every word.

    A whole-song paste is longer than a 15–30s clip. Emissions are computed once;
    each candidate run of lines is a cheap Viterbi over those same frames. The
    user's line breaks are the lines we return — nothing is re-cut into chunks.
    """
    lines = lyric_lines(pasted)
    clip_len = float(logp.shape[0] * frame_dur)
    if not lines:
        return {"status": "failed", "lines": [], "message": "Paste the lyrics first.", "mean_confidence": 0.0,
                "matched_lines": 0, "line_count": 0}
    flat = [word for line in lines for word in line]

    def consider(word_slice, line_lo, line_hi):
        got = align_words(logp, word_slice, table, frame_dur, clip_len, sep_id)
        if got is None:
            return None
        got["line_lo"] = line_lo
        got["line_hi"] = line_hi
        got["words"] = word_slice
        return got

    # Every run of lines is scored against the same emissions. The sung section
    # beats a whole-song paste because the extra verses do not fit the audio.
    best = None
    frames = logp.shape[0]
    hi_n = max(4, int(clip_len * 3.4))
    for i in range(len(lines)):
        bucket = []
        for j in range(i, min(len(lines), i + 18)):
            bucket.extend(lines[j])
            if len(bucket) > hi_n:
                break
            n_tok = len(_tokenize(bucket, table, sep_id)[0])
            if n_tok < frames * 0.04 or n_tok > frames * 0.75:
                continue
            cand = consider(bucket, i, j)
            if cand is not None and (best is None or cand["score"] > best["score"]):
                best = cand
    if best is None:
        return _failed(lines, clip_len, "The aligner could not lock these lyrics onto the vocals.")

    timed = _fill_gaps(best["timed"], clip_len)
    built = [[] for _ in lines[best["line_lo"]:best["line_hi"] + 1]]
    confs = [[] for _ in built]
    slice_owners = []
    for li in range(best["line_lo"], best["line_hi"] + 1):
        for wi in range(len(lines[li])):
            slice_owners.append((li - best["line_lo"], wi))
    for (local_line, _wi), word, when in zip(slice_owners, best["words"], timed):
        built[local_line].append({
            "text": word,
            "start": when["start"],
            "end": when["end"],
            "confidence": round(float(when["confidence"]), 3),
            "matched": bool(when["sounded"] and when["confidence"] >= LOW_WORD),
        })
        confs[local_line].append(float(when["confidence"]))
    out_lines = []
    low_lines = 0
    for words, cs in zip(built, confs):
        if not words:
            continue
        mean = float(sum(cs) / len(cs)) if cs else 0.0
        low = mean < LOW_LINE or any(c < LOW_WORD for c in cs)
        if low:
            low_lines += 1
        out_lines.append({
            "words": words,
            "confidence": round(mean, 3),
            "low_confidence": low,
        })
    mean_conf = float(best["mean_confidence"])
    if mean_conf < 0.12:
        status = "failed"
        message = ("These lyrics did not lock onto the singing (confidence "
                   f"{mean_conf:.0%}). The times below are only a guide — use Tap to sync, "
                   "or check that this clip is the part you pasted.")
    elif low_lines:
        status = "low_confidence"
        noun = "line" if low_lines == 1 else "lines"
        verb = "looks" if low_lines == 1 else "look"
        message = (f"Aligned {sum(len(l['words']) for l in out_lines)} words. "
                   f"{low_lines} {noun} {verb} unsure and highlighted on the timeline — "
                   "fix them there, or tap those lines.")
    else:
        status = "ok"
        message = f"Aligned {sum(len(l['words']) for l in out_lines)} words to the vocals."
    return {
        "status": status,
        "lines": out_lines,
        "message": message,
        "mean_confidence": round(mean_conf, 3),
        "matched_lines": len(out_lines),
        "line_count": len(lines),
        "line_lo": best["line_lo"],
        "line_hi": best["line_hi"],
    }


def _failed(lines, clip_len, message):
    """User's words, spread evenly and flagged, so a miss is obvious instead of silent."""
    weights = [max(1, sum(len(w) for w in line)) for line in lines]
    total = float(sum(weights)) or 1.0
    cursor = 0.0
    out = []
    for line, weight in zip(lines, weights):
        span = clip_len * weight / total
        parts = [max(1, len(w)) for w in line]
        part_total = float(sum(parts))
        t = cursor
        words = []
        for word, part in zip(line, parts):
            step = span * part / part_total
            words.append({"text": word, "start": round(t, 3), "end": round(t + step, 3),
                          "confidence": 0.0, "matched": False})
            t += step
        cursor += span
        out.append({"words": words, "confidence": 0.0, "low_confidence": True, "placeholder": True})
    return {"status": "failed", "lines": out, "message": message, "mean_confidence": 0.0,
            "matched_lines": 0, "line_count": len(lines), "placeholder": True}
