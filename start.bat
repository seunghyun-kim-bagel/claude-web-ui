@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo 기존 프로세스 정리 중...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000.*LISTENING" 2^>nul') do taskkill /PID %%a /T /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001.*LISTENING" 2^>nul') do taskkill /PID %%a /T /F >nul 2>&1
if exist ".next\dev\lock" del /f ".next\dev\lock" >nul 2>&1
timeout /t 1 /nobreak >nul

echo.
echo Claude Web UI 시작 중...
echo Next.js: http://localhost:3000
echo Server:  http://localhost:3001
echo.
start http://localhost:3000
pnpm dev
