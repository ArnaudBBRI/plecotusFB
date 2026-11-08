@echo off
setlocal
if not exist "%~dp0plecotus-local.ps1" (
  echo Le fichier plecotus-local.ps1 est introuvable.
  echo Decompressez tous les fichiers Plecotus dans le meme dossier.
  pause
  exit /b 1
)
start "" "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0plecotus-local.ps1"
endlocal
