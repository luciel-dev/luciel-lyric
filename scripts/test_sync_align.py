"""Desktop lyric-sync checks.

Unit checks run with numpy only. The sung check builds a short espeak phrase,
force-aligns the typed lyrics with wav2vec2, and requires each word start to
land within 0.3s of where that word was placed.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.align import align_lyrics, group_into_lines, timings_look_real  # noqa: E402
from app.ctc_align import align_lyrics_to_emissions, ctc_viterbi, log_softmax  # noqa: E402
from app.lyric_sync import hear_words  # noqa: E402


def check(cond, msg):
    if not cond:
        raise SystemExit("FAIL: " + msg)


def test_viterbi_monotonic():
    classes = 29
    blank, sep = 0, 27
    table = {chr(ord("A") + i): i + 1 for i in range(26)}
    table["|"] = sep
    frames = 50
    frame_dur = 0.02
    logits = np.full((frames, classes), -6.0, np.float32)
    logits[:, blank] = 3.0

    def stamp(start, n, tok):
        logits[start:start + n, :] = -8
        logits[start:start + n, tok] = 7

    # HI then GO, with a word separator. Expected starts are the first stamped frames.
    stamp(8, 4, table["H"])
    stamp(12, 4, table["I"])
    stamp(17, 2, sep)
    stamp(24, 4, table["G"])
    stamp(28, 4, table["O"])
    logp = log_softmax(logits)
    got = align_lyrics_to_emissions(logp, "HI GO", frame_dur, table, sep_id=sep)
    check(got["status"] != "failed", got["message"])
    words = got["lines"][0]["words"]
    check(len(words) == 2, f"expected 2 words, got {words}")
    expect = [8 * frame_dur, 24 * frame_dur]
    prev = -1.0
    for word, target in zip(words, expect):
        check(abs(word["start"] - target) <= 0.3, f"{word['text']} start {word['start']} vs {target}")
        check(word["end"] > word["start"], f"{word['text']} end before start")
        check(word["start"] >= prev - 1e-3, "times went backwards")
        prev = word["end"]
    # A direct path is monotonic in the token index it emits.
    tokens = [table["H"], table["I"], sep, table["G"], table["O"]]
    path, score = ctc_viterbi(logp, tokens, blank=blank)
    check(path is not None and np.isfinite(score), "viterbi failed")
    seen = [int(i) for i in path if i >= 0]
    check(seen == sorted(seen), "token path is not monotonic")


def test_line_breaks_and_fallback():
    words = [{"text": f"w{i}", "start": round(i * 0.4, 3), "end": round(i * 0.4 + 0.3, 3), "prob": 0.9}
             for i in range(12)]
    lines = group_into_lines(words)
    check(len(lines) == 1 and len(lines[0]["words"]) == 12, f"12-word line was split into { [len(l['words']) for l in lines] }")
    text = "one two three four five six seven eight nine ten eleven twelve"
    hyp = [{"text": w, "start": 0.5 + i * 0.5, "end": 0.9 + i * 0.5, "prob": 0.92} for i, w in enumerate(text.split())]
    aligned, stats = align_lyrics(text, hyp, 12)
    check(len(aligned) == 1 and len(aligned[0]["words"]) == 12, "pasted 12-word line was re-cut")
    check(not stats.get("placeholder"), "a clean match was treated as a failure")

    flat = [{"text": "the", "start": 0.0, "end": 0.0, "prob": 0.1} for _ in range(8)]
    check(not timings_look_real(flat), "collapsed timestamps looked real")
    check(timings_look_real(hyp), "real timestamps were rejected")

    kept, st = align_lyrics("city lights\nare calling", [], 10)
    check(st.get("placeholder"), "empty transcript should not pretend to sync")
    heard = [w["text"] for ln in kept for w in ln["words"]]
    check(heard[:2] == ["city", "lights"], f"typed lyrics were replaced: {heard}")

    junk = [{"text": t, "start": 1 + i * 0.4, "end": 1.3 + i * 0.4, "prob": 0.8}
            for i, t in enumerate(["zzzz", "qqqq", "xxxx"])]
    bad, st2 = align_lyrics("stars above the quiet street", junk, 10)
    check(st2.get("placeholder"), "an unrelated transcript was accepted")
    texts = [w["text"] for ln in bad for w in ln["words"]]
    check(texts[0] == "stars" and "zzzz" not in texts, f"user text was discarded: {texts}")


class _FakeModel:
    def __init__(self):
        self.kw = None

    def transcribe(self, audio, **kw):
        self.kw = kw
        return [], type("Info", (), {"language": kw.get("language")})()


def test_hear_words_flags():
    model = _FakeModel()
    hear_words(model, np.zeros(16000, np.float32), lyrics="hold on through the rain", model_name="distil-large-v3")
    kw = model.kw
    check(kw["word_timestamps"] is True, "word timestamps off")
    check(kw["vad_filter"] is True, "VAD off")
    check(kw["initial_prompt"] and "hold on" in kw["initial_prompt"], "lyrics were not passed as the prompt")
    check(kw["language"] == "en", "distil model was not pinned to English")
    check(kw["temperature"] == 0.0, "temperature was not fixed")


def _espeak_cmd(text, dest):
    env = os.environ.copy()
    binary = shutil.which("espeak-ng") or shutil.which("espeak")
    path_arg = []
    if not binary:
        root = Path("/tmp/espeakroot")
        binary = str(root / "usr/bin/espeak-ng")
        data = root / "usr/lib/x86_64-linux-gnu/espeak-ng-data"
        if not Path(binary).exists():
            return None
        path_arg = [f"--path={data}"]
        env["LD_LIBRARY_PATH"] = str(root / "usr/lib/x86_64-linux-gnu") + os.pathsep + env.get("LD_LIBRARY_PATH", "")
    subprocess.check_call([binary, *path_arg, "-w", str(dest), "-s", "118", text], env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return True


def _read_wav(path):
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        ch = wf.getnchannels()
        raw = wf.readframes(wf.getnframes())
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        audio = audio.reshape(-1, ch).mean(axis=1)
    return audio, sr


def _to_16k(src, dest, pitch, tempo):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        from app.runtime import FFMPEG
        ffmpeg = FFMPEG
    # asetrate shifts pitch; atempo puts the duration back so the word still fits its slot.
    filt = f"asetrate=22050*{pitch:.3f},aresample=16000,atempo={tempo:.3f}"
    subprocess.check_call([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
                           "-ac", "1", "-af", filt, str(dest)], stdout=subprocess.DEVNULL)
    audio, sr = _read_wav(dest)
    check(sr == 16000, f"expected 16 kHz, got {sr}")
    return audio


def test_sung_alignment():
    if not _espeak_cmd("test", Path(tempfile.gettempdir()) / "luciel_espeak_probe.wav"):
        raise SystemExit("FAIL: espeak-ng is not available")
    # Placements are the ground truth. Each word is pitched so the clip is sung, not read flat.
    schedule = [
        ("city", 0.45, 1.00), ("lights", 1.05, 1.12), ("are", 1.70, 0.94), ("calling", 2.15, 1.06),
        ("hold", 3.35, 0.90), ("on", 3.85, 1.08), ("through", 4.30, 1.00), ("the", 4.95, 0.96),
        ("rain", 5.30, 1.10), ("we", 6.55, 1.04), ("are", 6.95, 0.92), ("golden", 7.40, 1.14),
        ("we", 8.70, 1.00), ("are", 9.15, 0.95), ("young", 9.60, 1.08),
    ]
    lines = [
        "stars above the quiet street",
        "City lights are calling",
        "hold on through the rain",
        "we are golden",
        "we are young",
        "dancing till the morning comes",
    ]
    sr = 16000
    length = 11.35
    mix = np.zeros(int(length * sr), np.float32)
    truth = []
    pitches = [1.00, 1.12, 0.94, 1.06, 0.90, 1.08, 1.00, 0.96, 1.10, 1.04, 0.92, 1.14, 1.00, 0.95, 1.08]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for i, (word, start, _pitch) in enumerate(schedule):
            raw = tmp / f"{i}.wav"
            out = tmp / f"{i}p.wav"
            _espeak_cmd(word, raw)
            nxt = schedule[i + 1][1] if i + 1 < len(schedule) else length - 0.15
            slot = max(0.28, nxt - start - 0.06)
            audio = _to_16k(raw, out, pitches[i], 1.0)
            # Fit the word into the gap without changing where it starts.
            if len(audio) / sr > slot:
                audio = _to_16k(raw, out, pitches[i], min(2.0, (len(audio) / sr) / slot))
            n = min(len(audio), len(mix) - int(start * sr))
            at = int(start * sr)
            mix[at:at + n] += audio[:n]
            truth.append({"text": word, "start": start, "end": start + n / sr})
    peak = np.max(np.abs(mix)) or 1.0
    mix = (mix / peak * 0.8).astype(np.float32)

    from app import model_store
    from app.aligner import align
    model_store.ensure("wav2vec2")
    pasted = "\n".join(lines)
    result = align(mix, pasted)
    print(f"sung status={result['status']} mean={result.get('mean_confidence')} "
          f"lines={result.get('matched_lines')}/{result.get('line_count')} msg={result['message']}")
    check(result["status"] in ("ok", "low_confidence"), result["message"])
    got_lines = [" ".join(w["text"] for w in ln["words"]).lower() for ln in result["lines"]]
    expect_lines = [ln.lower() for ln in lines[1:5]]
    check(got_lines == expect_lines, f"line breaks changed: {got_lines}")
    got = [w for ln in result["lines"] for w in ln["words"]]
    check(len(got) == len(truth), f"word count {len(got)} != {len(truth)}")
    errs = []
    prev = -1.0
    for g, t in zip(got, truth):
        err = abs(float(g["start"]) - t["start"])
        errs.append(err)
        check(g["text"].lower() == t["text"], f"word text {g['text']} != {t['text']}")
        check(err <= 0.30, f"{g['text']} off by {err:.3f}s (got {g['start']}, truth {t['start']})")
        check(float(g["end"]) > float(g["start"]), f"{g['text']} not positive duration")
        check(float(g["start"]) >= prev - 0.02, f"{g['text']} overlaps the previous word")
        prev = float(g["end"])
    mae = float(np.mean(errs))
    within = sum(e <= 0.30 for e in errs)
    print(f"sung accuracy: n={len(errs)} mae={mae:.3f}s max={max(errs):.3f}s within_0.3s={within}/{len(errs)}")
    check(result["status"] == "ok", f"clean vocal should not be flagged: {result['message']}")


if __name__ == "__main__":
    test_viterbi_monotonic()
    test_line_breaks_and_fallback()
    test_hear_words_flags()
    print("unit checks ok")
    test_sung_alignment()
    print("alignment checks ok")
