@echo off
rem Start UrbanLab (agent backend + frontend) from the repo root. Usage: dev [live|fake]
cd /d "%~dp0frontend" && node scripts\dev.mjs %*
