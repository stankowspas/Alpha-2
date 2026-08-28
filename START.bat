@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not available in PATH.
  echo Install Node.js 22.12 or newer and run START.bat again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [Alpha Chat] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

if not defined ALPHA_SOURCE_TOKEN_SECRET (
  for /f %%i in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set "ALPHA_SOURCE_TOKEN_SECRET=%%i"
)
if not defined ALPHA_SOURCE_TOKEN_SECRET (
  set "ALPHA_SOURCE_TOKEN_SECRET=alpha-local-dev-secret-0123456789"
  echo [WARN] PowerShell secret generation failed. Using localhost-only development fallback.
)

echo [Alpha Chat] Starting local search backend on 127.0.0.1:5174...
start "Alpha Search Backend" cmd /c "set ALPHA_SOURCE_TOKEN_SECRET=%ALPHA_SOURCE_TOKEN_SECRET%&& npm run dev:search"

echo [Alpha Chat] Starting hardened fetch backend on 127.0.0.1:5175...
start "Alpha Fetch Backend" cmd /c "set ALPHA_SOURCE_TOKEN_SECRET=%ALPHA_SOURCE_TOKEN_SECRET%&& npm run dev:fetch"

echo [Alpha Chat] Starting local web app on 127.0.0.1:5173...
start "" http://localhost:5173
call npm run dev:web -- --host 127.0.0.1
