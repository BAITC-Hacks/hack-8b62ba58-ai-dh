@echo off
setlocal
cd /d "%~dp0"
call "%~dp0scripts\node.cmd" --test backend/tests/*.test.ts
set "SANA_TEST_RESULT=%ERRORLEVEL%"
pause
exit /b %SANA_TEST_RESULT%
