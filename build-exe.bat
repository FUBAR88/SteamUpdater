@echo off
cd /d "%~dp0"
if not exist node_modules (
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)
call npm run dist
if errorlevel 1 (
  echo.
  echo The build failed.
  pause
  exit /b 1
)
echo.
echo Setup:        Release\Steam Updater Setup ^<version^>.exe
echo Portable app: Release\Steam Updater.exe
pause
