@echo off
setlocal
cd /d "%~dp0"
title MEUS CONTROLES

REM Usa uma porta exclusiva deste projeto para nao abrir outro servidor antigo.
set PORT=8877

REM Encerra apenas eventual servidor preso nesta porta.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1

REM Inicia o servidor exatamente na pasta deste BAT.
start "MEUS CONTROLES - SERVIDOR" /min cmd /c "cd /d ""%~dp0"" && py -m http.server %PORT% --bind 127.0.0.1"

REM Aguarda o servidor subir e abre o index desta pasta com cache-buster.
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/index.html?v=20261007-sheet"

endlocal
