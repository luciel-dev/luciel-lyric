#!/usr/bin/env bash
# Dev shortcut: serve on 0.0.0.0 without opening a browser (see start.sh)
cd "$(dirname "$0")"
NO_BROWSER=1 exec ./start.sh --host 0.0.0.0 "$@"
