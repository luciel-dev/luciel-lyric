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
    "track": ["title=1", "wave=1", "start=1", "play=1", "next=1", "steps=6"],
    "sync": ["title=1", "lyrics=1", "syncbtn=1", "lead=1", "words=1", "edit=1", "frames=1", "linerows=1", "previewpin=1", "next=1", "steps=6"],
    "syncshot": ["title=1", "lyrics=1", "syncbtn=1", "lead=1", "words=1", "edit=1", "frames=1", "edited=1", "linerows=1", "lineshead=1", "previewpin=1", "next=1", "steps=6"],
    "look": ["title=1", "stage=1", "looks=13", "palettes=12", "anims=15", "previewpin=1", "next=1", "steps=6"],
    "time": ["title=1", "timeline=1", "zooms=5", "previewpin=1", "fold=1", "film=1", "actionfit=1", "next=1", "steps=6"],
    "video": ["title=1", "stage=1", "upload=1", "aspects=4", "fits=3", "vzoom=1", "previewpin=1", "next=1", "steps=6"],
    "render": ["title=1", "quality=4", "fx=7", "renderbtn=1", "previewpin=1", "next=1", "steps=6"],
    "home": ["title=1", "continue=1", "startnew=1"],
    "intro": ["title=1", "intronext=1", "skip=1"],
    "intro2": ["title=1", "intronext=1", "skip=1"],
    "intro3": ["title=1", "intronext=1", "skip=1"],
    "videocheck": ["title=1", "stage=1", "looks=13", "palettes=12", "anims=15", "previewpin=1", "bgvideo=1", "split=1", "trim=1", "lyricdrag=1", "renderframes=1"],
}[screen]
need += ["clear=1", "fit=1", "overflow=0", "box=0", "inset=1", "zoom=130", "themes=1", "dock=1", "dockfit=1", "themefit=1", "dockhit=1", "wrap=0", "ellipsis=0", "headclear=1"]
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
screens = ("track", "sync", "video", "look", "time", "render")
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
  local demo="$1" theme="$2" file="$3" video="${4:-}"
  adb logcat -c || true
  adb shell am force-stop app.luciel.lyric || true
  if [ -n "${video}" ]; then
    adb shell am start -n app.luciel.lyric/.MainActivity --es demo "${demo}" --es theme "${theme}" --es textZoom 130 --es videoUri "${video}"
  else
    adb shell am start -n app.luciel.lyric/.MainActivity --es demo "${demo}" --es theme "${theme}" --es textZoom 130
  fi
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
  tab="${file#android-}"
  tab="${tab%.png}"
  tab="${tab%-y2k}"
  tab="${tab%-winamp}"
  blank=1
  for _try in 1 2 3 4 5 6 7 8; do
    sleep 2
    adb shell screencap -p /sdcard/luciel-shot.png >/dev/null || true
    adb pull /sdcard/luciel-shot.png "${out}" >/dev/null || true
    hash=$(sha256sum "${out}" | awk '{print $1}')
    if [ -n "${last_hash}" ] && [ "${hash}" = "${last_hash}" ]; then
      echo "stale frame for ${file}, retry ${_try}"
      continue
    fi
    if python3 android/scripts/shot_check.py "${out}" "${tab}" "${theme}"; then
      blank=0
      last_hash="${hash}"
      break
    fi
    echo "screenshot not ready for ${file}, retry ${_try}"
  done
  if [ "${blank}" != 0 ]; then
    echo "screenshot stayed blank: ${file}"
    fail=1
  fi
}

audit_matrix
for theme in aero y2k winamp; do
  suffix=""
  if [ "${theme}" != "aero" ]; then suffix="-${theme}"; fi
  capture track "${theme}" "android-track${suffix}.png"
  capture syncshot "${theme}" "android-sync${suffix}.png"
  capture video "${theme}" "android-video${suffix}.png" asset:test-clip.mp4
  capture videocheck "${theme}" "android-look${suffix}.png" asset:test-clip.mp4
  capture time "${theme}" "android-time${suffix}.png" asset:test-clip.mp4
  capture render "${theme}" "android-render${suffix}.png" asset:test-clip.mp4
  capture home "${theme}" "android-home${suffix}.png"
  capture intro "${theme}" "android-intro${suffix}.png"
  capture intro2 "${theme}" "android-intro2${suffix}.png"
  capture intro3 "${theme}" "android-intro3${suffix}.png"
done
exit "${fail}"
