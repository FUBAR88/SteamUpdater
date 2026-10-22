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
call npm start
if errorlevel 1 (
  echo.
  echo The dev tool failed to start.
  pause
)
