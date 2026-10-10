@echo off
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
  py -3 painel.py
) else (
  python painel.py
)
if errorlevel 1 (
  echo Verifique se Python 3 e Tkinter estao instalados.
  pause
)
