@echo off
rem Packages SSL Checker for the Chrome Web Store.
rem Double-click this file, or run it from a terminal: package.cmd, package.cmd full or package.cmd lite
rem The packages are written to the dist folder: ssl-checker-VERSION.zip and ssl-checker-lite-VERSION.zip
setlocal
set "EXITCODE=0"
cd /d "%~dp0.." || goto :fail

if not exist "scripts\build.mjs" (
  echo scripts\build.mjs not found. This file must stay in the build folder of the SSL Checker project.
  goto :fail
)

where node >nul 2>nul || goto :nonode
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%v in ('node -p process.versions.node') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR goto :nonode
if %NODE_MAJOR% LSS 20 (
  echo Node.js %NODE_MAJOR% found. Node.js 20 or newer is required: https://nodejs.org/
  goto :fail
)

call node scripts\build.mjs %*
if errorlevel 1 goto :fail
echo.
echo Done. The packages are in %CD%\dist
goto :done

:nonode
echo Node.js was not found. Install Node.js 20 or newer from https://nodejs.org/ and try again.

:fail
set "EXITCODE=1"
echo.
echo Packaging failed.

:done
rem When started by double-click the window would close at once, so wait for a key.
echo %cmdcmdline% | find /i "%~f0" >nul && pause
exit /b %EXITCODE%
