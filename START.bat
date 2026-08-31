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

echo [Alpha Chat] Starting local web app on 127.0.0.1:5173...
start "" http://localhost:5173
call npm run dev:web -- --host 127.0.0.1
