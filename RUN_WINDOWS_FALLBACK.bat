@echo off
setlocal
cd /d "%~dp0"
title Calamelle v2.3.7 - Windows fallback

echo Starting API on port 4000 in a separate window...
start "Calamelle API" cmd /k "cd /d \"%~dp0\" && set PORT=4000&& set FRONTEND_URL=http://localhost:5173&& npm --workspace backend run dev"

echo Waiting for API...
timeout /t 3 /nobreak >nul

echo Starting web app on port 5173 in a separate window...
start "Calamelle WEB" cmd /k "cd /d \"%~dp0\" && set CALAMELLE_API_URL=http://127.0.0.1:4000&& set CALAMELLE_WEB_PORT=5173&& npm --workspace frontend run dev"

echo.
echo API: http://127.0.0.1:4000
echo WEB: http://localhost:5173
echo.
echo If a port is already in use, close old Node processes first:
echo   taskkill /F /IM node.exe
pause
