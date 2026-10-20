#!/bin/bash
# Ad-hoc sign "dist/Luciel Lyric.app" and wrap it in a drag-to-Applications .dmg.
#   bash packaging/macos/make_dmg.sh [arch-label]      -> dist/LucielLyric-mac-<arch>.dmg
# Not notarized (no Apple Developer ID): first launch needs right-click > Open, or on macOS 15+
# System Settings > Privacy & Security > "Open Anyway". See "READ ME FIRST.txt" inside the dmg.
set -euo pipefail
cd "$(dirname "$0")/../.."
ARCH="${1:-$(uname -m)}"
APP="dist/Luciel Lyric.app"
DMG="dist/LucielLyric-mac-${ARCH}.dmg"
[ -d "$APP" ] || { echo "missing $APP (run pyinstaller first)"; exit 1; }
xattr -cr "$APP" || true
# Ad-hoc sign Mach-O files, then the bundle. `codesign --deep` aborts on PyInstaller
# trees (scripts marked executable, nested signatures) and would fail the job before
# the smoke test. A signature warning must not discard a working build.
while IFS= read -r -d '' f; do
  if file -b "$f" | grep -q "Mach-O"; then
    codesign --force --sign - --timestamp=none "$f" >/dev/null 2>&1 || echo "warning: codesign failed for $f"
  fi
done < <(find "$APP/Contents" -type f -print0)
codesign --force --sign - --timestamp=none "$APP" || echo "warning: bundle codesign failed"
codesign --verify --verbose=2 "$APP" || echo "warning: codesign verify failed (ad-hoc; continuing)"
STAGE="$(mktemp -d)/Luciel Lyric"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
case "$ARCH" in arm64) KIND="Apple Silicon (M1 or newer)";; *) KIND="Intel Macs, no vocal isolation";; esac
cat > "$STAGE/READ ME FIRST.txt" <<TXT
Luciel Lyric for macOS - $KIND

1. Drag "Luciel Lyric" onto "Applications".
2. First launch: this app is not notarized by Apple, so macOS blocks a normal double-click.
   - macOS 14: right-click (or Control-click) the app > Open > Open.
   - macOS 15 or later: double-click once, then System Settings > Privacy & Security >
     scroll down to "Luciel Lyric was blocked" > Open Anyway.
   (Terminal alternative: xattr -dr com.apple.quarantine "/Applications/Luciel Lyric.app")
3. After that it opens normally. Everything runs offline on this Mac.

Your uploads, renders, fonts and presets are in ~/Library/Application Support/LucielLyric
(the app has an "Open renders folder" button).
TXT
rm -f "$DMG"
ok=0
for i in 1 2 3; do
  if hdiutil create -volname "Luciel Lyric" -srcfolder "$STAGE" -ov -format UDZO -imagekey zlib-level=9 "$DMG"; then
    ok=1
    break
  fi
  echo "hdiutil failed (attempt $i), retrying"
  rm -f "$DMG"
  sleep 5
done
[ "$ok" = 1 ]
echo "wrote $DMG ($(du -h "$DMG" | cut -f1))"
