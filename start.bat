@echo off
cd /d "%~dp0"
node --version >NUL 2>&1
if errorlevel 1 (
  echo Node.js is not installed.
  echo Download the LTS installer from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
echo.
echo   Onic tournament server starting...
echo   Open  http://localhost:3000        in your browser
echo   Organizer page:  http://localhost:3000/organizer
echo.
echo   Leave this window open. Press Ctrl+C to stop.
echo.
node server.js
pause
