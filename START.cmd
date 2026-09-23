@echo off
setlocal
cd /d "%~dp0"
echo AI Sana Challenge Hub
echo Open the address printed by the server below.
echo Keep this window open. Press Ctrl+C to stop the server.
call "%~dp0scripts\node.cmd" --env-file-if-exists=backend/.env backend/src/server.ts
if errorlevel 1 pause
