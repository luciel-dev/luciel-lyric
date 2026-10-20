#!/usr/bin/env bash
# Start Luciel Lyric (Linux/macOS) on http://localhost:8000 and open the browser. Works offline.
cd "$(dirname "$0")" || exit 1
PY="runtime/venv/bin/python"
[ -x "$PY" ] || PY=".venv/bin/python"   # developer checkout
if [ ! -x "$PY" ] || ! "$PY" -c "import fastapi" >/dev/null 2>&1; then
  echo "Luciel Lyric is not installed yet (or the folder was moved) - run the Install script first."
  exit 1
fi
unset PYTHONHOME PYTHONPATH VIRTUAL_ENV
export HF_HUB_OFFLINE=1 PYTHONUTF8=1
exec "$PY" -m app.launch "$@"
