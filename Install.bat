@echo off
rem Luciel Lyric installer for Windows - double-click me. Needs internet once; installs only inside this folder.
rem If Windows says "Windows protected your PC": click "More info", then "Run anyway".
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %*
if errorlevel 1 (
  echo.
  echo Install did not finish - see the messages above. A log is in runtime\install.log
  pause
  exit /b 1
)
pause
