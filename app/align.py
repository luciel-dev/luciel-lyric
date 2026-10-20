"""Lyric alignment helpers: whisper words -> lines, and pasted lyrics -> whisper timing."""
import re
from rapidfuzz import fuzz

_norm_re = re.compile(r"[^a-z0-9']+")


def norm(w: str) -> str:
    return _norm_re.sub("", w.lower().replace("’", "'"))


def group_into_lines(words, max_words=8, max_chars=38, gap=0.5):
    """Group a flat list of whisper words into display lines."""
    lines, cur = [], []
    for i, w in enumerate(words):
        if cur:
            prev = cur[-1]
            chars = sum(len(x["text"]) + 1 for x in cur)
            if (w["start"] - prev["end"] > gap or len(cur) >= max_words
                    or chars + len(w["text"]) > max_chars
                    or re.search(r"[.!?]$", prev["text"])
                    or (re.search(r"[,;:]$", prev["text"]) and len(cur) >= 4)):
                lines.append({"words": cur})
                cur = []
        cur.append(w)
    if cur:
        lines.append({"words": cur})
    return lines


def _sim(a: str, b: str) -> float:
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return fuzz.ratio(a, b) / 100.0


def align_lyrics(pasted: str, wwords, clip_len: float):
    """Semi-global Needleman-Wunsch alignment of pasted lyric words (ref) to
    whisper words (hyp). Leading/trailing pasted words are free to skip, so the
    user can paste the WHOLE song's lyrics and only the part sung in the clip
    is kept. Returns (lines, stats)."""
    ref = []  # (text, line_idx)
    for li, line in enumerate([l.strip() for l in pasted.splitlines() if l.strip()]):
        for t in line.split():
            ref.append((t, li))
    n, m = len(ref), len(wwords)
    if n == 0 or m == 0:
        return group_into_lines(wwords), {"matched": 0, "ref_words": n, "hyp_words": m}

    GAP_R, GAP_H = -0.6, -0.6
    NEG = -1e9
    S = [[0.0] * (m + 1) for _ in range(n + 1)]
    B = [[0] * (m + 1) for _ in range(n + 1)]  # 0 diag, 1 up (skip ref), 2 left (skip hyp)
    for j in range(1, m + 1):
        S[0][j] = S[0][j - 1] + GAP_H; B[0][j] = 2
    for i in range(1, n + 1):
        S[i][0] = 0.0; B[i][0] = 1  # free leading ref skip
    sims = [[_sim(ref[i][0], wwords[j]["text"]) for j in range(m)] for i in range(n)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            s = sims[i - 1][j - 1]
            match = S[i - 1][j - 1] + (2.0 * s if s >= 0.5 else -1.0 + s)
            up = S[i - 1][j] + GAP_R
            left = S[i][j - 1] + GAP_H
            best = max(match, up, left)
            S[i][j] = best
            B[i][j] = 0 if best == match else (1 if best == up else 2)
    # free trailing ref skip: choose best end row in last column
    end_i = max(range(n + 1), key=lambda i: S[i][m])
    pairs = {}  # ref idx -> hyp idx
    i, j = end_i, m
    while i > 0 and j > 0:
        b = B[i][j]
        if b == 0:
            if sims[i - 1][j - 1] >= 0.5:
                pairs[i - 1] = j - 1
            i -= 1; j -= 1
        elif b == 1:
            i -= 1
        else:
            j -= 1
    start_i = i
    if not pairs:
        return group_into_lines(wwords), {"matched": 0, "ref_words": n, "hyp_words": m}

    # Region of ref covered by the clip: from first to last matched ref word,
    # extended to whole lines it touches only when those words are inside the clip.
    lo, hi = min(pairs), max(pairs)
    sel = list(range(lo, hi + 1))
    out = []
    for r in sel:
        if r in pairs:
            h = wwords[pairs[r]]
            out.append({"text": ref[r][0], "start": h["start"], "end": h["end"], "line": ref[r][1], "matched": True})
        else:
            out.append({"text": ref[r][0], "start": None, "end": None, "line": ref[r][1], "matched": False})
    # Interpolate unmatched runs between matched anchors, weighted by length.
    k = 0
    while k < len(out):
        if out[k]["matched"]:
            k += 1; continue
        s = k
        while k < len(out) and not out[k]["matched"]:
            k += 1
        t0 = out[s - 1]["end"] if s > 0 else max(0.0, out[k]["start"] - 0.4 * (k - s))
        t1 = out[k]["start"] if k < len(out) else min(clip_len, t0 + 0.4 * (k - s))
        if t1 < t0:
            t1 = t0
        weights = [max(1, len(out[x]["text"])) for x in range(s, k)]
        tot = sum(weights); acc = t0
        for x, wgt in zip(range(s, k), weights):
            d = (t1 - t0) * wgt / tot
            out[x]["start"], out[x]["end"] = round(acc, 3), round(acc + d, 3)
            acc += d
    # Build lines following the pasted line breaks (split very long lines).
    lines, cur, cur_line = [], [], None
    for w in out:
        if cur and (w["line"] != cur_line or len(cur) >= 8):
            lines.append({"words": cur}); cur = []
        cur_line = w["line"]
        cur.append({"text": w["text"], "start": w["start"], "end": w["end"], "matched": w["matched"]})
    if cur:
        lines.append({"words": cur})
    stats = {"matched": len(pairs), "ref_words_used": len(sel), "ref_words": n, "hyp_words": m}
    return lines, stats


def refine_with_energy(words, audio16, sr=16000, hop=0.01):
    """Snap word boundaries next to silences onto the vocal energy envelope.
    Whisper's word starts tend to be early by ~0.2-0.4s; on an isolated vocal stem the
    energy onset is far more precise. Only touches words adjacent to a pause."""
    import numpy as np
    if len(words) == 0 or len(audio16) == 0:
        return words
    h = int(sr * hop)
    n = len(audio16) // h
    env = np.sqrt(np.mean(audio16[: n * h].reshape(n, h) ** 2, axis=1) + 1e-12)
    ref = np.percentile(env, 95)
    if ref <= 0:
        return words
    thr = 0.12 * ref
    on = env > thr
    out = [dict(w) for w in words]
    for i, w in enumerate(out):
        prev_end = out[i - 1]["end"] if i else -1.0
        nxt_start = words[i + 1]["start"] if i + 1 < len(words) else 1e9
        if w["start"] - prev_end > 0.12 or i == 0:
            a = int(max(0, w["start"] - 0.15, prev_end + 0.02) / hop); b = int(min(w["end"] - 0.05, w["start"] + 0.5) / hop)
            idx = np.nonzero(on[a:b])[0] if b > a else []
            if len(idx):
                w["start"] = round((a + idx[0]) * hop, 3)
        if nxt_start - w["end"] > 0.12 or i == len(out) - 1:
            a = int(max(w["start"] + 0.05, w["end"] - 0.3) / hop); b = int(min(nxt_start - 0.02, w["end"] + 0.3) / hop)
            idx = np.nonzero(on[a:b])[0] if b > a else []
            if len(idx):
                w["end"] = round((a + idx[-1] + 1) * hop, 3)
        if w["end"] <= w["start"]:
            w["end"] = round(w["start"] + 0.05, 3)
    return out
