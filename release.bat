@echo off
rem Builds the setup and the portable exe and publishes both as a GitHub
rem release v<version> of FUBAR88/SteamUpdater. Raise "version" in
rem package.json first, every release needs a new one.
cd /d "%~dp0"
if "%GH_TOKEN%"=="" (
  echo GH_TOKEN is not set.
  echo Create a GitHub token with write access to the repository contents,
  echo then run:  set GH_TOKEN=^<token^>  and start release.bat again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)
call npm run release
if errorlevel 1 (
  echo.
  echo The release failed.
  pause
  exit /b 1
)
echo.
echo Published. Every Steam Updater sees the new version under its update button.
pause
