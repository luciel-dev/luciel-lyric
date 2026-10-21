#!/usr/bin/env bash
# Transcribe whisper.cpp's JFK clip with the tiny English model and run the
# same word merge the phone uses. Word times must be real and increasing.
set -euo pipefail
cd "$(dirname "$0")/../.."

ROOT="$(pwd)"
WHISPER="$ROOT/android/third_party/whisper.cpp"
MODEL="${LUCIEL_WHISPER_MODEL:-$HOME/.cache/luciel/ggml-tiny.en.bin}"
BUILD="$ROOT/android/third_party/whisper-host"

if ! grep -q "VERSION 1.7.6" "$WHISPER/CMakeLists.txt" 2>/dev/null; then
  echo "Fetching whisper.cpp v1.7.6"
  mkdir -p "$ROOT/android/third_party"
  tar="$(mktemp)"
  curl -fsSL "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.7.6.tar.gz" -o "$tar"
  rm -rf "$WHISPER" "$ROOT/android/third_party/whisper.cpp-1.7.6"
  tar -xzf "$tar" -C "$ROOT/android/third_party"
  mv "$ROOT/android/third_party/whisper.cpp-1.7.6" "$WHISPER"
  rm -f "$tar"
fi

if [ ! -x "$BUILD/bin/whisper-cli" ]; then
  cmake -S "$WHISPER" -B "$BUILD" -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_SERVER=OFF -DCMAKE_BUILD_TYPE=Release
  cmake --build "$BUILD" --target whisper-cli -j"$(nproc)"
fi

if [ ! -f "$MODEL" ]; then
  mkdir -p "$(dirname "$MODEL")"
  echo "Downloading ggml-tiny.en.bin"
  curl -fL --retry 3 -o "$MODEL.partial" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin"
  mv "$MODEL.partial" "$MODEL"
fi

WAV="$WHISPER/samples/jfk.wav"
if [ ! -f "$WAV" ]; then
  echo "missing $WAV"
  exit 1
fi

OUT=/tmp/luciel-jfk
rm -f "$OUT.json"
"$BUILD/bin/whisper-cli" -m "$MODEL" -f "$WAV" -l en -ojf -of "$OUT" -t "$(nproc)"
test -s "$OUT.json"

g++ -std=c++17 -I "$ROOT/android/app/src/main/cpp" "$ROOT/android/scripts/merge_test.cpp" -o /tmp/luciel-merge-test
/tmp/luciel-merge-test fixture

python3 - "$OUT.json" <<'PY' | /tmp/luciel-merge-test stdin > /tmp/luciel-words.json
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
n = 0
for seg in data.get("transcription") or []:
    for tok in seg.get("tokens") or []:
        text = (tok.get("text") or "").replace("\n", " ").replace("\r", " ").replace("\t", " ")
        off = tok.get("offsets") or {}
        if "from" in off and "to" in off:
            t0 = float(off["from"]) / 1000.0
            t1 = float(off["to"]) / 1000.0
        else:
            t0 = t1 = 0.0
        sys.stdout.write(f"{t0:.3f}\t{t1:.3f}\t{text}\n")
        n += 1
if n < 4:
    raise SystemExit(f"whisper json had {n} timed tokens")
print(f"tokens {n}", file=sys.stderr)
PY

python3 - /tmp/luciel-words.json <<'PY'
import json, sys
words = json.load(open(sys.argv[1], encoding="utf-8"))
text = " ".join(w["text"] for w in words).lower()
print(text)
if "country" not in text and "america" not in text:
    raise SystemExit("jfk transcript did not contain the known lyric")
prev = -1
moved = False
for w in words:
    if not (w["end"] > w["start"] >= prev - 0.05):
        raise SystemExit(f"bad timing {w}")
    if w["start"] > 0.05:
        moved = True
    prev = w["start"]
if not moved:
    raise SystemExit("every word starts at zero")
if words[-1]["end"] < 4 or words[-1]["end"] > 30:
    raise SystemExit("clip span is not the jfk recording")
if any(t in ("'s", "avers", ",") for t in (w["text"] for w in words)):
    raise SystemExit("punctuation or subword left as its own word")
print(f"whisper words ok count={len(words)} end={words[-1]['end']:.2f}")
PY
