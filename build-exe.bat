@echo off
cd /d "%~dp0"
call npm run dist
if errorlevel 1 (
  echo.
  echo The exe build failed.
  pause
  exit /b 1
)
echo.
echo Portable app: Release\Steam Updater.exe
pause
