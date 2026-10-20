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
capture() {
  local demo="$1" theme="$2" file="$3"
  adb logcat -c || true
  adb shell am force-stop app.luciel.lyric || true
  adb shell am start -n app.luciel.lyric/.MainActivity --es demo "${demo}" --es theme "${theme}"
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
  out="docs/screenshots/${file}"
  # SwiftShader sometimes hands screencap a blank WebView frame. Keep the first
  # shot whose page area is not one flat colour.
  blank=1
  for _try in 1 2 3 4 5 6; do
    sleep 2
    adb exec-out screencap -p > "${out}"
    if python3 - "$out" <<'PY'
import pathlib, struct, sys, zlib
p = pathlib.Path(sys.argv[1])
b = p.read_bytes()
if not b.startswith(b"\x89PNG\r\n\x1a\n") or len(b) < 8000:
    raise SystemExit(f"bad screenshot {p} ({len(b)} bytes)")
i, w, h, idat = 8, 0, 0, []
color = depth = 0
while i + 8 <= len(b):
    ln, typ = struct.unpack(">I4s", b[i:i + 8])
    data = b[i + 8:i + 8 + ln]
    i += 12 + ln
    if typ == b"IHDR":
        w, h, depth, color = struct.unpack(">IIBB", data[:10])
    elif typ == b"IDAT":
        idat.append(data)
    elif typ == b"IEND":
        break
if depth != 8 or color not in (2, 6) or not w or not h:
    raise SystemExit(f"unsupported png {w}x{h} depth={depth} color={color}")
n = 4 if color == 6 else 3
raw = zlib.decompress(b"".join(idat))
stride = w * n
rows = []
pos = 0
prev = bytearray(stride)

def paeth(a, b_, c):
    pred = a + b_ - c
    pa, pb, pc = abs(pred - a), abs(pred - b_), abs(pred - c)
    if pa <= pb and pa <= pc:
        return a
    return b_ if pb <= pc else c

for y in range(h):
    f = raw[pos]
    row = bytearray(raw[pos + 1:pos + 1 + stride])
    pos += 1 + stride
    if f == 1:
        for x in range(stride):
            row[x] = (row[x] + (row[x - n] if x >= n else 0)) & 255
    elif f == 2:
        for x in range(stride):
            row[x] = (row[x] + prev[x]) & 255
    elif f == 3:
        for x in range(stride):
            left = row[x - n] if x >= n else 0
            row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
    elif f == 4:
        for x in range(stride):
            left = row[x - n] if x >= n else 0
            up = prev[x]
            ul = prev[x - n] if x >= n else 0
            row[x] = (row[x] + paeth(left, up, ul)) & 255
    elif f != 0:
        raise SystemExit(f"bad filter {f}")
    prev = row
    rows.append(row)
lums = []
for y in range(int(h * 0.12), int(h * 0.88), 12):
    row = rows[y]
    for x in range(0, w, 12):
        o = x * n
        lums.append(0.3 * row[o] + 0.59 * row[o + 1] + 0.11 * row[o + 2])
mean = sum(lums) / len(lums)
var = sum((v - mean) ** 2 for v in lums) / len(lums)
if var < 40:
    raise SystemExit(f"blank frame var={var:.1f}")
print(p, len(b), f"var={var:.0f}")
PY
    then
      blank=0
      break
    fi
    echo "blank frame for ${file}, retry ${_try}"
  done
  if [ "${blank}" != 0 ]; then
    echo "screenshot stayed blank: ${file}"
    fail=1
  fi
}

capture track aero android-track.png
capture sync aero android-sync.png
capture look aero android-look.png
capture time aero android-time.png
capture render aero android-render.png
capture look y2k android-look-y2k.png
capture look winamp android-look-winamp.png
exit "${fail}"
