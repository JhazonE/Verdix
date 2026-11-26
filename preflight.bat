@echo off
setlocal EnableDelayedExpansion
:: Vendix upgrade pre-flight check — run on the store's SERVER PC before
:: updating. Read-only unless you type FIX at the prompt.
::
:: It reports pending migrations, duplicate barcodes (migration 119 aborts the
:: whole update on them), table sizes and behaviour changes, then a verdict:
::   CLEAR TO UPDATE   -> back up the database, then run VendixSetup.
::   DO NOT UPDATE YET -> resolve the duplicates first.
::
:: Ships in two places with the same layout (node.exe + updater\ beside it):
::   {app}\preflight.bat                 - part of every Vendix install
::   VendixPreflight kit (preflight.iss)  - for an OLD install that has none
:: The database details come from the install's own .env.

chcp 65001 >nul
set "HERE=%~dp0"
set "LOG_DIR=C:\ProgramData\Verdix"
set "LOG_FILE=%LOG_DIR%\preflight.log"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

if exist "%HERE%.env" (
    set "VERDIX_ENV_FILE=%HERE%.env"
) else if exist "%ProgramFiles%\Vendix\.env" (
    set "VERDIX_ENV_FILE=%ProgramFiles%\Vendix\.env"
) else (
    echo.
    echo [FAIL] Vendix is not installed on this PC ^(no .env found^).
    echo        Looked in: %HERE%.env
    echo               and: %ProgramFiles%\Vendix\.env
    echo.
    pause
    exit /b 2
)

if not exist "%HERE%node.exe" (
    echo [FAIL] node.exe is missing from %HERE%
    pause
    exit /b 2
)

echo Running the Vendix upgrade pre-flight check...
echo.
call :run_check
set "CHECK_RESULT=%errorlevel%"
type "%LOG_FILE%"

findstr /c:"Re-run with --fix" "%LOG_FILE%" >nul 2>&1
if %errorlevel% neq 0 goto :done

echo.
echo ------------------------------------------------------------------------
echo  Some duplicate barcodes are WAREHOUSE SIBLINGS ^(the same item in two
echo  warehouses^). FIX clears the barcode on the extra rows and keeps it on
echo  one row per item. Genuine conflicts are never touched.
echo.
echo  Back up the database FIRST. This changes the live database.
echo ------------------------------------------------------------------------
set "ANSWER="
set /p "ANSWER=Type FIX and press Enter to clear them, or just press Enter to skip: "
if /i not "!ANSWER!"=="FIX" goto :done

echo.
call :run_check --fix
type "%LOG_FILE%"
echo.
echo Checking again...
echo.
call :run_check
set "CHECK_RESULT=%errorlevel%"
type "%LOG_FILE%"

:done
echo.
echo Full report saved to %LOG_FILE%
echo.
pause
exit /b %CHECK_RESULT%

:run_check
pushd "%HERE%updater"
"%HERE%node.exe" "%HERE%updater\node_modules\tsx\dist\cli.mjs" "%HERE%updater\scripts\updater\run-preflight.ts" %* > "%LOG_FILE%" 2>&1
set "RC=%errorlevel%"
popd
exit /b %RC%
