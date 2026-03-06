@echo off
cd /d "%~dp0"
set PORT=3001

for /f "tokens=5" %%P in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
  echo Stopping existing process on port %PORT% (PID %%P)...
  taskkill /PID %%P /F >nul 2>nul
)

echo Starting Attendance server on http://localhost:%PORT%
echo Keep this window open while using the app.
echo.
node server.js
echo.
echo Server stopped. Press any key to close.
pause >nul
