"""Desktop sync: line breaks, detokenization, and forced alignment of a sung clip.

The sung clip is docs/fixtures/sung_clip.wav (espeak at a different pitch per word,
with vibrato, over a quiet chord). Word onsets in sung_clip.json are the times the
words were placed. Alignment must land within 0.3s and stay monotonic.

    python scripts/test_sync.py
"""
import json
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.align import group_into_lines, normalize_whisper_words, timings_look_real  # noqa: E402
from app.forced_align import align_lyrics_audio  # noqa: E402

FIX = ROOT / "docs" / "fixtures" / "sung_clip.json"
WAV = ROOT / "docs" / "fixtures" / "sung_clip.wav"


def test_not_every_eight_tokens():
    words = [{"text": "la", "start": i * 0.2, "end": i * 0.2 + 0.18, "confidence": 0.9} for i in range(10)]
    lines = group_into_lines(words)
    assert [len(ln["words"]) for ln in lines] == [10], [len(ln["words"]) for ln in lines]


def test_detokenize():
    raw = [
        {"text": " Don", "start": 0.10, "end": 0.30, "confidence": 0.8},
        {"text": "'t", "start": 0.30, "end": 0.40, "confidence": 0.7},
        {"text": " stop", "start": 0.50, "end": 0.80, "confidence": 0.9},
        {"text": ",", "start": 0.80, "end": 0.84, "confidence": 0.4},
        {"text": " there", "start": 1.00, "end": 1.30, "confidence": 0.8},
        {"text": "'s", "start": 1.30, "end": 1.45, "confidence": 0.6},
        {"text": " a", "start": 1.50, "end": 1.70, "confidence": 0.9},
        {"text": " light", "start": 1.80, "end": 2.10, "confidence": 0.9},
    ]
    words = normalize_whisper_words(raw)
    assert [w["text"] for w in words] == ["Don't", "stop,", "there's", "a", "light"], [w["text"] for w in words]
    assert words[0]["end"] >= 0.4
    assert " ," not in " ".join(w["text"] for w in words)
    assert " '" not in " ".join(w["text"] for w in words)


def test_flat_times_rejected():
    assert not timings_look_real([{"start": 0, "end": 0}, {"start": 0, "end": 0}, {"start": 0, "end": 0.01}], 12)
    collapsed = [
        {"start": 0.0, "end": 0.2},
        {"start": 0.2, "end": 19.8},
        {"start": 19.8, "end": 19.8},
    ]
    assert not timings_look_real(collapsed, 20)
    real = [{"start": 0.2, "end": 0.5}, {"start": 0.7, "end": 1.1}, {"start": 1.4, "end": 1.8}]
    assert timings_look_real(real, 8)


def _audio():
    with wave.open(str(WAV)) as w:
        import numpy as np
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        return audio, w.getframerate()


def _check_words(result, truth, tol=0.3):
    assert result["ok"], result.get("error")
    got = [w for ln in result["lines"] for w in ln["words"]]
    assert len(got) == len(truth), (len(got), len(truth), [w["text"] for w in got])
    prev = -0.001
    start_err, end_err = [], []
    for w, t in zip(got, truth):
        assert w["text"] == t["text"]
        ds = abs(w["start"] - t["start"])
        de = abs(w["end"] - t["end"])
        start_err.append(ds)
        end_err.append(de)
        assert ds <= tol, (w["text"], w["start"], t["start"], ds)
        assert de <= tol + 0.05, (w["text"], w["end"], t["end"], de)
        assert w["end"] > w["start"]
        assert w["start"] >= prev - 0.001
        prev = w["start"]
    # monotonic, and a word doesn't start before the previous one ended
    for a, b in zip(got, got[1:]):
        assert b["start"] + 1e-3 >= a["end"] - 0.02
        assert b["start"] >= a["start"] - 1e-3
    return start_err, end_err


def test_sung_alignment():
    import numpy as np
    meta = json.loads(FIX.read_text(encoding="utf-8"))
    audio, sr = _audio()
    result = align_lyrics_audio(audio, sr, meta["lyrics"])
    print("sung confidence", result["confidence"], "ok", result["ok"], "score", round(result.get("score", 0), 2))
    lines = [" ".join(w["text"] for w in ln["words"]) for ln in result["lines"]]
    assert lines == meta["lyrics"].splitlines(), lines
    # the 9-word last line stays one line (it used to split at 8)
    assert len(result["lines"][-1]["words"]) == 9
    start_err, end_err = _check_words(result, meta["words"])
    print(f"start mean {np.mean(start_err):.3f} max {np.max(start_err):.3f}")
    print(f"end   mean {np.mean(end_err):.3f} max {np.max(end_err):.3f}")
    assert np.mean(start_err) < 0.2


def test_whole_song_finds_the_clip():
    meta = json.loads(FIX.read_text(encoding="utf-8"))
    audio, sr = _audio()
    result = align_lyrics_audio(audio, sr, meta["whole_song"])
    print("window confidence", result["confidence"], "used", result["ref_words_used"], "of", result["ref_words"])
    typed = [" ".join(line.split()) for line in meta["whole_song"].splitlines() if line.strip()]
    lines = [" ".join(w["text"] for w in ln["words"]) for ln in result["lines"]]
    assert lines == typed, lines
    sung_text = meta["lyrics"].splitlines()
    sung = [ln for ln in result["lines"] if " ".join(w["text"] for w in ln["words"]) in sung_text]
    assert [" ".join(w["text"] for w in ln["words"]) for ln in sung] == sung_text
    _check_words({"ok": True, "lines": sung}, meta["words"])


def test_one_wrong_line_is_flagged():
    meta = json.loads(FIX.read_text(encoding="utf-8"))
    lines = meta["lyrics"].splitlines()
    lines[2] = "Purple zebras eat the moon"
    audio, sr = _audio()
    result = align_lyrics_audio(audio, sr, "\n".join(lines))
    print("mixed confidence", result["confidence"], "ok", result["ok"],
          [( " ".join(w["text"] for w in ln["words"]), ln["low_confidence"], ln["confidence"]) for ln in result["lines"]])
    assert result["lines"], "lines still come back"
    assert len(result["lines"]) == 4
    shown = [" ".join(w["text"] for w in ln["words"]) for ln in result["lines"]]
    assert shown == lines, shown
    flags = [ln["low_confidence"] for ln in result["lines"]]
    assert flags[2] is True, flags
    if result["ok"]:
        assert flags[0] is False and flags[1] is False and flags[3] is False, flags


def test_mismatch_is_reported():
    meta = json.loads(FIX.read_text(encoding="utf-8"))
    audio, sr = _audio()
    bad = "Zucchini orchestra\nplays a loud banana\nunder the copper moon tonight"
    result = align_lyrics_audio(audio, sr, bad)
    print("mismatch confidence", result["confidence"], "ok", result["ok"], "error", result.get("error"))
    assert result["ok"] is False
    assert result.get("error")
    assert result["lines"], "still return the lines so they can be tap-fixed"
    typed = [" ".join(line.split()) for line in bad.splitlines() if line.strip()]
    shown = [" ".join(w["text"] for w in ln["words"]) for ln in result["lines"]]
    assert shown == typed, shown
    assert all(ln["low_confidence"] for ln in result["lines"])


def test_typed_words_are_never_replaced():
    """A clip that sings different words must still show the paste, in order."""
    audio, sr = _audio()
    pasted = "\n".join([
        "PLEASE SEND ME BACK TO HEAVEN",
        "I DONT WANNA LIVE LIKE THIS",
        "PLEASE SEND ME BACK TO HEAVEN",
        "I DON'T WANNA FEEL LIKE THIS",
    ])
    result = align_lyrics_audio(audio, sr, pasted)
    typed = [" ".join(line.split()) for line in pasted.splitlines() if line.strip()]
    shown = [" ".join(w["text"] for w in ln["words"]) for ln in result["lines"]]
    print("typed kept", shown)
    assert shown == typed, shown
    assert all(ln["low_confidence"] for ln in result["lines"])
    assert result["ok"] is False


def main():
    test_not_every_eight_tokens()
    test_detokenize()
    test_flat_times_rejected()
    print("unit checks ok")
    test_sung_alignment()
    test_whole_song_finds_the_clip()
    test_one_wrong_line_is_flagged()
    test_mismatch_is_reported()
    test_typed_words_are_never_replaced()
    print("SYNC TESTS: PASS")


if __name__ == "__main__":
    main()
