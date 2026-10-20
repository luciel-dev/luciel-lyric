#!/usr/bin/env bash
# Luciel Lyric installer for macOS and Linux (called by Install.command / install.sh).
#
# Everything goes into the app folder (nothing is installed system-wide):
#   runtime/uv       the uv tool (downloaded, checksum-verified)
#   runtime/python   a private Python 3.12 managed by uv  (your own Python is ignored)
#   runtime/venv     the app's packages
#   runtime/cache    uv's download cache
#   models/          the AI models
# Needs internet once. Options: --no-launch (don't start the app at the end), --no-vocals.

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP" || exit 1
RT="$APP/runtime"
mkdir -p "$RT"
LOG="$RT/install.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

UV_VERSION="0.13.3"
PY_VERSION="3.12"
LAUNCH=1; VOCALS=1
for a in "$@"; do
  case "$a" in
    --no-launch) LAUNCH=0 ;;
    --no-vocals) VOCALS=0 ;;
  esac
done
[ "${LUCIEL_NO_LAUNCH:-${LYRICCLIP_NO_LAUNCH:-0}}" = "1" ] && LAUNCH=0
[ "${LUCIEL_SKIP_VOCALS:-${LYRICCLIP_SKIP_VOCALS:-0}}" = "1" ] && VOCALS=0  # LYRICCLIP_* = old names

# keep uv (and its Python + cache) self-contained in the app folder, and ignore any other Python
export UV_CACHE_DIR="$RT/cache"
export UV_PYTHON_INSTALL_DIR="$RT/python"
export UV_PYTHON_PREFERENCE="only-managed"
export UV_PYTHON_DOWNLOADS="automatic"
export UV_NO_CONFIG=1
export UV_PYTHON_BIN_DIR="$RT/python/bin"   # never put python links in ~/.local/bin
export UV_LINK_MODE="${UV_LINK_MODE:-copy}"
unset VIRTUAL_ENV CONDA_PREFIX PYTHONHOME PYTHONPATH PIP_REQUIRE_VIRTUALENV

STEP=0; STEPS=6
step() { STEP=$((STEP + 1)); echo; echo "[$STEP/$STEPS] $*"; }
fail() {
  echo
  echo "  !! $*"
  echo "  Nothing was changed outside this folder. A full log is in runtime/install.log."
  echo "  Fix the problem above (usually: check the internet connection) and run Install again."
  exit 1
}

echo "=================================================="
echo "  Installing Luciel Lyric  (one time, needs internet)"
echo "=================================================="
echo "  Folder: $APP"

# macOS: clear the download quarantine flag so the start script and ffmpeg open without warnings
if [ "$(uname -s)" = "Darwin" ]; then
  xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
fi

# ---------------------------------------------------------------- 1. uv
step "Getting the installer tool (uv $UV_VERSION)"

download() {  # url dest
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 --connect-timeout 20 -sS -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --tries=3 -O "$2" "$1"
  else
    echo "  neither curl nor wget is available"; return 1
  fi
}
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else echo "unknown"; fi
}

uv_target() {
  local os arch
  os="$(uname -s)"; arch="$(uname -m)"
  case "$arch" in arm64|aarch64) arch="aarch64" ;; x86_64|amd64) arch="x86_64" ;; *) echo ""; return ;; esac
  if [ "$os" = "Darwin" ]; then echo "$arch-apple-darwin"
  elif [ "$os" = "Linux" ]; then
    if (ldd --version 2>&1 || true) | grep -qi musl; then echo "$arch-unknown-linux-musl"; else echo "$arch-unknown-linux-gnu"; fi
  else echo ""; fi
}
uv_sha() {
  case "$1" in
    aarch64-apple-darwin) echo bf1e4fb6f5f5079a2902ad3f3a9e2d337575b226a1378f2449d8404353650608 ;;
    x86_64-apple-darwin) echo 5c35634957db7ebd9c2e4cc6c66b8979fb2c26a6b0dbd1d214d6acbac4033a89 ;;
    x86_64-unknown-linux-gnu) echo e4f169ec380f1793b898a6f1fcbacd22db25cf7ca0349a6e96ffb85b69998d04 ;;
    aarch64-unknown-linux-gnu) echo 611ff684f193a84d2fdad29c5f12505d02ece94984c7c982cdde950eba5c95b9 ;;
    x86_64-unknown-linux-musl) echo a36fca4c151d1ac13707984a88a4e2742edec0f2bc1b3e1c18c1c751e4679fd3 ;;
    aarch64-unknown-linux-musl) echo 4a58785768ab0577497ca7940be2f9fd5a34e48c3fd37923692fc0a81d71ac9f ;;
  esac
}

UV="$RT/uv"
if [ -x "$UV" ] && "$UV" --version >/dev/null 2>&1; then
  echo "  already here: $("$UV" --version)"
else
  T="$(uv_target)"
  got=0
  if [ -n "$T" ]; then
    tmp="$RT/uv-download.tar.gz"
    echo "  downloading uv for $T ..."
    if download "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$T.tar.gz" "$tmp"; then
      want="$(uv_sha "$T")"; have="$(sha256_of "$tmp")"
      if [ "$have" != "unknown" ] && [ "$have" != "$want" ]; then
        echo "  checksum mismatch for the uv download - ignoring it"
      else
        mkdir -p "$RT/uv-extract" && tar -xzf "$tmp" -C "$RT/uv-extract" \
          && mv -f "$RT/uv-extract/uv-$T/uv" "$UV" && chmod +x "$UV" && got=1
      fi
    fi
    rm -rf "$tmp" "$RT/uv-extract"
  fi
  if [ $got = 0 ]; then
    echo "  trying the official uv installer instead ..."
    if command -v curl >/dev/null 2>&1; then
      curl -LsSf "https://astral.sh/uv/$UV_VERSION/install.sh" | env UV_UNMANAGED_INSTALL="$RT/uvbin" sh >/dev/null && got=1
    elif command -v wget >/dev/null 2>&1; then
      wget -qO- "https://astral.sh/uv/$UV_VERSION/install.sh" | env UV_UNMANAGED_INSTALL="$RT/uvbin" sh >/dev/null && got=1
    fi
    [ $got = 1 ] && [ -x "$RT/uvbin/uv" ] && mv -f "$RT/uvbin/uv" "$UV" && rm -rf "$RT/uvbin" || got=0
  fi
  if [ $got = 0 ] && command -v uv >/dev/null 2>&1; then
    echo "  using the uv already installed on this computer"
    UV="$(command -v uv)"; got=1
  fi
  [ $got = 1 ] || fail "Could not download uv (the installer tool). Are you online?"
  echo "  ok: $("$UV" --version)"
fi

# ---------------------------------------------------------------- 2. Python
step "Getting a private Python $PY_VERSION (ignores any Python you already have)"
"$UV" python install "$PY_VERSION" --quiet --no-bin --no-registry || fail "Could not download Python $PY_VERSION."
VPY="$RT/venv/bin/python"
if [ -x "$VPY" ] && "$VPY" -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)' 2>/dev/null; then
  echo "  environment already exists: runtime/venv"
else
  "$UV" venv --quiet --clear --python "$PY_VERSION" "$RT/venv" || fail "Could not create the Python environment."
  echo "  created runtime/venv ($("$VPY" --version))"
fi

# ---------------------------------------------------------------- 3. packages
step "Installing the app's packages (the biggest step, a few minutes)"
EXTRA=""
if ls "$APP"/wheels/*.whl >/dev/null 2>&1; then EXTRA="--find-links $APP/wheels"; echo "  using local wheels/ folder"; fi
# shellcheck disable=SC2086
if ! "$UV" pip install --python "$VPY" $EXTRA -r scripts/requirements.txt; then
  echo "  pinned versions failed - trying the newest compatible versions"
  # shellcheck disable=SC2086
  "$UV" pip install --python "$VPY" $EXTRA -r scripts/requirements-loose.txt || fail "Installing packages failed."
fi

VOCALS_OK=0
if [ $VOCALS = 1 ]; then
  echo "  + vocal isolation (PyTorch CPU + Demucs, ~200 MB)"
  TORCH_OK=1
  if [ "$(uname -s)" = "Linux" ]; then
    # shellcheck disable=SC2086
    "$UV" pip install --python "$VPY" $EXTRA "torch==2.14.1" --index-url https://download.pytorch.org/whl/cpu || TORCH_OK=0
  fi
  # shellcheck disable=SC2086
  if [ $TORCH_OK = 1 ] && "$UV" pip install --python "$VPY" $EXTRA -r scripts/requirements-vocals.txt; then
    VOCALS_OK=1
  else
    echo "  !! vocal isolation is not available on this computer - Luciel Lyric works without it."
  fi
fi

# ---------------------------------------------------------------- 4. models
step "Getting the AI models (speech ~148 MB, vocals ~84 MB; skipped if already there)"
if [ $VOCALS_OK = 1 ]; then "$VPY" scripts/fetch_models.py; else "$VPY" scripts/fetch_models.py --no-vocals; fi
mrc=$?
if [ $mrc = 1 ]; then
  fail "The speech model is missing - Luciel Lyric can't sync lyrics without it."
elif [ $mrc = 2 ]; then
  echo "  !! vocal-isolation model missing - the app works, without the 'isolate vocals' option."
fi

# ---------------------------------------------------------------- 5. ffmpeg + checks
step "Checking ffmpeg and everything else"
"$VPY" scripts/check_setup.py --fetch-ffmpeg || fail "Some checks failed (see above)."

# ---------------------------------------------------------------- 6. tidy up
step "Tidying up"
"$UV" cache clean --quiet >/dev/null 2>&1 || true
chmod +x "$APP/start.sh" "$APP/Start Luciel Lyric.command" "$APP/install.sh" "$APP/Install.command" 2>/dev/null || true
echo "  done ($(du -sh "$RT" 2>/dev/null | cut -f1) used in runtime/)"

echo
echo "=================================================="
if [ "$(uname -s)" = "Darwin" ]; then
  echo "  Done! Double-click \"Start Luciel Lyric\" to open the app."
else
  echo "  Done! Run ./start.sh (or double-click start.sh) to open the app."
fi
echo "=================================================="
if [ $LAUNCH = 1 ]; then
  echo "  Starting Luciel Lyric now... (close this window or press Ctrl+C to stop it)"
  exec "$VPY" -m app.launch
fi
exit 0
