# Luciel Lyric installer for Windows (called by Install.bat). Works in Windows PowerShell 5.1 and PowerShell 7.
#
# Everything goes into the app folder (nothing is installed system-wide):
#   runtime\uv.exe   the uv tool (downloaded, checksum-verified)
#   runtime\python   a private Python 3.12 managed by uv  (your own Python is ignored)
#   runtime\venv     the app's packages
#   runtime\cache    uv's download cache
#   models\          the AI models
# Needs internet once. Options: -NoLaunch (don't start the app at the end), -NoVocals.
param([switch]$NoLaunch, [switch]$NoVocals)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster on PowerShell 5.1
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

$App = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $App
$RT = Join-Path $App 'runtime'
New-Item -ItemType Directory -Force -Path $RT | Out-Null
$Log = Join-Path $RT 'install.log'
try { Start-Transcript -Path $Log -Force | Out-Null } catch { }

$UvVersion = '0.13.3'
$PyVersion = '3.12'
$OnWindows = ($env:OS -eq 'Windows_NT')
$Exe = ''
$VenvBin = 'bin'
if ($OnWindows) { $Exe = '.exe'; $VenvBin = 'Scripts' }
if ($env:LUCIEL_NO_LAUNCH -eq '1' -or $env:LYRICCLIP_NO_LAUNCH -eq '1') { $NoLaunch = $true }
if ($env:LUCIEL_SKIP_VOCALS -eq '1' -or $env:LYRICCLIP_SKIP_VOCALS -eq '1') { $NoVocals = $true }

# keep uv (and its Python + cache) self-contained in the app folder, and ignore any other Python
$env:UV_CACHE_DIR = Join-Path $RT 'cache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $RT 'python'
$env:UV_PYTHON_PREFERENCE = 'only-managed'
$env:UV_PYTHON_DOWNLOADS = 'automatic'
$env:UV_NO_CONFIG = '1'
$env:UV_PYTHON_BIN_DIR = Join-Path $RT 'python\bin'   # never touch the user's PATH dirs or registry
if (-not $env:UV_LINK_MODE) { $env:UV_LINK_MODE = 'copy' }
foreach ($v in 'VIRTUAL_ENV', 'CONDA_PREFIX', 'PYTHONHOME', 'PYTHONPATH', 'PIP_REQUIRE_VIRTUALENV') {
    Remove-Item -Path "Env:$v" -ErrorAction SilentlyContinue
}

$script:Step = 0
$Steps = 6
function Step([string]$msg) {
    $script:Step++
    Write-Host ''
    Write-Host "[$($script:Step)/$Steps] $msg" -ForegroundColor Cyan
}
function Fail([string]$msg) {
    Write-Host ''
    Write-Host "  !! $msg" -ForegroundColor Red
    Write-Host '  Nothing was changed outside this folder. A full log is in runtime\install.log.'
    Write-Host '  Fix the problem above (usually: check the internet connection) and run Install again.'
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
}

Write-Host '=================================================='
Write-Host '  Installing Luciel Lyric  (one time, needs internet)'
Write-Host '=================================================='
Write-Host "  Folder: $App"

# ---------------------------------------------------------------- 1. uv
Step "Getting the installer tool (uv $UvVersion)"
$UvHashes = @{
    'x86_64-pc-windows-msvc'      = 'bb701bd35b586c45966654ea2703c9bd116a6a4fc0a8ca755bd644c2c41c5ebe'
    'aarch64-pc-windows-msvc'     = 'aeaca1a1b721c1686c09b4aa23d57f938df049bed1b8e534b5bf79a032b8b87b'
    'x86_64-unknown-linux-gnu'    = 'e4f169ec380f1793b898a6f1fcbacd22db25cf7ca0349a6e96ffb85b69998d04'
    'aarch64-unknown-linux-gnu'   = '611ff684f193a84d2fdad29c5f12505d02ece94984c7c982cdde950eba5c95b9'
    'aarch64-apple-darwin'        = 'bf1e4fb6f5f5079a2902ad3f3a9e2d337575b226a1378f2449d8404353650608'
    'x86_64-apple-darwin'         = '5c35634957db7ebd9c2e4cc6c66b8979fb2c26a6b0dbd1d214d6acbac4033a89'
}
function Get-UvTarget {
    $arch = $env:PROCESSOR_ARCHITEW6432
    if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
    if ($OnWindows) {
        if ($arch -eq 'ARM64') { return 'aarch64-pc-windows-msvc' }
        return 'x86_64-pc-windows-msvc'
    }
    # PowerShell 7 on Linux/macOS (used for testing)
    $m = (& uname -m).Trim()
    $a = 'x86_64'
    if ($m -eq 'arm64' -or $m -eq 'aarch64') { $a = 'aarch64' }
    if ((& uname -s).Trim() -eq 'Darwin') { return "$a-apple-darwin" }
    return "$a-unknown-linux-gnu"
}

$Uv = Join-Path $RT "uv$Exe"
$haveUv = $false
if (Test-Path -LiteralPath $Uv) {
    & $Uv --version *> $null
    if ($LASTEXITCODE -eq 0) { $haveUv = $true; Write-Host "  already here: $(& $Uv --version)" }
}
if (-not $haveUv) {
    $target = Get-UvTarget
    $ext = 'tar.gz'
    if ($OnWindows) { $ext = 'zip' }
    $url = "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-$target.$ext"
    $tmp = Join-Path $RT "uv-download.$ext"
    $extract = Join-Path $RT 'uv-extract'
    Write-Host "  downloading uv for $target ..."
    for ($i = 1; ($i -le 3) -and (-not $haveUv); $i++) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -TimeoutSec 120
            $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $tmp).Hash.ToLower()
            if ($hash -ne $UvHashes[$target]) { throw "checksum mismatch ($hash)" }
            if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
            New-Item -ItemType Directory -Force -Path $extract | Out-Null
            if ($OnWindows) { Expand-Archive -LiteralPath $tmp -DestinationPath $extract -Force }
            else { & tar -xzf $tmp -C $extract }
            $found = Get-ChildItem -Path $extract -Recurse -Filter "uv$Exe" | Select-Object -First 1
            if (-not $found) { throw 'uv not found in the download' }
            Move-Item -Force -LiteralPath $found.FullName -Destination $Uv
            if (-not $OnWindows) { & chmod +x $Uv }
            $haveUv = $true
        } catch {
            Write-Host "  attempt $i failed: $($_.Exception.Message)" -ForegroundColor Yellow
            Start-Sleep -Seconds (3 * $i)
        } finally {
            Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $tmp
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath $extract
        }
    }
    if (-not $haveUv -and $OnWindows) {
        Write-Host '  trying the official uv installer instead ...'
        try {
            $env:UV_UNMANAGED_INSTALL = Join-Path $RT 'uvbin'
            Invoke-RestMethod "https://astral.sh/uv/$UvVersion/install.ps1" | Invoke-Expression
            $cand = Join-Path $env:UV_UNMANAGED_INSTALL 'uv.exe'
            if (Test-Path -LiteralPath $cand) { Move-Item -Force -LiteralPath $cand -Destination $Uv; $haveUv = $true }
        } catch { Write-Host "  official installer failed: $($_.Exception.Message)" -ForegroundColor Yellow }
        Remove-Item Env:UV_UNMANAGED_INSTALL -ErrorAction SilentlyContinue
    }
    if (-not $haveUv) {
        $sys = Get-Command uv -ErrorAction SilentlyContinue
        if ($sys) { $Uv = $sys.Source; $haveUv = $true; Write-Host '  using the uv already installed on this computer' }
    }
    if (-not $haveUv) { Fail 'Could not download uv (the installer tool). Are you online?' }
    Write-Host "  ok: $(& $Uv --version)"
}

# ---------------------------------------------------------------- 2. Python
Step "Getting a private Python $PyVersion (ignores any Python you already have)"
& $Uv python install $PyVersion --quiet --no-bin --no-registry
if ($LASTEXITCODE -ne 0) { Fail "Could not download Python $PyVersion." }
$VenvDir = Join-Path $RT 'venv'
$Vpy = Join-Path (Join-Path $VenvDir $VenvBin) "python$Exe"
$venvOk = $false
if (Test-Path -LiteralPath $Vpy) {
    & $Vpy -c "import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)" *> $null
    if ($LASTEXITCODE -eq 0) { $venvOk = $true; Write-Host '  environment already exists: runtime\venv' }
}
if (-not $venvOk) {
    & $Uv venv --quiet --clear --python $PyVersion $VenvDir
    if ($LASTEXITCODE -ne 0) { Fail 'Could not create the Python environment.' }
    Write-Host "  created runtime\venv ($(& $Vpy --version))"
}

# ---------------------------------------------------------------- 3. packages
Step "Installing the app's packages (the biggest step, a few minutes)"
$extra = @()
if (Get-ChildItem -Path (Join-Path $App 'wheels') -Filter '*.whl' -ErrorAction SilentlyContinue) {
    $extra = @('--find-links', (Join-Path $App 'wheels')); Write-Host '  using local wheels\ folder'
}
& $Uv pip install --python $Vpy @extra -r 'scripts/requirements.txt'
if ($LASTEXITCODE -ne 0) {
    Write-Host '  pinned versions failed - trying the newest compatible versions' -ForegroundColor Yellow
    & $Uv pip install --python $Vpy @extra -r 'scripts/requirements-loose.txt'
    if ($LASTEXITCODE -ne 0) { Fail 'Installing packages failed.' }
}
$VocalsOk = $false
if (-not $NoVocals) {
    Write-Host '  + vocal isolation (PyTorch CPU + Demucs, ~200 MB)'
    $torchOk = $true
    $isMac = (-not $OnWindows) -and ((& uname -s).Trim() -eq 'Darwin')
    if (-not $isMac) {
        & $Uv pip install --python $Vpy @extra 'torch==2.14.1' --index-url 'https://download.pytorch.org/whl/cpu'
        if ($LASTEXITCODE -ne 0) { $torchOk = $false }
    }
    if ($torchOk) {
        & $Uv pip install --python $Vpy @extra -r 'scripts/requirements-vocals.txt'
        if ($LASTEXITCODE -eq 0) { $VocalsOk = $true }
    }
    if (-not $VocalsOk) { Write-Host '  !! vocal isolation is not available on this computer - Luciel Lyric works without it.' -ForegroundColor Yellow }
}

# ---------------------------------------------------------------- 4. models
Step 'Getting the AI models (speech ~148 MB, vocals ~84 MB; skipped if already there)'
if ($VocalsOk) { & $Vpy 'scripts/fetch_models.py' } else { & $Vpy 'scripts/fetch_models.py' '--no-vocals' }
$mrc = $LASTEXITCODE
if ($mrc -eq 1) { Fail "The speech model is missing - Luciel Lyric can't sync lyrics without it." }
if ($mrc -eq 2) { Write-Host "  !! vocal-isolation model missing - the app works, without the 'isolate vocals' option." -ForegroundColor Yellow }

# ---------------------------------------------------------------- 5. ffmpeg + checks
Step 'Checking ffmpeg and everything else'
& $Vpy 'scripts/check_setup.py' '--fetch-ffmpeg'
if ($LASTEXITCODE -ne 0) { Fail 'Some checks failed (see above).' }

# ---------------------------------------------------------------- 6. tidy up
Step 'Tidying up'
& $Uv cache clean --quiet *> $null
Write-Host '  done'

Write-Host ''
Write-Host '==================================================' -ForegroundColor Green
Write-Host '  Done! Double-click "Start Luciel Lyric" to open the app.' -ForegroundColor Green
Write-Host '==================================================' -ForegroundColor Green
try { Stop-Transcript | Out-Null } catch { }
if (-not $NoLaunch) {
    Write-Host '  Starting Luciel Lyric now... (close this window or press Ctrl+C to stop it)'
    $env:HF_HUB_OFFLINE = '1'
    $env:PYTHONUTF8 = '1'
    & $Vpy -m app.launch
}
exit 0
