@echo off
cd /d "%~dp0"

:: Ensure VerdixMySQL service is running before starting the app server
sc query VerdixMySQL | findstr /C:"RUNNING" >nul 2>&1
if %errorlevel% neq 0 (
    echo Starting VerdixMySQL service...
    net start VerdixMySQL >nul 2>&1
    timeout /t 8 /nobreak >nul
)

echo Starting Vendix Server...
:: server.js defaults to port 3000; the Electron app and NEXT_PUBLIC_API_BASE_URL
:: both expect 47821, so the boot launcher must pin it too.
:: Keep in sync with SERVER_PORT in main.js.
set PORT=47821
".\node.exe" server.js
