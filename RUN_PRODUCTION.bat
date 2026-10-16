@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Install the current Node.js LTS from https://nodejs.org/
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
  echo Installing dependencies...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
if not exist backend\.env (
  echo.
  echo Brevo SMTP is not configured yet.
  echo For real OTP emails, run SETUP_BREVO_EMAIL.bat once.
  echo Local OTP testing will still work in development mode.
  echo.
)
echo Building frontend...
call npm run build
if errorlevel 1 pause & exit /b 1
echo Starting production server at http://localhost:4000
call npm start
pause
