#!/usr/bin/env bash
# Install the release APK on a booted emulator and capture the five main screens.
set -euo pipefail
cd "$(dirname "$0")/../.."

APK=$(find android/app/build/outputs/apk/release -name '*.apk' -print -quit)
if [ -z "${APK}" ] || [ ! -f "${APK}" ]; then
  echo "release apk not found"
  exit 1
fi
echo "Installing ${APK}"
adb wait-for-device
adb install -r -d "${APK}"
adb shell wm size 1080x2400 || true
adb shell wm density 440 || true

mkdir -p docs/screenshots
fail=0
for demo in track sync look time render; do
  adb logcat -c || true
  adb shell am force-stop app.luciel.lyric || true
  adb shell am start -n app.luciel.lyric/.MainActivity --es demo "${demo}"
  ok=0
  err=0
  for _ in $(seq 1 60); do
    if adb logcat -d -s LucielReady:I | grep -F "error:" >/dev/null; then
      echo "page error on ${demo}"
      adb logcat -d -s LucielReady:I | tail -40
      fail=1
      err=1
      break
    fi
    if adb logcat -d | awk '/FATAL EXCEPTION/{hit=1} hit && /Process: app.luciel.lyric/{found=1} END{exit found?0:1}'; then
      echo "crash on ${demo}"
      adb logcat -d | tail -100
      fail=1
      err=1
      break
    fi
    if adb logcat -d -s LucielReady:I | grep -F "${demo}" >/dev/null; then
      ok=1
      break
    fi
    sleep 1
  done
  if [ "${ok}" != 1 ] && [ "${err}" != 1 ]; then
    echo "timed out waiting for ${demo}"
    adb logcat -d | tail -120
    fail=1
  fi
  sleep 2
  out="docs/screenshots/android-${demo}.png"
  adb exec-out screencap -p > "${out}"
  python3 - "$out" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
b = p.read_bytes()
if not b.startswith(b"\x89PNG\r\n\x1a\n") or len(b) < 8000:
    raise SystemExit(f"bad screenshot {p} ({len(b)} bytes)")
print(p, len(b))
PY
done
exit "${fail}"
