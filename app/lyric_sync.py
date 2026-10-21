"""Decide what a Sync press returns: forced alignment, a rough match, or a transcript.

Typed lyrics go through wav2vec2 CTC on the vocal stem. Speech recognition is for
an empty lyric box, and for the case where forced alignment cannot lock on.
"""
from .align import align_lyrics, group_into_lines, timings_look_real


def hear_words(model, audio16, *, lyrics: str = "", language: str | None = None, model_name: str = ""):
    """Transcribe with word times, VAD, and the pasted lyrics as a prompt."""
    prompt = None
    if lyrics and lyrics.strip():
        prompt = " ".join(lyrics.split())[:500]
    lang = language or None
    if not lang and (model_name.endswith(".en") or model_name.startswith("distil")):
        lang = "en"
    segments, info = model.transcribe(
        audio16,
        word_timestamps=True,
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 350, "speech_pad_ms": 180},
        condition_on_previous_text=False,
        initial_prompt=prompt,
        language=lang,
        temperature=0.0,
    )
    words = []
    for seg in segments:
        for w in (seg.words or []):
            text = (w.word or "").strip()
            if not text or text[0] in "[<":
                continue
            start = max(0.0, float(w.start))
            end = float(w.end)
            words.append({
                "text": text,
                "start": round(start, 3),
                "end": round(max(end, start), 3),
                "prob": round(float(getattr(w, "probability", 0.0) or 0.0), 3),
            })
    return words, info


def assemble(lyrics: str, ctc, asr_words, clip_len: float) -> dict:
    """Turn an aligner result and/or a transcript into the sync payload."""
    lyrics = (lyrics or "").strip()
    heard = asr_words or []
    if lyrics and ctc and ctc.get("status") != "failed":
        lines = ctc["lines"]
        low = sum(1 for line in lines if line.get("low_confidence"))
        return {
            "lines": lines,
            "mode": "forced_alignment",
            "status": ctc["status"],
            "message": ctc["message"],
            "stats": {
                "matched": sum(len(line["words"]) for line in lines),
                "ref_words_used": sum(len(line["words"]) for line in lines),
                "mean_confidence": ctc.get("mean_confidence"),
                "low_lines": low,
            },
        }
    if lyrics:
        lines, stats = align_lyrics(lyrics, heard, clip_len)
        if ctc and ctc.get("status") == "failed" and (stats.get("placeholder") or stats.get("matched", 0) < 3):
            return {
                "lines": ctc["lines"],
                "mode": "forced_alignment",
                "status": "failed",
                "message": ctc.get("message") or "Couldn't lock these lyrics onto the vocals.",
                "stats": {"matched": 0, "mean_confidence": 0, "placeholder": True, "ref_words": stats.get("ref_words")},
            }
        if stats.get("placeholder") or stats.get("matched", 0) < 3:
            if ctc is None:
                message = ("The alignment model isn't on this computer yet, so these times are only a guide. "
                           "Connect once and sync again to download it, or use Tap to sync.")
            else:
                message = stats.get("error") or "These lyrics did not lock onto the audio. Use Tap to sync."
            return {"lines": lines, "mode": "approximate", "status": "failed", "message": message, "stats": stats}
        low = sum(1 for line in lines if line.get("low_confidence"))
        message = (f"Rough match: {stats.get('matched', 0)} words took their time from speech recognition. "
                   "Highlighted lines need a look, or use Tap to sync.")
        if ctc is None:
            message += " Downloading the alignment model gives a real lock."
        return {
            "lines": lines,
            "mode": "approximate",
            "status": "low_confidence" if low else "approximate",
            "message": message,
            "stats": stats,
        }
    if not timings_look_real(heard):
        return {
            "lines": [],
            "mode": "transcribed",
            "status": "failed",
            "message": "No words were heard clearly in this clip. Paste the lyrics, or turn on Isolate vocals.",
            "stats": {"hyp_words": len(heard)},
        }
    lines = group_into_lines(heard)
    low = sum(1 for line in lines if line.get("low_confidence"))
    noun = "line" if low == 1 else "lines"
    verb = "looks" if low == 1 else "look"
    message = f"Heard {len(heard)} words."
    if low:
        message += f" {low} {noun} {verb} unsure and highlighted."
    message += " Paste the real lyrics for a tighter sync."
    return {
        "lines": lines,
        "mode": "transcribed",
        "status": "low_confidence" if low else "ok",
        "message": message,
        "stats": {"hyp_words": len(heard), "low_lines": low},
    }
