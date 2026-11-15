@echo off
rem Start UrbanLab (agent backend + frontend) from the repo root. Usage: dev [live|fake|demo]
cd /d "%~dp0frontend" && node scripts\dev.mjs %*
