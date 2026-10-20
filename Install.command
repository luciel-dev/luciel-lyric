#!/usr/bin/env bash
# Luciel Lyric installer for macOS - double-click me. (Needs internet once; installs only inside this folder.)
# If macOS says it "cannot be opened": right-click (or Control-click) this file > Open > Open.
cd "$(dirname "$0")" || exit 1
bash scripts/setup.sh "$@"
rc=$?
if [ $rc -ne 0 ]; then echo; read -r -p "Press Enter to close this window..." _; fi
exit $rc
