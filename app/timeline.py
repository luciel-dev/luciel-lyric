"""One-track timeline maths for the video editor and the renderer.

A clip plays at 1x. Its timeline length is ``out - in`` (source seconds). Clips do not overlap
once the editor has snapped them; if they do, the later clip in the list wins.
"""


def clip_dur(clip):
    inn = float(clip.get("in") or 0)
    out = clip.get("out")
    if out is None:
        out = float(clip.get("duration") or inn)
    return max(0.0, float(out) - inn)


def clip_at(clips, t):
    """Return ``(index, clip, local_time)`` for the last clip covering ``t``, or None."""
    hit = None
    for i, clip in enumerate(clips or []):
        start = float(clip.get("start") or 0)
        dur = clip_dur(clip)
        if dur <= 0:
            continue
        if start <= t < start + dur - 1e-9:
            hit = (i, clip, t - start)
    return hit


def split_at(clips, t, min_edge=0.12):
    """Split the clip under ``t`` into two. Raises ValueError when the cut is too close to an edge."""
    hit = clip_at(clips, t)
    if hit is None:
        raise ValueError("no clip at the playhead")
    i, clip, local = hit
    dur = clip_dur(clip)
    if local < min_edge or dur - local < min_edge:
        raise ValueError("cut is too close to a clip edge")
    inn = float(clip.get("in") or 0)
    left = dict(clip)
    right = dict(clip)
    left["out"] = inn + local
    right["in"] = inn + local
    right["start"] = float(clip.get("start") or 0) + local
    if right.get("id"):
        right["id"] = str(right["id"]) + "b"
    out = list(clips)
    out[i:i + 1] = [left, right]
    return out
