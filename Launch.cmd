@echo off
cd /d "%~dp0"
if exist "release\win-unpacked\Markdown Studio.exe" (
  start "" "release\win-unpacked\Markdown Studio.exe"
) else (
  echo First-time setup will download the tools and build Markdown Studio.
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup.ps1"
  if errorlevel 1 (
    pause
    exit /b 1
  )
  if exist "release\win-unpacked\Markdown Studio.exe" start "" "release\win-unpacked\Markdown Studio.exe"
)
