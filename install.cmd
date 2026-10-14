@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "BISHOP_INSTALL_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %BISHOP_INSTALL_EXIT%
