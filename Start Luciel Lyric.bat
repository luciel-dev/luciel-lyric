@echo off
rem Start Luciel Lyric - double-click me. Your browser opens at http://localhost:8000.
rem Keep this window open while you use the app; close it to quit.
cd /d "%~dp0"
set "PY=runtime\venv\Scripts\python.exe"
if not exist "%PY%" (
  echo Luciel Lyric is not installed yet ^(or the folder was moved^) - double-click Install.bat first.
  pause
  exit /b 1
)
set PYTHONHOME=
set PYTHONPATH=
set HF_HUB_OFFLINE=1
set PYTHONUTF8=1
"%PY%" -m app.launch %*
if errorlevel 1 pause
