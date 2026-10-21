#!/usr/bin/env bash
# Install the release APK, assert every screen/theme has real content and no
# overflow at font scale 1.3, then capture the phone screenshots.
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
adb shell settings put system font_scale 1.3 || true

mkdir -p docs/screenshots
fail=0
last_hash=""

check_line() {
  local line="$1" screen="$2" theme="$3"
  python3 - "$line" "$screen" "$theme" <<'PY'
import sys
line, screen, theme = sys.argv[1:]
if f"{screen} {theme} ok" not in line:
    raise SystemExit("audit not ok: " + line.strip())
need = {
    "track": ["title=1", "wave=1", "start=1", "play=1"],
    "sync": ["title=1", "lyrics=1", "syncbtn=1", "lead=1", "words=1", "edit=1", "frames=1"],
    "syncshot": ["title=1", "lyrics=1", "syncbtn=1", "lead=1", "words=1", "edit=1", "frames=1", "edited=1"],
    "look": ["title=1", "stage=1", "looks=13", "palettes=12", "anims=15"],
    "time": ["title=1", "timeline=1", "zooms=5"],
    "render": ["title=1", "quality=4", "fx=7", "renderbtn=1"],
}[screen]
need += ["clear=1", "fit=1", "overflow=0", "box=0", "inset=1", "zoom=130", "themes=1", "dock=1"]
have = set(line.split())
missing = [tok for tok in need if tok not in have]
if missing:
    raise SystemExit("missing " + ",".join(missing) + " in " + line.strip())
print("content ok", screen, theme)
PY
}

audit_matrix() {
  adb logcat -c || true
  adb shell am force-stop app.luciel.lyric || true
  adb shell am start -n app.luciel.lyric/.MainActivity --es demo audit --es theme aero --es textZoom 130
  local dump="" rc=0
  for _ in $(seq 1 180); do
    dump=$(adb logcat -d -s LucielReady:I || true)
    if printf '%s\n' "$dump" | grep -F "error:" >/dev/null; then
      echo "page error during layout audit"
      printf '%s\n' "$dump" | tail -40
      fail=1
      return
    fi
    printf '%s\n' "$dump" > /tmp/luciel-ready.txt
    set +e
    python3 - /tmp/luciel-ready.txt <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text(errors="replace")
screens = ("track", "sync", "look", "time", "render")
themes = ("aero", "y2k", "winamp")
found = {}
for line in text.splitlines():
    parts = line.split()
    for i in range(len(parts) - 2):
        if parts[i] in screens and parts[i + 1] in themes and parts[i + 2] in ("ok", "fail"):
            found[(parts[i], parts[i + 1])] = " ".join(parts[i:])
need = [(s, t) for t in themes for s in screens]
if len(found) < len(need):
    raise SystemExit(2)
bad = []
for key in need:
    msg = found[key]
    print(msg)
    if msg.split()[2] != "ok":
        bad.append("/".join(key))
if bad:
    raise SystemExit("matrix failures " + " ".join(bad))
print("matrix", len(found))
PY
    rc=$?
    set -e
    if [ "${rc}" -eq 0 ]; then
      return
    fi
    if [ "${rc}" -ne 2 ]; then
      echo "layout audit failed"
      fail=1
      return
    fi
    sleep 1
  done
  echo "timed out waiting for the 15 screen/theme audits"
  printf '%s\n' "$dump" | tail -80
  fail=1
}

capture() {
  local demo="$1" theme="$2" file="$3"
  adb logcat -c || true
  adb shell am force-stop app.luciel.lyric || true
  adb shell am start -n app.luciel.lyric/.MainActivity --es demo "${demo}" --es theme "${theme}" --es textZoom 130
  ok=0
  err=0
  ready=""
  for _ in $(seq 1 90); do
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
    ready=$(adb logcat -d -s LucielReady:I | grep -F "${demo} ${theme} " | tail -1 || true)
    if [ -n "${ready}" ]; then
      ok=1
      break
    fi
    sleep 1
  done
  if [ "${ok}" != 1 ] && [ "${err}" != 1 ]; then
    echo "timed out waiting for ${demo} ${theme}"
    adb logcat -d | tail -120
    fail=1
  fi
  if [ -n "${ready}" ]; then
    echo "${ready}"
    if ! check_line "${ready}" "${demo}" "${theme}"; then
      echo "content assertion failed for ${file}"
      fail=1
    fi
  fi
  out="docs/screenshots/${file}"
  blank=1
  for _try in 1 2 3 4 5 6; do
    sleep 2
    adb shell screencap -p /sdcard/luciel-shot.png >/dev/null || true
    adb pull /sdcard/luciel-shot.png "${out}" >/dev/null || true
    hash=$(sha256sum "${out}" | awk '{print $1}')
    if [ -n "${last_hash}" ] && [ "${hash}" = "${last_hash}" ]; then
      echo "stale frame for ${file}, retry ${_try}"
      continue
    fi
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

def span(y):
    cols = set()
    row = rows[y]
    for x in range(0, w, 3):
        o = x * n
        cols.add((row[o] // 8, row[o + 1] // 8, row[o + 2] // 8))
    return len(cols)

busy = 0
for y in range(int(h * 0.20), int(h * 0.78)):
    if span(y) > 8:
        busy += 1
print(p, len(b), f"busy={busy}")
if busy < 40:
    raise SystemExit(f"empty screen busy={busy}")
PY
    then
      blank=0
      last_hash="${hash}"
      break
    fi
    echo "blank frame for ${file}, retry ${_try}"
  done
  if [ "${blank}" != 0 ]; then
    echo "screenshot stayed blank: ${file}"
    fail=1
  fi
}

audit_matrix
capture track aero android-track.png
capture syncshot aero android-sync.png
capture syncshot y2k android-sync-y2k.png
capture syncshot winamp android-sync-winamp.png
capture look aero android-look.png
capture time aero android-time.png
capture render aero android-render.png
capture look y2k android-look-y2k.png
capture look winamp android-look-winamp.png
exit "${fail}"
