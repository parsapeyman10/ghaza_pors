@echo off
rem =================================================================
rem  دفترچهٔ شماره‌های داخلی — GhazaPors Directory  |  portable launcher
rem  اجرا می‌کند: 1) فایل exe کنار همین فایل  2) در غیر این صورت Node.js
rem =================================================================
setlocal
chcp 65001 >nul
title GhazaPors Directory
cd /d "%~dp0"

if exist "GhazaPors.exe" (
  echo [run] GhazaPors.exe
  "GhazaPors.exe" %*
  goto end
)
if exist "dist\GhazaPors.exe" (
  echo [run] dist\GhazaPors.exe
  "dist\GhazaPors.exe" %*
  goto end
)

where node >nul 2>nul
if %errorlevel%==0 (
  echo [run] node server\main.js
  node server\main.js %*
  goto end
)

echo.
echo  [!] Neither GhazaPors.exe nor Node.js was found.
echo      - Use the portable exe  : put GhazaPors.exe next to this file, or
echo      - Get the exe from Releases (see README.md), or
echo      - Install Node.js (LTS) and run:  npm install  then  npm start
echo.
pause
exit /b 1

:end
endlocal
