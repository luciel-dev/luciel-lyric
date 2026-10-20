#!/usr/bin/env bash
# Start Luciel Lyric on macOS - double-click me. Your browser opens at http://localhost:8000.
# Keep this window open while you use the app; close it (or press Ctrl+C) to quit.
cd "$(dirname "$0")" || exit 1
bash ./start.sh "$@"
rc=$?
if [ $rc -ne 0 ]; then echo; read -r -p "Press Enter to close this window..." _; fi
exit $rc
