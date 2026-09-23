@echo off
setlocal
set "SANA_NODE="
for /f "delims=" %%I in ('where node 2^>nul') do if not defined SANA_NODE set "SANA_NODE=%%I"
if not defined SANA_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "SANA_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined SANA_NODE (
  echo Node.js 24 or newer is required. Install Node.js and run START.cmd again.
  exit /b 1
)
"%SANA_NODE%" -e "if (Number(process.versions.node.split('.')[0]) < 24) { console.error('Node.js 24 or newer is required.'); process.exit(1); }"
if errorlevel 1 exit /b 1
"%SANA_NODE%" %*
exit /b %ERRORLEVEL%
