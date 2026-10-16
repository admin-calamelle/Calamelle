@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-brevo.ps1"
if errorlevel 1 (
  echo.
  echo Brevo setup failed.
  pause
  exit /b 1
)
pause
