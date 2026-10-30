@echo off
cd /d "%~dp0"
if exist "release\win-unpacked\Lekh - Markdown editor.exe" (
  start "" "release\win-unpacked\Lekh - Markdown editor.exe"
) else (
  echo First-time setup will download the tools and build Lekh.
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup.ps1"
  if errorlevel 1 (
    pause
    exit /b 1
  )
  if exist "release\win-unpacked\Lekh - Markdown editor.exe" start "" "release\win-unpacked\Lekh - Markdown editor.exe"
)
