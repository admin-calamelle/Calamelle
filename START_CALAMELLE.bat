@echo off
setlocal
cd /d "%~dp0"
title Calamelle v2.3.7

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.12 or newer is required.
  echo Install the current Node.js LTS from https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm was not found in PATH.
  echo Reinstall Node.js and make sure "Add to PATH" is enabled.
  pause
  exit /b 1
)

for /f "tokens=1,2 delims=." %%a in ('node -p "process.versions.node"') do (
  if %%a LSS 22 (
    echo Your Node.js version is too old. Node.js 22.12 or newer is required.
    pause
    exit /b 1
  )
)

if not exist node_modules (
  echo Installing dependencies for the first launch...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

if not exist backend\.env (
  echo.
  echo Brevo SMTP is not configured yet.
  echo Run SETUP_BREVO_EMAIL.bat once if you want real OTP e-mails.
  echo.
)

echo Starting Calamelle v2.3.7 - Windows-safe launcher...
echo This build fixes the Windows spawn EINVAL error.
echo.
call npm run dev

echo.
echo Calamelle stopped.
pause
