@echo off
title Dogar Sajji & Restaurant RMS
cd /d "%~dp0"

echo ========================================================
echo   Launching Dogar Sajji & Restaurant RMS...
echo ========================================================

if not exist "node_modules\electron" (
  echo [INFO] First time setup: Installing dependencies...
  call npm install
)

if exist "node_modules\.bin\electron.cmd" (
  call "node_modules\.bin\electron.cmd" .
) else (
  call npx electron .
)
pause
